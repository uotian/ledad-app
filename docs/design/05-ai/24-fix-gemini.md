# 05.24 Fix / Gemini

[Transcribe / Transcript](20-transcribe.md)

録音をGemini Interactions APIで再認識します。自然言語のpromptはなく、音声入力と専用のtranscription設定を渡します。

## 基本情報

| 項目                                          | 内容                                                |
| --------------------------------------------- | --------------------------------------------------- |
| API                                           | Gemini Interactions                                 |
| モデル                                        | `GEMINI_FIX_STT_MODEL`、既定`gemini-3.5-transcribe` |
| `generation_config.transcription_config.mode` | `smart`                                             |
| `store`                                       | `false`                                             |
| API・タイムアウト                             | `v1beta`、リクエスト60秒、Fix全体90秒               |
| SDK再試行                                     | Interactionsの`max_retries: 0`                      |

## 入力

| 項目                                                       | 内容                                                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `input`                                                    | `[{type: audio, data: Base64 WAV, mime_type: audio/wav}]`                                                                         |
| `generation_config.transcription_config.language_codes`    | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」を`ja-JP / en-US / cmn-Hans-CN`の1要素配列へ変換 |
| `generation_config.transcription_config.custom_vocabulary` | [Document](10-document.md)の`glossary`。空なら省略                                                                                |

## 出力

返り値は`response.output_text`です。再認識後の翻訳・期限・再試行は[Fix共通制御](20-transcribe.md#fixの共通制御)を参照してください。

実装：[GeminiProvider.transcribe / record_interaction](../../../backend/ledad/ai/gemini.py)。
