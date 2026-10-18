import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit
import Speech

// マイクとシステム音声の違いをここに閉じ込め、画面には共通のPCMだけを渡します。
func emit(_ value: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: value),
    let line = String(data: data, encoding: .utf8)
  else { return }
  print(line)
  fflush(stdout)
}
func fail(_ message: String) -> Never {
  emit(["type": "error", "message": message])
  exit(1)
}
// 可変な入力・区切り状態はqueueで直列化し、resultsTaskは返却前に設定します。
@available(macOS 26.0, *)
final class AppleTranscriber: @unchecked Sendable {
  private let input: AsyncStream<AnalyzerInput>.Continuation
  private let analyzer: SpeechAnalyzer
  private let queue = DispatchQueue(label: "ledad.apple-transcriber", qos: .userInitiated)
  private var resultsTask: Task<Void, Never>?
  private var finalizationTask: Task<Void, Never>?
  private var frames = 0
  private var boundaryFrames = 0
  private var finishing = false

  private init(
    input: AsyncStream<AnalyzerInput>.Continuation,
    analyzer: SpeechAnalyzer
  ) {
    self.input = input
    self.analyzer = analyzer
  }

  static func start(language: String) async throws -> AppleTranscriber {
    guard SpeechTranscriber.isAvailable,
      let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: language))
    else { fail("このMacではApple SpeechTranscriberの選択した言語を利用できません。Geminiを選んでください。") }

    let transcriber = SpeechTranscriber(
      locale: locale, transcriptionOptions: [],
      reportingOptions: [.volatileResults, .fastResults], attributeOptions: [])
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      try await request.downloadAndInstall()
    }
    guard await transcriber.availableCompatibleAudioFormats.contains(where: {
      $0.sampleRate == 16000 && $0.channelCount == 1 && $0.commonFormat == .pcmFormatInt16
        && $0.isInterleaved
    }) else { fail("Appleの文字起こしで16kHz音声を利用できません。Geminiを選んでください。") }
    let (sequence, input) = AsyncStream.makeStream(
      of: AnalyzerInput.self, bufferingPolicy: .bufferingOldest(1024))
    let detector = SpeechDetector(
      detectionOptions: .init(sensitivityLevel: .high), reportResults: false)
    let analyzer = SpeechAnalyzer(
      modules: [detector, transcriber],
      options: .init(priority: .userInitiated, modelRetention: .whileInUse))
    let format = AVAudioFormat(
      commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    try await analyzer.prepareToAnalyze(in: format)
    try await analyzer.start(inputSequence: sequence)
    let instance = AppleTranscriber(input: input, analyzer: analyzer)
    instance.resultsTask = Task(priority: .userInitiated) {
      do {
        for try await result in transcriber.results {
          let finalizedThrough = CMTimeGetSeconds(result.resultsFinalizationTime)
          instance.recordFinalization(through: finalizedThrough)
          if result.isFinal {
            instance.recordFinalization(through: CMTimeGetSeconds(result.range.end))
          }
          emit([
            "type": "transcript",
            "text": String(result.text.characters),
            "final": result.isFinal,
            "start": CMTimeGetSeconds(result.range.start),
            "end": CMTimeGetSeconds(result.range.end),
            "finalizedThrough": finalizedThrough.isFinite ? max(0, finalizedThrough) : 0,
          ])
        }
      } catch { fail("Appleの文字起こしが終了しました。聞き取りを再開してください。") }
    }
    return instance
  }

  private func recordFinalization(through time: Double) {
    guard time.isFinite, time >= 0 else { return }
    queue.async {
      self.boundaryFrames = max(
        self.boundaryFrames, Int(min(Double(self.frames), time * 16000)))
    }
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    queue.async {
      guard !self.finishing else { return }
      if case .dropped = self.input.yield(AnalyzerInput(buffer: buffer)) {
        fail("Appleの文字起こしが音声に追いつけませんでした。聞き取りを再開してください。")
      }
      self.frames += Int(buffer.frameLength)
      guard self.frames - self.boundaryFrames >= 15 * 16000, self.finalizationTask == nil
      else { return }
      self.boundaryFrames = self.frames
      self.finalizationTask = Task {
        do {
          try await self.analyzer.finalize(through: nil)
        } catch { fail("Appleの文字起こしを確定できませんでした。聞き取りを再開してください。") }
        self.queue.sync { self.finalizationTask = nil }
      }
    }
  }

  func finish() async throws {
    let finalization = queue.sync {
      finishing = true
      return finalizationTask
    }
    await finalization?.value
    queue.sync { input.finish() }
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    await resultsTask?.value
  }
}
final class PcmOutput {
  private let lock = NSLock()
  private var stopped = false
  var onBuffer: ((AVAudioPCMBuffer) -> Void)?
  var mixer: PcmMixer?
  var channelMap: [NSNumber]?
  var converter: AVAudioConverter?
  var inputRate: Double = 0
  var inputChannels: AVAudioChannelCount = 0
  let target = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
  @available(macOS 27.0, *)
  func send(_ buffer: AVReadOnlyAudioPCMBuffer, at time: Double? = nil) {
    send(AVAudioPCMBuffer(copying: buffer), at: time)
  }
  func send(_ buffer: AVAudioPCMBuffer, at time: Double? = nil) {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped else { return }
    if inputRate != buffer.format.sampleRate || inputChannels != buffer.format.channelCount {
      converter = AVAudioConverter(from: buffer.format, to: target)
      if let channelMap { converter?.channelMap = channelMap }
      inputRate = buffer.format.sampleRate
      inputChannels = buffer.format.channelCount
    }
    guard let converter else { return }
    let capacity =
      AVAudioFrameCount(Double(buffer.frameLength) * 16000 / buffer.format.sampleRate) + 16
    guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
    var provided = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if provided {
        status.pointee = .noDataNow
        return nil
      }
      provided = true
      status.pointee = .haveData
      return buffer
    }
    guard error == nil, output.frameLength > 0 else { return }
    if let mixer {
      guard let time, time.isFinite else { fail("音声の時刻を取得できません。聞き取りを再開してください。") }
      mixer.append(output, at: time)
    } else {
      publish(output)
    }
  }
  func publish(_ output: AVAudioPCMBuffer) {
    guard output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
    let count = Int(output.frameLength)
    var sum: Double = 0
    for i in 0..<count {
      let value = Double(samples[i]) / 32768
      sum += value * value
    }
    let bytes = Data(bytes: samples, count: count * MemoryLayout<Int16>.size)
    emit([
      "type": "audio", "data": bytes.base64EncodedString(),
      "level": min(1, sqrt(sum / Double(count)) * 5),
    ])
    onBuffer?(output)
  }
  func finish() {
    lock.lock()
    stopped = true
    lock.unlock()
  }
}
// 共通のホスト時刻で合成し、無音の入力を待たずに一定速度で出力します。
final class PcmMixer {
  private let lock = NSLock()
  private let output: PcmOutput
  private let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ledad.mix"))
  private var samples = [Int32](repeating: 0, count: 32000)
  private var origin: Double?
  private var cursor = 0
  private var end = 0
  private var stopped = false

