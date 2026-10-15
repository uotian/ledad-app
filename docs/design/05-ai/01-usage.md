# 05.01 Usage（利用記録・API詳細・概算料金）

[AI](00-overview.md) / [利用履歴の画面](../02-frontend/03-meeting/01.02-api-history.md)

## 保存する情報

| 種類     | 内容                                                               | 会議削除時             |
| -------- | ------------------------------------------------------------------ | ---------------------- |
| 利用台帳 | プロバイダー・モデル・処理・会議ID・状態・時刻・使用量・エラー分類 | 会議外の`usage/`に残す |
| API詳細  | リクエスト・応答・エラー本文。会話・資料・生成文を含み得る         | 会議に属する詳細を削除 |
| 診断ログ | 表示したエラー・発生箇所・処理段階・プロバイダーの理由             | 会議ファイルと別に管理 |

- API詳細は既知の秘密鍵・認証情報をマスクし、バイナリ本体を省きます。
- 会話本文は匿名化・暗号化せず保存します。
- 保存前に会議の存在を確認し、削除済みなら詳細を保存しません。

本文の保持期間・保存条件・利用者への説明は[Q-04](../99_課題.md)で検討します。

## 状態と概算料金

- 状態は`running / completed / failed / cancelled`。使わなかった完了済み翻訳には`unused: true`を付けます。
- 未取得の使用量は`null`とし、ゼロと区別します。
- 会議の単価スナップショットと使用量から概算し、利用履歴APIの`yen`へ付けます。算出できない場合は`null`です。
- 単価は会議開始時、または準備中の初回資料生成前に保存します。

## 台帳のフィールド

| 区分       | 保存項目（JSON名）                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------- |
| 識別       | `id`, `sessionId`, `provider`, `operation`, `model`, `providerRequestId`                            |
| 状態・時刻 | `status`, `startedAt`, `endedAt`, `unused`                                                          |
| トークン   | `inputTokens`, `outputTokens`, `cachedTokens`, `cacheWriteTokens`, `reasoningTokens`, `totalTokens` |
| 音声・文字 | `audioInputSeconds`, `audioOutputSeconds`, `inputCharacters`                                        |
| エラー     | `errorCode`, 取得可能なら`errorDetails`（理由・利用枠等）                                           |
| Live報告   | `liveReports: [{at, inputTokens, outputTokens, totalTokens}]`                                       |

台帳は`<dataDir>/usage/<id>.json`、会議に属する本文は`<dataDir>/sessions/<sessionId>/usage-details/<id>.json`です。本文には`request / response / error`を保存します。プロンプト本文・入力JSON・明示したAPIパラメータはrequest、出力・プロバイダー使用量はresponseで確認できます。

OpenAIの構造化応答は、出力が不正でも取得できた使用量を残します。OpenAI Fixは現行コードで応答トークンを転記しないため、未取得値を残します。Gemini Interactionsは返された使用量を転記します。Apple Liveは外部API台帳の対象外です。

## 処理名の対応

| `operation`                                    | 用途                                                            |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `document_preparation`                         | [Document](10-document.md)                                      |
| `live_token`, `live_transcription`             | [Gemini Live](21-live-gemini.md)のトークン発行／接続            |
| `file_transcription`                           | [OpenAI Fix](23-fix-openai.md) / [Gemini Fix](24-fix-gemini.md) |
| `transcript_preview`                           | [Live翻訳](25-live-translate.md)                                |
| `transcript_translation`                       | [確定翻訳](26-transcript-translate.md)                          |
| `meeting_analyze`                              | [Analyze](30-analyze.md)                                        |
| `meeting_consultation`                         | [Chat](31-chat.md)                                              |
| `meeting_candidates`, `candidate_confirmation` | [Ask](32-ask.md)の候補／確認訳                                  |
| `speech`                                       | [TTS](33-tts.md)                                                |
| `meeting_minutes`                              | [Summarize](34-summarize.md)                                    |

Gemini Liveは5秒ごとと接続終了時に状態・累積音声秒数・報告を保存します。受信メッセージはバイナリを除いて最大2,000件かつ合計2,000,000文字までAPI詳細へ保持し、超過は`liveMessagesTruncated`で示します。usage metadataの報告値を接続全体の請求トークン数と見なして加算しません。

実装：[UsageRecord・保存](../../../backend/ledad/storage/usage.py)、[本文マスク](../../../backend/ledad/storage/api_details.py)、[LiveUsage](../../../src/lib/audio/live-usage.ts)、[処理名の表示順](../../../src/lib/usage/operations.ts)。

`mention_detection`（Decisions）と`meeting_mentions`（Responses）は[@You](35-mentions.md)の独立した利用記録です。Decisionsは入力のみ課金し、通常Lunaの出力・キャッシュ単価を適用しません。
