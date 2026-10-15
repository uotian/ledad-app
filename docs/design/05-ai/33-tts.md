# 05.33 TTS（読み上げ）

[AI Overview](00-overview.md) / [Ask](32-ask.md)

本人が再生を選んだ発言文を音声化します。Frontendで句読点・改行ごとに分け、長い区間は最大280文字で分割し、区間ごとに生成・再生します。

## 基本情報

| 項目                              | 内容                                                |
| --------------------------------- | --------------------------------------------------- |
| API                               | Gemini Interactions                                 |
| モデル                            | `GEMINI_TTS_MODEL`、既定`gemini-3.8-flash-lite-tts` |
| `generation_config.speech_config` | `[{voice: 入力の声}]`                               |
| `store`                           | `false`                                             |
| API・期限                         | `v1beta`、1区間のリクエスト・処理とも60秒           |
| SDK再試行                         | Interactionsの`max_retries: 0`                      |

## 入力

[Ask](32-ask.md#発言案)の`candidates[].spokenText`（編集した場合は編集後の本文）を区間分割し、speech metadataを付けます。

| 項目 | 内容                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| 本文 | [Ask](32-ask.md#発言案)の`spokenText`から切り出した区間                                                                          |
| 言語 | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」                                                |
| 声   | [アプリ設定](../02-frontend/01-layout/01.01-setting.md#一般設定)の「読み上げ音声」。端末の設定を会議保存値より優先し、既定はKore |

本文は`input[].content[].text`に渡します。Backendの入力上限は1要求4,000文字です。

## 読み上げの指示

本文に付ける`annotations`の`type: speech_metadata`・`style`で指定します。独立したsystem promptは使いません。

```text
{言語}。落ち着いた明瞭な会議の発言。入力された文章をそのまま読む。
```

`{言語}`は「会議の言語」を`日本語 / English / 普通话`へ変換した値です。

## 出力

`response_format: {type: audio}`で音声を返します。

`output_audio.data`をBase64デコードし、`mime_type`（なければ`audio/wav`）とともに返します。

実装：[GeminiProvider.speech](../../../backend/ledad/ai/gemini.py)、[MeetingSpeaker](../../../src/lib/audio/speaker.ts)、[区間分割](../../../src/lib/audio/speech.ts)、[入力検証](../../../backend/ledad/transport/requests.py)。
