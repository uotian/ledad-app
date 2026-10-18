# 05.25 Live Translate（途中翻訳）

[Transcribe / Transcript](20-transcribe.md)

途中原文の全文を翻訳します。同時に一要求だけ送信し、待機中の更新は最新の全文へまとめます。

Live原文の確定時は、同じ発言・翻訳先の表示済みの訳と処理中の訳を暫定表示へ引き継ぎます。全文確定に加え、訳の元原文が確定原文の先頭部分に一致する場合も引き継ぎ、確定翻訳の到着まで保持します。確定範囲を超える全文訳や別発言・別言語の訳は引き継ぎません。暫定訳は保存データには混ぜません。

## 基本情報

| 設定                     | 値                                                                                |
| ------------------------ | --------------------------------------------------------------------------------- |
| API                      | OpenAI Responses                                                                  |
| モデル                   | `OPENAI_MODEL`（既定`gpt-6-luna`）                                                |
| `reasoning.effort`       | `none`                                                                            |
| `store`                  | `false`                                                                           |
| 処理名                   | `transcript_preview`                                                              |
| タイムアウト / SDK再試行 | 60秒 / `max_retries: 0`                                                           |
| キャッシュ               | [共通条件](00-overview.md#明示キャッシュの共通条件)に従い、明示キャッシュ（30分） |

## 入力

[preview.txt](../../../backend/ledad/ai/prompts/preview.txt)と次のJSONを渡します。

| キー             | 内容                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `text`           | [Live / Gemini](21-live-gemini.md#出力)・[Live / Apple](22-live-apple.md#出力)の途中原文の全文                           |
| `targetLanguage` | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「翻訳先の言語」。`日本語 / English / 简体中文`へ変換 |
| `glossary`       | [用語集](28-glossary.md)のドキュメント・会話分析由来の語                                                                                   |
| `context`        | 保存済み[Transcript](../06-data/01-schema.md#主な子モデル)の`text`。末尾3件                                              |
| `previous`       | 直前に表示した原文`text`と[Live Translate](25-live-translate.md#出力)の`translation`。初回はnull                         |

### 指示の要点

指示は「差分ではなく全文を返す」「追加だけなら既訳の完了文をそのまま再利用する」「認識訂正・誤訳時は該当部分を修正する」です。未完の続きを補完せず、参考文脈や用語集の情報を訳文へ追加しません。原文全体が翻訳先言語なら空文字、複数言語が混在する場合は全文の訳を返します。

### 入力配置とキャッシュ

指示文をdeveloper content、固定キー（`targetLanguage`, `glossary`, `context`）をuser contentの前方、残りの入力を後方に置きます。

キャッシュ境界は[共通条件](00-overview.md#明示キャッシュの共通条件)を参照してください。

## 出力

構造化JSONで返します。

`{translation}`。Backendが`usageId`を付けて返します。

実装：[入力](../../../backend/ledad/ai/tasks.py)、[API設定](../../../backend/ledad/ai/openai.py)、[キャッシュ](../../../backend/ledad/ai/cache.py)。
