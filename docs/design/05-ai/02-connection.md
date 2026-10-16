# 05.02 AI接続先（v0.8.0）

[AI Overview](00-overview.md) / [アプリ設定](../02-frontend/01-layout/01.01-setting.md)

OpenAI互換ゲートウェイへ文章・資料・音声処理を送るため、アプリ設定で`base_url`を指定します。モデル名・プロンプト・要求形式は変更しません。

## 接続経路

| 処理 | 未指定 | カスタム接続先指定中 |
| --- | --- | --- |
| Live STT | 通常のモード別設定 | Apple SpeechTranscriber固定 |
| Fixed STT | 通常のモード別設定 | 指定先の`audio/transcriptions` |
| TTS | 通常のモード別設定 | 指定先の`audio/speech` |
| 翻訳・会話分析・発言案・相談・資料読み取り・要約 | OpenAI公式のResponses | 指定先の`responses` |

指定先URLのパスを保持して各APIのパスを付加します。たとえば`https://gateway.example/company/v1`なら`/company/v1/responses`です。`/v1`は自動補完しません。

未指定時は`https://api.openai.com/v1`を明示してSDKを初期化します。SDKの`OPENAI_BASE_URL`環境変数に暗黙に切り替わることはありません。モデル名の環境変数による既存の上書きは維持します。

## 指定中の制限と復元

- 実効モードはOpenAIのみ、LiveはApple、Fixed・TTSはOpenAIです。Geminiキーと声の選択肢は表示しません。「Geminiも使う」はオフ・操作不可です。
- 通常の`aiMode`とモード別の選択は保存したまま、実行時の値だけを上書きします。URLを空欄で保存すると元の選択に戻ります。
- 音声出力には既存のOpenAIモードの声を使います。通常モードのGeminiの声は保持します。
- Backendでもモード・Live・Fixedの個別変更、クラウドLive用トークン発行、Gemini音声出力を拒否します。Geminiクライアント生成自体も拒否し、旧クライアントや再試行経路からの新規送信を防ぎます。
- 自動フォールバックはありません。カスタム接続先ではHTTPリダイレクトにも追従しません。
- Apple LiveはMacの対応環境（macOS 26以降）が必要です。ブラウザや未対応OSでは聞き取り開始に失敗し、クラウドLiveへ切り替えません。

## 保存と適用タイミング

UIは入力中に接続先を変えず、「接続先を保存」で反映します。聞き取り・接続開始・読み上げ・一時停止した読み上げがある場合は変更を拒否し、停止を求めます。Backendで実行中のOpenAI要求がある場合も409で保存を拒否します。すでに送信済みの要求を取り消す機能ではありません。

次のOpenAI要求から新しいURLでクライアントを生成します。キーまたはURLの変更時には旧クライアントを退役し、使用中の要求がなくなってから閉じます。

HTTP(S)の絶対URLを受け付け、外側の空白と末尾スラッシュを除きます。認証情報・クエリ・フラグメント・不正なポート・空白文字等を含むURLは拒否します。空欄は解除です。保存失敗・不正な保存内容はエラーとし、公式URLへ暗黙に戻しません。

URLは`state.json`の`baseUrl`に保存します。APIキーは既存のOpenAI用Keychain項目を共用します。接続先の登録・解除でキーは変更しないため、利用する接続先に対応したキーを入力してください。保存契約は[Data](../06-data/03-persistence.md#アプリ設定)を参照してください。

## 互換性と検証範囲

接続先には現在のモデル名、Responsesの構造化出力・ストリーミング・キャッシュオプション、Fixedの音声アップロード、TTSのSSE音声出力への対応が必要です。Azure専用の認証・デプロイ名・`api-version`や独自ヘッダーの設定は対象外です。料金表示は既存のモデル単価による概算で、ゲートウェイ独自料金を取得しません。

HTTPモックで各経路とモデル名、エラー／リダイレクト時に別ホストへ送らないこと、クライアント更新を確認します。ブラウザテストで保存・再読み込み・解除・選択復元・不正URL・表示幅を確認します。社内ゲートウェイとMacの実機音声によるE2Eは未検証です。

実装：[Config](../../../backend/ledad/config.py)、[OpenAIProvider](../../../backend/ledad/ai/openai.py)、[Service](../../../backend/ledad/service.py)、[SettingsDialog](../../../src/components/settings/SettingsDialog.tsx)。
