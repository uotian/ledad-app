# 06.01 データスキーマ

[Data](00-overview.md) / [関連](02-relations.md) / [保存](03-persistence.md)

`Session`を会議の記録全体の保存単位とし、FrontendとBackendで同じデータ形式を使います。

- 通信・保存JSONの項目名はcamelCaseです。
- 型定義はFrontendとBackendで手動同期します。
- 項目の省略・null・既定値・列挙値・上限・旧形式の読み込みを両側で揃えます。

## Sessionの構成

| 項目群         | 主な項目                                                                              | 意味                                                   |
| -------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 識別           | `id`, `shareToken`, `title`, `mode`                                                   | 会議の識別。`shareToken`はPUT時に既存値との一致を検証  |
| 状態           | `status`                                                                              | `preparing` / `active` / `ended`                       |
| 時刻           | `createdAt`, `updatedAt`, `startedAt`, `endedAt`, `meetingStartedAt`, `meetingLastAt` | 作成・記録更新、開始終了操作、会話の範囲を区別         |
| 設定           | `settings`                                                                            | 言語、翻訳先、入力元、声、VAD、Fixed間隔、自動停止時間 |
| 資料           | `documents`, `documentReference`                                                      | 原本のメタデータ、抽出ページ、共通結果                 |
| 会話           | `transcripts`                                                                         | 原文、翻訳、入力元、時刻、元Liveとの対応               |
| 支援           | `candidates`, `chats`                                                                 | 発言案と私的な指示・相談                               |
| 実際の発話     | `utterances`                                                                          | 予定全文と再生完了が確認できた文章、再生状態           |
| 導出情報       | `minutes`, `analyze`                                                                  | 要約と継続的な会話分析。未作成はnull                   |
| 利用料金       | `pricing`                                                                             | 会議の単価スナップショット                             |
| 更新の受領記録 | `appliedCommands`                                                                     | 直近128件のコマンドID                                  |
| 互換性項目     | `scripts`, `currentPage`, `presentationDocumentId`, `caption`等                       | 旧Presenterの保存形式を保持                            |

新規会議は`audience`です。`presenter`と関連項目は旧データの互換性のために保持します。

## 会議設定

会議ごとの設定は`settings`に保存します。

| 項目                    | 内容                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `language`              | 認識・発話言語                                                                                   |
| `translationLanguage`   | 翻訳先。新規会議はアプリの表示言語を初期値にして固定。旧null・未指定も読み込み時の表示言語で固定 |
| `input`                 | PC音声・マイク・両方                                                                             |
| `listeningLimitMinutes` | 聞き取りの自動停止時間                                                                           |
| `fixIntervalSeconds`    | Fixed用の録音区切り                                                                              |
| `vadSilenceMs`          | 発話区切りの無音時間                                                                             |

## 主な子モデル

| モデル                    | 重要な項目・区別                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| Document                  | `id`, `kind`, `format`, `pages`, `size`, `preparationPending`                                  |
| Transcript                | `id`, `text`, `translation`, `timestamp`, `source`, `disposition`, `correctedAt`, `liveSegments` |
| Candidate                 | `text`は確認文、`spokenText`は発話文。`targetId`, `status`を持つ                                 |
| Chat                      | `kind`はinstruction / consultation、`status`はpending / applied / failed                         |
| Utterance                 | `plannedText`と`completedText`。playing / interrupted / completed / failed                       |
| Minutes                   | summary、decisions、actions、questions、caveats                                                  |
| 会話分析（型名：Analyze） | topics、mentions、2種の質問例、入力・プロフィール・言語を識別するキー                            |

会議・発言などのIDはUUID形式です。引用元や派生結果の参照IDには文字列型も使います。

## 資料の保存形式

