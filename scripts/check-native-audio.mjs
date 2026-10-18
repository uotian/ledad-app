// Run on macOS 27+ with Xcode 27: node scripts/check-native-audio.mjs
// Add --microphone to verify recovery on the default microphone (existing permission required).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const source = await readFile('native/AudioCapture.swift', 'utf8');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const target = `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos${config.bundle.macOS.minimumSystemVersion}`;
const flags = ['-target', target, '-warnings-as-errors'];
execFileSync('swiftc', ['-typecheck', ...flags, 'native/AudioCapture.swift'], {
  stdio: 'inherit',
});
const directory = await mkdtemp(join(tmpdir(), 'ledad-audio-check-'));
assert.ok(source.includes('let args = CommandLine.arguments'), 'Native entry point not found');
try {
  const file = join(directory, 'main.swift');
  const executable = join(directory, 'check');
  await writeFile(
    file,
    source.slice(0, source.indexOf('let args = CommandLine.arguments')) +
      `
final class FinishState: @unchecked Sendable {
  let lock = NSLock()
  var finalizationCompleted = false
  var resultsCompleted = false
}

@available(macOS 26.0, *)
extension AppleTranscriber {
  static func checkFinishOrdering() async throws {
    let (sequence, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let (analysis, endAnalysis) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let analyzer = SpeechAnalyzer(modules: [])
    try await analyzer.start(inputSequence: analysis)
    let transcriber = AppleTranscriber(input: input, analyzer: analyzer)
    let (hold, release) = AsyncStream.makeStream(of: Bool.self)
    let (results, releaseResults) = AsyncStream.makeStream(of: Bool.self)
    let (closed, signalClosed) = AsyncStream.makeStream(of: Bool.self)
    let state = FinishState()
    input.onTermination = { _ in
      state.lock.withLock { assert(state.finalizationCompleted, "Do not end input before pending finalization") }
      signalClosed.yield(true)
      signalClosed.finish()
    }
    transcriber.finalizationTask = Task {
      for await _ in hold {}
      state.lock.withLock { state.finalizationCompleted = true }
    }
    transcriber.resultsTask = Task {
      for await _ in results {}
      state.lock.withLock { state.resultsCompleted = true }
    }
    let finish = Task {
      try await transcriber.finish()
      state.lock.withLock { assert(state.resultsCompleted, "Finish must await final recognition results") }
    }
    while !transcriber.queue.sync(execute: { transcriber.finishing }) { await Task.yield() }
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1600)!
    buffer.frameLength = 1600
    transcriber.append(buffer)
    transcriber.queue.sync { assert(transcriber.frames == 0, "Reject audio while finishing, not just afterwards") }
    endAnalysis.finish()
    release.finish()
    for await _ in closed {}
    releaseResults.finish()
    try await finish.value
    _ = sequence
  }

  static func checkOverflow() {
    let (sequence, input) = AsyncStream.makeStream(
      of: AnalyzerInput.self, bufferingPolicy: .bufferingOldest(1))
    let transcriber = AppleTranscriber(input: input, analyzer: SpeechAnalyzer(modules: []))
    let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1600)!
    buffer.frameLength = 1600
    transcriber.append(buffer)
    transcriber.append(buffer)
    transcriber.queue.sync {}
    withExtendedLifetime(sequence) { fatalError("Overflow must be reported, never silently dropped") }
  }

  static func checkBoundaries() async throws {
    let (sequence, input) = AsyncStream.makeStream(of: AnalyzerInput.self)
    let analyzer = SpeechAnalyzer(modules: [])
    // Recognition is not needed to exercise the scheduling and stop lifecycle.
    let (analysis, endAnalysis) = AsyncStream.makeStream(of: AnalyzerInput.self)
    try await analyzer.start(inputSequence: analysis)
    _ = sequence
    let transcriber = AppleTranscriber(input: input, analyzer: analyzer)
    let format = AVAudioFormat(
      commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)!
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 16000)!
    buffer.frameLength = 16000
    buffer.int16ChannelData![0].initialize(repeating: 0, count: 16000)
    for _ in 0..<14 { transcriber.append(buffer) }
    transcriber.queue.sync { assert(transcriber.boundaryFrames == 0) }
    transcriber.recordFinalization(through: 7)
    transcriber.recordFinalization(through: .infinity)
    transcriber.recordFinalization(through: -1)
    for _ in 0..<7 { transcriber.append(buffer) }
    transcriber.queue.sync { assert(transcriber.boundaryFrames == 7 * 16000) }

    let (hold, release) = AsyncStream.makeStream(of: Bool.self)
    let pending = Task { for await _ in hold {} }
    transcriber.queue.sync { transcriber.finalizationTask = pending }
    transcriber.append(buffer)
    transcriber.queue.sync {
      assert(transcriber.boundaryFrames == 7 * 16000, "Do not overlap finalizations")
    }
    release.finish()
    await pending.value
    transcriber.queue.sync { transcriber.finalizationTask = nil }
    transcriber.append(buffer)
    let first = transcriber.queue.sync {
      assert(transcriber.boundaryFrames == 23 * 16000, "Finalize after 15 seconds without a boundary")
      return transcriber.finalizationTask
    }
    await first?.value
    transcriber.queue.sync {}
    for _ in 0..<14 { transcriber.append(buffer) }
    transcriber.queue.sync { assert(transcriber.boundaryFrames == 23 * 16000) }
    transcriber.append(buffer)
    transcriber.queue.sync { assert(transcriber.boundaryFrames == 38 * 16000) }
    endAnalysis.finish()
    try await transcriber.finish()
    transcriber.append(buffer)
    transcriber.queue.sync {
      assert(transcriber.finishing)
      assert(transcriber.frames == 38 * 16000, "Ignore audio after finishing")
    }
  }
}

extension PcmMixer {
  static func checkDelayRecovery() {
    let output = PcmOutput()
    var received: [Int16] = []
    output.onBuffer = { buffer in
      received.append(contentsOf: UnsafeBufferPointer(start: buffer.int16ChannelData![0], count: Int(buffer.frameLength)))
    }
    let mixer = PcmMixer(output: output)
    mixer.timer.cancel()
    let buffer = AVAudioPCMBuffer(pcmFormat: output.target, frameCapacity: 1600)!
    buffer.frameLength = 1600
    buffer.int16ChannelData![0].initialize(repeating: 20000, count: 1600)
    mixer.append(buffer, at: 1000)
    mixer.drain(at: 1000.56)
    assert(received.count == 4800)
    if CommandLine.arguments.contains("--mix-too-late") {
      mixer.append(buffer, at: 997)
      fatalError("Severely late audio must fail")
    }
    if CommandLine.arguments.contains("--mix-too-far") {
      mixer.append(buffer, at: 1005)
      fatalError("Large timestamp jumps must fail")
    }
    mixer.append(buffer, at: 1000.1)
    assert(received.count == 4800, "Fully late audio must not rewind or duplicate output")
    mixer.append(buffer, at: 1000.25)
    mixer.append(buffer, at: 1000.35)
    mixer.drain(at: 1000.76)
    assert(received.count == 8000)
    assert(received[4800..<7200].allSatisfy { $0 == 10000 }, "Retain the unsent part of a late buffer")
    assert(received[7200..<8000].allSatisfy { $0 == 0 })
    // Fill the ring while the timer is delayed; appends must make room without loss.
    for chunk in 5..<29 { mixer.append(buffer, at: 1000 + Double(chunk) / 10) }
    mixer.finish()
    assert(received.count == 29 * 1600)
    assert(received[8000...].allSatisfy { $0 == 10000 }, "Catch-up must preserve buffered samples")
    mixer.append(buffer, at: 1003)
    assert(received.count == 29 * 1600)
    emit(["type": "checked", "recovery": true])
  }

  static func checkMixing() {
    let output = PcmOutput()
    var received: [Int16] = []
    output.onBuffer = { buffer in
      received.append(contentsOf: UnsafeBufferPointer(start: buffer.int16ChannelData![0], count: Int(buffer.frameLength)))
    }
    let mixer = PcmMixer(output: output)
    mixer.timer.cancel()
    let buffer = AVAudioPCMBuffer(pcmFormat: output.target, frameCapacity: 1600)!
    buffer.frameLength = 1600
    buffer.int16ChannelData![0].initialize(repeating: 20000, count: 1600)
    mixer.append(buffer, at: 1000)
    mixer.append(buffer, at: 1000.05)
    mixer.drain(at: 1000.36)
    assert(received.count == 1600, "Mixing must not double the audio duration")
    assert(received.prefix(800).allSatisfy { $0 == 10000 })
    assert(received.suffix(800).allSatisfy { $0 == 20000 }, "Overlapping speech must not clip")
    mixer.drain(at: 1000.56)
    assert(received.count == 4800, "A silent source must not stall the clock")
    assert(received[1600..<2400].allSatisfy { $0 == 10000 })
    assert(received[2400..<4800].allSatisfy { $0 == 0 })
    // Exercise ring reuse and the final partial buffer without a timer race.
    for chunk in 3..<24 {
      mixer.append(buffer, at: 1000 + Double(chunk) / 10)
      mixer.drain(at: 1000 + Double(chunk) / 10 + 0.36)
    }
    buffer.frameLength = 800
    mixer.append(buffer, at: 1002.4)
    mixer.finish()
    assert(received.count == 24 * 1600 + 800, "Finish must retain the queued tail")
    assert(received[4800...].allSatisfy { $0 == 10000 }, "Old samples must not leak after ring reuse")
    mixer.append(buffer, at: 1002.5)
    mixer.finish()
    assert(received.count == 24 * 1600 + 800, "Ignore input after finish")
  }
}

extension MicrophoneCapture {
  static func checkRecovery() async throws {
    guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
      fatalError("Microphone check requires existing microphone permission")
    }
    let output = PcmOutput()
    let lock = NSLock()
    var buffers = 0
    output.onBuffer = { _ in lock.withLock { buffers += 1 } }
    let microphone = MicrophoneCapture(output: output, bufferSize: 1024)
    try microphone.start()
    for attempt in 0..<6 {
      let before = lock.withLock { buffers }
      if attempt > 0 {
        microphone.engine.stop()
        for _ in 0..<3 {
          NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: microphone.engine)
        }
      }
      for _ in 0..<40 {
        if lock.withLock({ buffers > before }) { break }
        try await Task.sleep(for: .milliseconds(100))
      }
      assert(microphone.engine.isRunning && lock.withLock { buffers > before }, "Input must recover after configuration change")
    }
    microphone.stop()
    let stoppedCount = lock.withLock { buffers }
    NotificationCenter.default.post(name: .AVAudioEngineConfigurationChange, object: microphone.engine)
    try await Task.sleep(for: .milliseconds(300))
    assert(!microphone.engine.isRunning && lock.withLock { buffers == stoppedCount }, "Late notifications must not restart a stopped microphone")
  }
}

if CommandLine.arguments.contains("--apple-overflow") {
  if #available(macOS 26.0, *) { AppleTranscriber.checkOverflow() }
} else if CommandLine.arguments.contains("--missing-timestamp") {
  let output = PcmOutput()
  output.mixer = PcmMixer(output: output)
  let buffer = AVAudioPCMBuffer(pcmFormat: output.target, frameCapacity: 1600)!
  buffer.frameLength = 1600
  buffer.int16ChannelData![0].initialize(repeating: 0, count: 1600)
  output.send(buffer)
  fatalError("Mixed audio without a timestamp must fail")
} else if CommandLine.arguments.contains(where: { $0.hasPrefix("--mix-") }) {
  PcmMixer.checkDelayRecovery()
} else if CommandLine.arguments.contains("--microphone") {
  Task { @MainActor in
    do {
      try await MicrophoneCapture.checkRecovery()
      emit(["type": "checked", "recoveries": 5])
      exit(0)
    } catch { fatalError("Microphone recovery check failed: \\(error)") }
  }
  RunLoop.main.run()
} else if #available(macOS 27.0, *) {
  let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
  let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
  buffer.frameLength = 4800
  for channel in 0..<2 {
    for frame in 0..<4800 { buffer.floatChannelData![channel][frame] = 0.1 }
  }
  let stopped = PcmOutput()
  stopped.onBuffer = { _ in fatalError("Stopped input must not publish late buffers") }
  stopped.finish()
  stopped.finish()
  stopped.send(buffer)
  stopped.send(AVReadOnlyAudioPCMBuffer(copying: buffer))
  PcmOutput().send(buffer)
  PcmOutput().send(AVReadOnlyAudioPCMBuffer(copying: buffer))
  // macOS Voice Processing can expose a discrete layout that maps to silence by default.
  let microphoneFormat = AVAudioFormat(
    commonFormat: .pcmFormatFloat32, sampleRate: 48000, interleaved: false,
    channelLayout: AVAudioChannelLayout(layoutTag: kAudioChannelLayoutTag_DiscreteInOrder | 7)!)
  let microphoneBuffer = AVAudioPCMBuffer(pcmFormat: microphoneFormat, frameCapacity: 4800)!
  microphoneBuffer.frameLength = 4800
  for channel in 0..<7 {
    microphoneBuffer.floatChannelData![channel].initialize(
      repeating: channel == 0 ? 0.1 : -0.3, count: 4800)
  }
  let microphone = PcmOutput()
  microphone.channelMap = [0]
  microphone.send(AVReadOnlyAudioPCMBuffer(copying: microphoneBuffer))
  PcmMixer.checkMixing()
  Task {
    do {
      try await AppleTranscriber.checkBoundaries()
      try await AppleTranscriber.checkFinishOrdering()
      exit(0)
    } catch { fatalError("Apple boundary check failed: \\(error)") }
  }
  RunLoop.main.run()
} else { fatalError("This check requires macOS 27 or later") }
`,
  );
  execFileSync('swiftc', [file, '-o', executable, ...flags], {
    stdio: 'inherit',
  });
  const events = execFileSync(executable, { encoding: 'utf8', timeout: 15000 })
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(events.length, 28);
  assert.deepEqual(events[1], events[0], 'New and legacy buffers must produce identical PCM');
  assert.deepEqual(
    events[2],
    events[0],
    'Discrete microphone channels must retain the microphone signal',
  );
  const event = events[1];
  assert.equal(event.type, 'audio');
  const pcm = Buffer.from(event.data, 'base64');
  // The resampler retains some frames while priming its first input buffer.
  assert.ok(pcm.length >= 2600 && pcm.length <= 3200, `Unexpected PCM byte count: ${pcm.length}`);
  assert.ok(Math.abs(pcm.readInt16LE(Math.floor(pcm.length / 4) * 2) - 3277) < 10);
  assert.ok(event.level > 0.45 && event.level < 0.55);
  console.log(
    'Native audio: warning-free macOS 14 target; microphone channel mapping and PCM match; timed mixing, silence, ring reuse, tail flush and Apple boundaries pass.',
  );
  const recovery = execFileSync(executable, ['--mix-recovery'], {
    encoding: 'utf8',
    timeout: 15000,
  })
    .trim()
    .split('\n')
    .map(JSON.parse);
  assert.equal(
    recovery.filter((event) => event.type === 'warning').length,
    0,
    'Late audio must be discarded without a warning',
  );
  assert.deepEqual(recovery.at(-1), { type: 'checked', recovery: true });
  for (const argument of ['--mix-too-late', '--mix-too-far']) {
    assert.throws(
      () => execFileSync(executable, [argument], { encoding: 'utf8', timeout: 15000 }),
      (error) =>
        error.status === 1 && JSON.parse(error.stdout.trim().split('\n').at(-1)).type === 'error',
    );
  }
  console.log(
    'Mixed audio: late/partial buffers, silent discard, timer catch-up and fatal bounds pass.',
  );
  for (const [argument, message] of [
    ['--apple-overflow', 'Appleの文字起こしが音声に追いつけませんでした。'],
    ['--missing-timestamp', '音声の時刻を取得できません。'],
  ]) {
    assert.throws(
      () => execFileSync(executable, [argument], { encoding: 'utf8', timeout: 15000 }),
      (error) => {
        if (error.status !== 1) return false;
        const event = JSON.parse(error.stdout.trim().split('\n').at(-1));
        return event.type === 'error' && event.message.startsWith(message);
      },
    );
  }
  console.log('Native shutdown: late PCM rejected; pending finalization and final results awaited; overflow and missing timestamp reported.');
  if (process.argv.includes('--microphone')) {
    const recoveryEvents = execFileSync(executable, ['--microphone'], {
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 4 * 1024 * 1024,
    })
      .trim()
      .split('\n')
      .map(JSON.parse);
    assert.deepEqual(recoveryEvents.at(-1), { type: 'checked', recoveries: 5 });
    assert.ok(recoveryEvents.some((event) => event.type === 'audio'));
    console.log(
      'Microphone: initial capture, 5 configuration-change recoveries and stop isolation pass.',
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
