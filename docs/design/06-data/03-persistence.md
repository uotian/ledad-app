# 06.03 保存と更新

[Data](00-overview.md) / [スキーマ](01-schema.md)

会議と関連ファイルをローカルに保存し、編集の順序と再試行時の整合性を保ちます。

- 保存を直列化し、応答待ち中の編集を保持します。
- 同じ更新IDの再試行を重複適用しません。
- 会議と資料、利用台帳の削除範囲を分けます。

## 保存場所

製品版の基準ディレクトリはTauriのアプリデータ領域（通常は`~/Library/Application Support/jp.ledad.desktop/`）、ブラウザ開発では既定で`.data/`です。

```text
dataDir/
├─ sessions/<sessionId>/
│  ├─ session.json               会議・会議共通の参照文と用語集
│  ├─ <documentId>                 原資料
│  └─ usage-details/<usageId>.json API入出力の詳細
├─ usage/<usageId>.json            本文を持たない利用台帳
├─ usage-details/                 会議に属さないAPI詳細の保存先
├─ logs/                          診断ログ
├─ meeting-settings.json          新規会議向けの既定設定
└─ state.json                     Live・Fixedの設定
```

JSONは権限を制限した一時ファイルから、ファイル単位で置き換えます。複数ファイルの一括更新には対応しません。APIキーはKeychainへ保存します。

## アプリ設定

Live・Fixedの設定はBackend自身が参照するため、localStorageではなく`state.json`で管理します。

```json
{
  "liveProvider": "gemini",
  "refinementProvider": "openai"
}
```

- `liveProvider`：`gemini` / `apple`。既定は`gemini`。
- `refinementProvider`：`openai` / `gemini`。既定は`openai`。
- モデル名はBackendの設定で決まり、ここには選択したプロバイダーを保存します。
- 一方の設定を変更しても、もう一方は保持します。
- `state.json`がなければ、旧`live.json`・`refinement.json`から選択を取り込みます。旧ファイルは残し、移行後は参照しません。
- 保存内容が不正な場合はエラーとし、既定値で上書きしません。

## 更新の流れ

1. Frontendは編集を画面へ即時反映し、250ms後の保存を予約します。
2. PUT・会議コマンド・資料の読み取り要求は同じキューで直列化します。送信するスナップショットはキューの実行時に取得します。
3. コマンドは`commandId`、`command`、必要ならSessionの`snapshot`を送ります。
4. Backendは会議ID・shareToken、要約済みなどの条件を検査し、状態と適用済みIDを同じSessionファイルへ保存します。
5. 応答待ち中のローカル編集を、返却されたSessionへ再適用します。
6. 通信・サーバー失敗で結果が不明な場合は、同じcommandIdを保持し、次の書き込みの前に再試行します。明確な入力拒否は保留から外します。

初回保存も同じ会議IDでPOSTを再試行し、重複会議の作成を避けます。Backendは直近128件の適用済みコマンドを保持し、同じIDなら再適用せず現在のSessionを返します。

## コマンドと状態

| コマンド                               | 主な役割                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| restore                                | 再生中を中断へ、処理中の相談を失敗へ整える。音声は開始しない |
| start / end                            | 会議をactive / endedへ。終了済み会議のstartは拒否            |
| candidates / dismiss                   | 候補の登録、保留・スキップ                                   |
| utterance                              | 再生の進行と完了区間を記録                                   |
| refinement                             | 元発言との一致を確認してFixedを反映                          |
| chat-start / chat-result / chat-failed | 私的な相談の状態更新                                         |
| minutes                                | 要約を確定する                                               |

設定・確定会話・翻訳・会話分析はSession全体のPUTでも更新します。

## 削除と同時更新

会議削除は`sessions/<id>/`を取り除き、原資料と会議に属するAPI詳細も削除します。利用台帳は別領域に残ります。保存から外れた資料の原ファイルも更新時に削除します。

直列化は一つの画面での操作に限ります。複数画面・端末の競合制御と、強制終了後の未送信編集の復元は未対応です。同時更新・移行の方針：[Q-07](../99_課題.md)。

資料の原本と生成結果の関係、変換用一時ファイルの扱いは[資料の登録](../03-backend/01-operations.md#資料の登録)を参照してください。