  init(output: PcmOutput) {
    self.output = output
    timer.setEventHandler { [weak self] in
      self?.drain(at: CMTimeGetSeconds(CMClockGetTime(CMClockGetHostTimeClock())))
    }
    timer.schedule(deadline: .now() + .milliseconds(100), repeating: .milliseconds(100))
    timer.resume()
  }

  func append(_ buffer: AVAudioPCMBuffer, at time: Double) {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped else { return }
    origin = origin ?? time
    let start = Int(((time - origin!) * 16000).rounded())
    let count = Int(buffer.frameLength)
    // 2秒を超える遅延や大幅な時刻の飛びは、一時的な遅延として扱いません。
    guard start + count >= cursor - samples.count,
      start + count <= cursor + samples.count * 2, count <= samples.count else {
      fail("音声の合成が追いつきませんでした。聞き取りを再開してください。")
    }
    if start + count > cursor + samples.count {
      // タイマーが遅れた場合も、保持済みの音声を捨てずに空きを作ります。
      let required = start + count - samples.count
      publish(through: (required + 1599) / 1600 * 1600)
    }
    // 出力済みの時刻には戻せないため、遅れた部分は通知せず除外します。
    if start + count <= cursor { return }
    let input = buffer.int16ChannelData![0]
    for i in max(0, cursor - start)..<count {
      samples[(start + i) % samples.count] += Int32(input[i])
    }
    end = max(end, start + count)
  }

