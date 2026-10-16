# 05.26 Transcript Translate（確定翻訳）

[Transcribe / Transcript](20-transcribe.md)

Liveで確定した発言・手入力の発言・Fixで再認識した原文の全文を翻訳します。

## 基本情報

| 設定                     | 値                                                                                |
| ------------------------ | --------------------------------------------------------------------------------- |
| API                      | OpenAI Responses                                                                  |
| モデル                   | `OPENAI_MODEL`（既定`gpt-6-luna`）                                                |
| `reasoning.effort`       | `none`                                                                            |
| `store`                  | `false`                                                                           |
| 処理名                   | `transcript_translation`                                                          |
| タイムアウト / SDK再試行 | 60秒 / `max_retries: 0`                                                           |
| キャッシュ               | [共通条件](00-overview.md#明示キャッシュの共通条件)に従い、明示キャッシュ（30分） |

## 入力

[translation.txt](../../../backend/ledad/ai/prompts/translation.txt)と次のJSONを渡します。

| キー                  | 内容                                                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `text`                | [Live](20-transcribe.md)の確定原文・手入力、または[Fix / OpenAI](23-fix-openai.md#出力)・[Fix / Gemini](24-fix-gemini.md#出力)の原文全体 |
| `precedingContext`    | 保存済み[Transcript](../06-data/01-schema.md#主な子モデル)の`text`。通常は末尾5件、Fix後は空配列                                         |
| `translationLanguage` | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「翻訳先の言語」。`日本語 / English / 简体中文`へ変換                 |
| `glossary`            | [用語集](28-glossary.md)のドキュメント・会話分析由来の語                                                                                                   |

### 指示の要点

参考文脈との重複があってもtext全体を翻訳し、要約・省略・推測による補完をしません。text全体が翻訳先言語の場合だけ空文字を許容し、混在する場合は全体を指定言語で読めるようにします。

### 入力配置とキャッシュ

指示文をdeveloper content、固定キー（`translationLanguage`, `glossary`, `precedingContext`）をuser contentの前方、残りの入力を後方に置きます。

キャッシュ境界は[共通条件](00-overview.md#明示キャッシュの共通条件)を参照してください。

## 出力

構造化JSONで返します。

`{translation}`。Fix後は[Fix共通制御](20-transcribe.md#fixの共通制御)の期限・再試行に含まれます。

実装：[入力](../../../backend/ledad/ai/tasks.py)、[Fixの呼び出し](../../../backend/ledad/ai/refinement.py)、[API設定](../../../backend/ledad/ai/openai.py)。