- `format`: pdf / text / image / presentation。PPTの原本はpresentationとして保持します。
- `pages`: 抽出した原文。PDFと変換後のPPTは元ページ番号、画像は空配列です。繰り返しのAI処理には渡しません。
- `preparationPending`: 新規追加と資料構成の変更で全資料をtrueにし、共通結果の生成成功時に全件falseにします。失敗時はtrueを保持。省略はfalseです。共通結果がない場合も未生成として扱います。
- Sessionの`documentReference`: 会議共通の参照文・用語集。省略はnull（未生成）。`documentIds`は生成対象の資料IDを登録順に最大30件保持、`summary`はMarkdown形式の要約で最大6,000文字（旧名`markdown`は読み込み時に変換）、`glossary`は用語の文字列配列で最大100件。新規生成は1語1〜50文字、旧データを保持する保存契約は1語1〜100文字です。旧オブジェクト配列は読み込み時に`term`だけを取り出し、次回保存から文字列配列に統一します。`reading`・`meaning`は保存しません。
- 生成済みとして再利用する条件は、対象ID一覧が現在の資料と一致し、未生成フラグがないことです。追加の再生成中は対象IDが現在の資料にすべて残っている以前の共通結果を使います。削除・既存原本変更時は`{documentIds: [], summary: "", glossary: []}`に置き換えます。全資料削除時はこの空結果が有効です。
- 資料ごとの`markdown`・`glossary`、`usage`と旧分類・利用許可は未知フィールドとして除去します。旧資料の原本と抽出ページは保持し、自動で参照文に読み替えません。

旧記録を読み込むため、保存形式は1語100文字まで許容します。新規生成と後続AIへの入力は最大100件・1語最大50文字とし、旧記録の50文字を超える語は送信対象から外します。

生成とAIへ渡す条件は[資料の読み取り](../05-ai/10-document.md)に定義します。

## 上限と互換性

上限は資料30件、発言・Utterance各10,000件、候補・Chat各1,000件、主な本文100,000文字、会議名120文字です。

旧形式は既定値と読み込み時の変換で扱います。旧`manual`入力はmicrophoneへ、旧3分設定は10分へ読み替え、手入力のTranscriptは保持します。Backendは未知フィールドを無視します。スキーマのバージョン管理は[Q-07](../99_課題.md)で検討します。

## 発言の翻訳

発言ごとの`translation`と`translationLanguage`を保存します。既存の`analyzed`は翻訳処理が完了したことを表す互換フィールドとして保持します。質問判定は行わず、旧データの`isQuestion`・設定の`autoDetectQuestions`は読み込み時に無視します。

発言案の`spokenText`は発話文、`text`は参考訳、`translationLanguage`は参考訳の言語です。旧発言案の参考訳は日本語として読み込みます。

会話分析の`topics`は`id`・`title`・`summary`を保存します。AIの更新・追加・削除をBackendで反映した完成済みの全件を保存し、差分命令は保存しません（[差分更新](../05-ai/30-analyze.md#topicsの差分更新)）。旧`evidenceIds`は読み込み時に除去します。`mentions.evidenceId`と議事録の根拠IDは引き続き保持します。

## 会話分析の引き継ぎ情報

`Analyze.context`はTopicsと別の内部要約です。`summary`（6000文字以内）、`coveredCount`（取り込み済みの先頭発言数）、`sourceKey`（その範囲の原文・時刻・確定状態のSHA-256）を保存します。未作成はnullです。

`startedAt`は分析の開始時刻、`updatedAt`は完了時刻です。`topicEvidence`は話題IDから最終根拠発言IDへの対応です。古い記録ではそれぞれnull・空の対応表として読み込みます。Topicの経過時間も`topicEvidence`と発言時刻から求め、時刻を重複保存しません。外部AIとの短いIDの変換は[会話分析](../05-ai/30-analyze.md#ai入出力の短いid)で行い、保存用IDは変えません。会話原文は従来どおり保持し、要約で置き換えたり削除したりしません。

境界・更新・再作成の条件は[会話分析](../05-ai/30-analyze.md#引き継ぎ要約と直近の原文)を参照してください。

`Analyze.mentionSources`は、言及の抽出を完了した発言IDから本文のSHA-256への対応です。言及がなかった発言も保存し、同じ本文の再抽出を防ぎます。未指定は空の対応表です。抽出・置換は[会話分析](../05-ai/30-analyze.md#youの差分抽出と蓄積)を参照してください。

## @Youの保存と旧形式

`Analyze.mentions / mentionSources`へ言及と確認済みリビジョンを保存します。`mentionSources`は発言IDから本文と確定状態のハッシュへの対応です。旧`Session.mentionAnalysis`は読み込み互換のため省略・nullを許容して残し、統合Analyzeの初回成功で`analyze`へ移してnullにします。処理と移行は[@You](../05-ai/35-mentions.md)を参照してください。

## 言語コード

表示言語・会議の言語・翻訳先・会話分析の言語は`ja` / `en` / `zh` / `fr`です。FrontendとBackendで同じ値を検証します。フランス語追加による旧記録の初期値・移行処理の変更はありません。認識用コードは[音声取得](../04-native/02-audio.md)を参照してください。
