# 05.21 Live / Gemini

[Transcribe / Transcript](20-transcribe.md)

Backendの`live-token`で一時トークンを取得し、FrontendのGoogle GenAI SDKからLiveへ直接接続します。自然言語のsystem promptは渡さず、文字起こし設定と音声を渡します。

## 基本情報

| 項目                                             | 内容                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| API                                              | Gemini Live                                                                                            |
| APIバージョン                                    | トークン発行・Live接続とも`v1beta`                                                                     |
| モデル                                           | `GEMINI_STT_MODEL`、既定`gemini-3.5-transcribe-live`                                                   |
| `responseModalities`                             | `[TEXT]`                                                                                               |
| `realtimeInputConfig.automaticActivityDetection` | `disabled: false`、`silenceDurationMs`は下記の無音時間                                                 |
| 無音時間                                         | [会議設定](../02-frontend/02-home/02-meeting-setting.md#詳細設定)の「発話区切りの無音時間」。既定100ms |
| 一時トークン                                     | `uses: 1`、失効30分、新規接続開始期限1分、model/configを制約                                           |

VAD境界から15秒分の音声が続いたら`audioStreamEnd: true`を送ります。9分ごと、または`goAway`受信時に接続を更新します。接続待ちは15秒、旧接続の末尾待ちは1.5秒、更新中の音声保持は最大20秒分です。

## 入力

| 項目                                       | 内容                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `inputAudioTranscription.languageCodes`    | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」を`ja-JP / en-US / cmn-Hans-CN`へ変換 |
| `inputAudioTranscription.customVocabulary` | 接続時点の[Document](10-document.md)の`glossary`。空なら省略                                                           |
| 音声                                       | `sendRealtimeInput`の`audio: {data: Base64 PCM, mimeType: audio/pcm;rate=16000}`                                       |

用語集の変更は次回接続から反映します。

## 出力

途中・確定の認識テキストです。

実装：[GeminiProvider.live_token](../../../backend/ledad/ai/gemini.py)、[LiveTranscription](../../../src/lib/audio/live-transcription.ts)、[Listener](../../../src/lib/audio/listener.ts)。
