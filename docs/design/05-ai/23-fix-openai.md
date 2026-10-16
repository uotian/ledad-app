# 05.23 Fix / OpenAI

[Transcribe / Transcript](20-transcribe.md)

録音をOpenAI Audio Transcriptions APIで再認識します。自然言語のpromptは設定せず、録音・言語・用語のヒントだけを渡します。

## 基本情報

| 項目         | 内容                                     |
| ------------ | ---------------------------------------- |
| API          | OpenAI Audio Transcriptions              |
| モデル       | `OPENAI_STT_MODEL`、既定`gpt-transcribe` |
| タイムアウト | クライアント60秒、Fix全体90秒            |
| SDK再試行    | `max_retries: 0`                         |

## 入力

| 項目        | 内容                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `file`      | `recording.wav`、16kHz・モノラル・16bit WAV、`audio/wav`                                                                              |
| `languages` | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」。`ja / en / zh / fr`の1要素配列をSDKの`extra_body`で指定 |
| `keywords`  | [認識用の用語集](28-glossary.md)。送信前に`<`・`>`・CR・LFを含む語を除外し、空なら省略。`extra_body`で指定                      |

## 出力

返り値は`response.text`です。再認識後の翻訳・期限・再試行は[Fix共通制御](20-transcribe.md#fixの共通制御)を参照してください。

実装：[OpenAIProvider.transcribe](../../../backend/ledad/ai/openai.py)、[WAV変換](../../../backend/ledad/ai/audio.py)。