  func drain(at time: Double) {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped, let origin else { return }
    // 入力コールバックの到着差を250ms吸収し、100msずつ送ります。
    let frame = max(0, Int((time - origin - 0.25) * 16000))
    publish(through: frame / 1600 * 1600)
  }

  private func publish(through frame: Int) {
    while cursor < frame {
      let count = min(1600, frame - cursor)
      let buffer = AVAudioPCMBuffer(pcmFormat: output.target, frameCapacity: AVAudioFrameCount(count))!
      buffer.frameLength = AVAudioFrameCount(count)
      let mixed = buffer.int16ChannelData![0]
      for i in 0..<count {
        let index = (cursor + i) % samples.count
        mixed[i] = Int16(clamping: samples[index] / 2)
        samples[index] = 0
      }
      cursor += count
      output.publish(buffer)
    }
  }

  func finish() {
    lock.lock()
    defer { lock.unlock() }
    guard !stopped else { return }
    timer.cancel()
    publish(through: end)
    stopped = true
  }
}
final class SystemCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  var stream: SCStream?
  private let stopLock = NSLock()
  private var stopping = false
  let output = PcmOutput()
  func start(parentPID: Int32) async throws {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: false)
    guard let display = content.displays.first else { fail("システム音声を取得するディスプレイがありません。") }
    let excluded = content.applications.filter {
      $0.processID == parentPID || $0.processID == getpid()
        || $0.bundleIdentifier == "jp.ledad.desktop"
    }
    let filter = SCContentFilter(
      display: display, excludingApplications: excluded, exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.capturesAudio = true
    config.excludesCurrentProcessAudio = true
    config.sampleRate = 16000
    config.channelCount = 1
    config.width = 2
    config.height = 2
    config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    let stream = SCStream(filter: filter, configuration: config, delegate: self)
    try stream.addStreamOutput(
      self, type: .audio, sampleHandlerQueue: DispatchQueue(label: "ledad.audio"))
    self.stream = stream
    try await stream.startCapture()
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    if stopLock.withLock({ stopping }) { return }
    fail("システム音声の取得が終了しました。権限と入力元を確認して再開してください。")
  }
  func stop() async throws {
    stopLock.withLock { stopping = true }
    try await stream?.stopCapture()
    output.finish()
  }
  func stream(
    _ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer,
    of type: SCStreamOutputType
  ) {
    guard type == .audio, sampleBuffer.isValid,
      let description = CMSampleBufferGetFormatDescription(sampleBuffer),
      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(description),
      let format = AVAudioFormat(streamDescription: asbd)
    else { return }
    let count = CMSampleBufferGetNumSamples(sampleBuffer)
    guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))
    else { return }
    buffer.frameLength = AVAudioFrameCount(count)
    let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
      sampleBuffer, at: 0, frameCount: Int32(count), into: buffer.mutableAudioBufferList)
    if status == noErr {
      let hostClock = CMClockGetHostTimeClock()
      let time = CMSyncConvertTime(
        sampleBuffer.presentationTimeStamp, from: stream.synchronizationClock ?? hostClock, to: hostClock)
      output.send(buffer, at: CMTimeGetSeconds(time))
    }
  }
}
// 開始・構成変更・終了をMainActorで直列化し、停止後の通知では再開しません。
@MainActor
final class MicrophoneCapture {
  private let engine = AVAudioEngine()
  private let output: PcmOutput
  private let bufferSize: AVAudioFrameCount
  private var observer: NSObjectProtocol?
  private var tapInstalled = false

  init(output: PcmOutput, bufferSize: AVAudioFrameCount) {
    self.output = output
    self.bufferSize = bufferSize
  }

