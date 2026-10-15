# 05.22 Live / Apple

[Transcribe / Transcript](20-transcribe.md)

macOS 26以降のNativeでSpeechTranscriberを使います。外部LLMへのプロンプトはなく、会議の言語と音声だけを渡します。必要な言語アセットは利用開始時に取得します。

## 基本情報

| 項目                   | 内容                                                      |
| ---------------------- | --------------------------------------------------------- |
| API                    | Apple SpeechTranscriber                                   |
| `transcriptionOptions` | `[]`                                                      |
| `reportingOptions`     | `[.volatileResults, .fastResults]`                        |
| `attributeOptions`     | `[]`                                                      |
| SpeechDetector         | `sensitivityLevel: .high`, `reportResults: false`         |
| SpeechAnalyzer         | `priority: .userInitiated`, `modelRetention: .whileInUse` |

最終確定位置から15秒分の音声が続いたら`finalize(through: nil)`を呼び、停止時は末尾まで確定して待ちます。

## 入力

| 項目   | 内容                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| locale | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」から`supportedLocale(equivalentTo:)`で対応localeを取得 |
| 音声   | 16kHz・モノラル・Int16・interleaved                                                                                                     |

## 出力

途中結果の訂正と確定を扱うため、NativeからFrontendへ次を返します。

| 項目               | 用途                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- |
| `text`             | 認識した本文                                                                                         |
| `final`            | この結果が確定済みかどうか                                                                           |
| `start` / `end`    | 音声内の対象区間（秒）。同じ区間の途中結果を置き換え、発言時刻とFixの区切りに使う                    |
| `finalizedThrough` | この時点まで訂正されないことを示す位置（秒）。保持中の途中結果も、その末尾がこの位置以前なら確定する |

実装：[AppleTranscriber](../../../native/AudioCapture.swift)、[Native capture](../../../src/lib/audio/native-capture.ts)。
