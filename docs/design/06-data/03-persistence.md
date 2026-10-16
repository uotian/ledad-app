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
└─ state.json                     利用モード・Live・Fixedの設定
```

JSONは権限を制限した一時ファイルから、ファイル単位で置き換えます。複数ファイルの一括更新には対応しません。APIキーはKeychainへ保存します。

## アプリ設定

利用モードとモード別のLive・Fixed設定、およびv0.8.0で追加した接続先を`state.json`で管理します。

```json
{
  "baseUrl": "",
  "aiMode": "openai",
  "modes": {
    "openai": { "liveProvider": "openai", "refinementProvider": "openai" },
    "gemini": { "liveProvider": "gemini", "refinementProvider": "openai" }
  }
}
```

- `baseUrl`：カスタムOpenAI接続先。空欄は公式接続。旧データで欠けている場合は空欄として読みます。`PUT /api/connection-settings`の`baseUrl`で更新し、通常のモード別設定は保持します。URLの検証・実効値の制限は[AI接続先](../05-ai/02-connection.md)を参照してください。
- `aiMode`：`openai`（OpenAIのみ） / `gemini`（Geminiも使う）。新規環境は`openai`。
- `PUT /api/ai-settings`の`mode`で利用モードだけを変更します。`PUT /api/live-settings`と`PUT /api/config`は現在のモードのLive・Fixedだけを変更します。
- OpenAIのみのLiveはOpenAI / Apple、FixedはOpenAIのみです。Geminiの選択はBackendでも拒否します。
- 旧`state.json`のLive・FixedはGemini併用モードとしてそのまま引き継ぎ、OpenAIのみの設定を既定値で追加します。`state.json`がない場合は旧`live.json`・`refinement.json`も読み継ぎます。旧ファイルは削除しません。
- 保存内容が不正な場合はエラーとし、既定値で上書きしません。ファイル単位の原子的な保存を維持します。

音声出力は選択した声から決めます。localStorageの`ledad.voices`にモード別の声とプロバイダー別の前回の声を保存します。

```json
{
  "modes": { "openai": "cedar", "gemini": "Aoede" },
  "voices": { "openai": "cedar", "gemini": "Aoede" }
}
```

未保存のモードはOpenAIのみでMarin、Gemini併用でKoreです。旧`ledad.voice`がある場合はGemini併用に読み継ぎ、OpenAIの声ならOpenAIのみでも引き継ぎます。旧キーは残します。OpenAIのみでGeminiの声は利用できません。破損した新形式は保存・読み上げ時にエラーとし、暗黙に初期化しません。

会議保存値の声は履歴として保持しますが、新しい発言の読み上げには現在のモード別設定を使います。発言開始時に一度取得し、途中・再開で変更しません。モード別の選択肢と反映タイミングは[AI設定](../02-frontend/01-layout/01.01-setting.md)を参照してください。

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

### 外観

localStorageの`ledad.theme`に`light` / `dark` / `system`を保存します。未設定・不正値では`light`を使い、保存できない場合もそのウィンドウには選択を即時反映します。会議データやAPI入力には含めません。`system`はOSから実際のライト／ダークを解決し、OSの変更時にも更新します。
