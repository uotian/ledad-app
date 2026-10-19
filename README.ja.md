# ledad

[日本語](README.ja.md) | [English](README.md) | [中文（简体）](README.zh.md) | [Français](README.fr.md)

会議の音声をリアルタイムに文字起こし・翻訳し、内容の理解と発言をAIが支援するMacアプリです。会話を追いながらAIに相談したり発言を読み上げられたりします。

![ledadの画面デモ](docs/assets/ledad-demo.gif)

サンプル会話データを使った画面デモです。

使用技術：Next.js 16、React 19、TypeScript、Python、Tauri 2、Swift、OpenAI API、Gemini API、Apple SpeechTranscriber

Next.jsが画面とリアルタイムの音声送信を、Pythonが会議データとAI処理を担当します。TauriとSwiftがmacOSとの連携と音声取得を担います。

## 主な機能

- マイク・PCの音声・両方を組み合わせた音声入力
- 低遅延な速報（Live）と、録音を再認識する確定版（Fixed）の文字起こし・翻訳
- 会話のトピックと、自分への言及・質問・依頼の表示
- 会議の文脈を踏まえたAIへの相談（Chat）と発言案の作成（Ask）
- 確認した発言案の読み上げ・停止・再開
- PDF・PowerPoint・画像・テキスト資料からの参照文・用語集の生成
- 出典付きの用語集と、資料・会話分析から最大100語を使う音声認識のヒント（Apple Liveを除く）
- 会議の記録・要約の保存と、議事録のMarkdown出力
- 日本語・英語・中国語（簡体字）・フランス語の画面表示と発話
- カフェモカを基調としたライト・ダーク・システム連動の外観切り替え

## 必要なもの

- Apple Silicon搭載のMac、macOS 26以降
- OpenAI APIキー（Geminiは任意）
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)（PowerPointの変換に使用）

## セットアップ

### アプリのインストール

1. [Apple Silicon用 v0.9.2](https://github.com/uotian/ledad-app/releases/download/v0.9.2/ledad_0.9.2_aarch64.dmg)をダウンロードします（[SHA-256](https://github.com/uotian/ledad-app/releases/download/v0.9.2/ledad_0.9.2_aarch64.dmg.sha256)）。最新版は[Releases](https://github.com/uotian/ledad-app/releases/latest)をご確認ください。
2. DMGを開き、`ledad.app`を「アプリケーション」フォルダへドラッグします。
3. 「アプリケーション」フォルダから`ledad.app`を開きます。

同梱アプリはApple Development署名、DMG自体は未署名・未公証のため、macOSが起動をブロックする場合があります。

入手元を確認したアプリがブロックされた場合は、警告を閉じて**システム設定 → プライバシーとセキュリティ → このまま開く**から許可できます。[Appleの手順](https://support.apple.com/ja-jp/102445)を参照してください。

### APIキーの登録

「設定」→「AI」でOpenAI APIキーを登録してください。Geminiを併用する場合は「Geminiも使う」をオンにし、Gemini APIキーも登録します。

OpenAI互換の接続先（`base_url`）を指定すると、文章・音声処理をその接続先へ送れます。指定中はLiveの聞き取りがApple固定になり、Geminiは使いません。接続先には既存のモデル名とAPI形式への対応が必要です。[接続先の要件](docs/design/05-ai/02-connection.md)を参照してください。

### 音声取得の許可

初めて会議を開始するときに、マイク・システム音声へのアクセスを許可してください。拒否した場合は、システム設定 → プライバシーとセキュリティ → マイク／画面収録とシステムオーディオ録音でledadを許可し、再起動を求められた場合はアプリを開き直します。

## 使い方

1. ホームで音声の入力元と言語を選び、「会議を始める」を押します。
2. 文字起こし・翻訳を確認しながら、AIへの相談や発言案の作成・読み上げを利用します。
3. 「停止」「再開」で聞き取りを操作し、「終了」で会議を保存・要約します。

## データの取り扱い

本アプリはローカル環境で動作し、アプリ内で保存する会議データは利用者のMac内に保存されます。また、AppleのSpeechTranscriberによる文字起こしは端末内で行われ、認識用の音声はAppleサーバーへ送信されません。 [Apple公式資料](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition)

### 外部AIサービスに関して

処理に必要な音声・会話・資料などをOpenAI APIまたはGemini APIへ送信します。送信先での取り扱いは、各サービスの利用規約および設定に従います。

#### OpenAIのみを使う場合

- **学習・改善**：APIへ送信したデータは、デフォルトでモデルの学習・改善に使用されません。利用者がOpenAI側で明示的にデータ共有へ同意した場合は例外です。
- **監視用の保存**：通常、不正利用の監視ログを原則最大30日間保持します。ただし、OpenAI側の設定や適用条件によっては、監視用のデータ保持を無効にできる場合があります。

#### Geminiも使う場合

Geminiを使う機能には、以下も適用されます。

- **学習・改善**：有料サービスでは、入力・出力はモデルの学習・改善に使用されません。無料サービスでは、原則として学習・改善に使用されます。
- **監視用の保存**：入力・追加のコンテキスト・出力は、不正利用の監視などのため55日間保持されます。有料サービスでも、この保持は行われます。

上記は2026年10月18日に確認した公式資料に基づきます。最新の条件は下記リンク先をご確認ください。

- [OpenAI API：データの取り扱い](https://developers.openai.com/api/docs/guides/your-data)
- [Gemini API：利用規約](https://ai.google.dev/gemini-api/terms)
- [Gemini API：不正利用の監視](https://ai.google.dev/gemini-api/docs/usage-policies)

カスタム接続先（`base_url`）を設定した場合は、その接続先のルールによります。

## 注意点

- このアプリは、Codexを使ったバイブコーディングで開発しています。
- OpenAI・Gemini APIの利用料が発生します。画面の料金は概算です。
- 聞き取りは30分後(設定で変更可)に自動停止します。「再開」で続けられます。
- 読み上げ音声をZoomなどで送るには、別途音声共有の設定が必要です。

## ドキュメント

[設計資料（作成途中）](docs/design/00-overview.md)

## 変更履歴

[変更履歴](CHANGELOG.ja.md)を参照してください。

## ライセンス

[MIT](LICENSE)