  func start() throws {
    // Voice ProcessingのDiscrete配列は自動変換で無音になるため、マイクの先頭chを指定します。
    output.channelMap = [0]
    let input = engine.inputNode
    try? input.setVoiceProcessingEnabled(true)
    if input.isVoiceProcessingEnabled {
      input.isVoiceProcessingAGCEnabled = true
      input.voiceProcessingOtherAudioDuckingConfiguration = .init(
        enableAdvancedDucking: false, duckingLevel: .min)
    }
    observer = NotificationCenter.default.addObserver(
      forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
    ) { [weak self] _ in
      // CoreAudioの通知スレッド内でエンジンを操作しないよう、MainActorへ渡します。
      Task { @MainActor in
        guard let self, self.observer != nil, !self.engine.isRunning else { return }
        do { try self.startEngine() }
        catch { fail("マイクを開始できません。ほかのアプリの使用状況を確認してください。") }
      }
    }
    try startEngine()
  }

  private func startEngine() throws {
    let input = engine.inputNode
    if tapInstalled {
      input.removeTap(onBus: 0)
      tapInstalled = false
    }
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      fail("マイクを利用できません。入力デバイスを確認してください。")
    }
    if #available(macOS 27.0, *) {
      try input.installAudioTap(onBus: 0, bufferSize: bufferSize, format: format) { [output] buffer, time in
        output.send(buffer, at: time.isHostTimeValid ? AVAudioTime.seconds(forHostTime: time.hostTime) : nil)
      }
    } else {
      input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { [output] buffer, time in
        output.send(buffer, at: time.isHostTimeValid ? AVAudioTime.seconds(forHostTime: time.hostTime) : nil)
      }
    }
    tapInstalled = true
    try engine.start()
  }

  func stop() {
    if let observer { NotificationCenter.default.removeObserver(observer) }
    observer = nil
    engine.stop()
    if tapInstalled { engine.inputNode.removeTap(onBus: 0) }
    tapInstalled = false
    output.finish()
  }
}
let args = CommandLine.arguments
let source = args.count > 1 ? args[1] : "microphone"
let appleLanguage = args.count > 3 ? args[3] : ""
let output = PcmOutput()
let mixer = source == "mixed" ? PcmMixer(output: output) : nil
let microphoneOutput = source == "mixed" ? PcmOutput() : output
var systemCapture: SystemCapture?
var microphoneCapture: MicrophoneCapture?
Task { @MainActor in
  var finishTranscription: (() async throws -> Void)?
  if !appleLanguage.isEmpty {
    guard #available(macOS 26.0, *) else {
      fail("Apple SpeechTranscriberはこのmacOSでは利用できません。Geminiを選んでください。")
    }
    do {
      let transcriber = try await AppleTranscriber.start(language: appleLanguage)
      output.onBuffer = { transcriber.append($0) }
      finishTranscription = { try await transcriber.finish() }
    } catch { fail("Appleの言語モデルを準備できませんでした。接続を確認して再試行してください。") }
  }
  if source != "display" {
    let authorized = await AVCaptureDevice.requestAccess(for: .audio)
    guard authorized else { fail("マイクの許可がありません。システム設定のプライバシーとセキュリティでマイクを許可してください。") }
  }
  if source != "microphone" {
    systemCapture = SystemCapture()
    systemCapture!.output.onBuffer = output.onBuffer
    systemCapture!.output.mixer = mixer
    do { try await systemCapture!.start(parentPID: args.count > 2 ? Int32(args[2]) ?? 0 : 0) } catch
    { fail("システム音声を取得できません。システム設定の「画面収録とシステムオーディオ録音」でledadを許可してください。") }
  }
  if source != "display" {
    microphoneOutput.mixer = mixer
    let microphone = MicrophoneCapture(
      output: microphoneOutput,
      bufferSize: source == "mixed" ? 1024 : (appleLanguage.isEmpty ? 4096 : 2048))
    microphoneCapture = microphone
    do { try microphone.start() }
    catch { fail("マイクを開始できません。ほかのアプリの使用状況を確認してください。") }
  }
  emit(["type": "ready"])
  let finish = finishTranscription
  DispatchQueue.global().async {
    guard readLine() == "finish" else { return }
    Task(priority: .userInitiated) { @MainActor in
      do {
        if let systemCapture {
          try await systemCapture.stop()
        }
        microphoneCapture?.stop()
        mixer?.finish()
        output.finish()
        try await finish?()
        emit(["type": "finished"])
        exit(0)
      } catch { fail("音声の終了処理に失敗しました。表示済みの会話は残しています。") }
    }
  }
}
RunLoop.main.run()
