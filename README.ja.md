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
- 会議の記録・要約の保存と、議事録のMarkdown出力
- 日本語・英語・中国語（簡体字）・フランス語の画面表示と発話
- カフェモカを基調としたライト・ダーク・システム連動の外観切り替え

## 必要なもの

- Apple Silicon搭載のMac、macOS 26以降
- OpenAI APIキー（Geminiは任意）
- [LibreOffice](https://www.libreoffice.org/download/download-libreoffice/)（PowerPointの変換に使用）

## セットアップ

自分のMacでソースコードからビルドして使います。公証済みのビルド済みアプリは配布していません。

### ビルド環境の準備

1. [Node.js](https://nodejs.org/ja/download) 22以降をインストールします。
2. [uv](https://docs.astral.sh/uv/getting-started/installation/)と[Rust（rustup）](https://rust-lang.org/tools/install/)を、各公式手順に従ってインストールします。
3. Mac App StoreからXcodeをインストールし、一度開いて初回設定を完了します。

### ソースコードの取得

```sh
git clone https://github.com/uotian/ledad-app.git
cd ledad-app
```

### 依存関係のインストール

プロジェクトのルートで実行します。

```sh
npm ci
```

### 証明書の準備

初回のみ、署名に使う開発用証明書を準備します。

1. Xcodeを開き、「Settings」→「Accounts」で自分のApple Accountを追加します。
2. 自分のTeamを選び、「Manage Certificates」を開きます。
3. 「＋」→「Apple Development」を選び、証明書を作成します。

証明書と秘密鍵はMacのログインキーチェーンに保存されます。次回以降のビルドでも同じ証明書を使います。

### アプリをビルドする

プロジェクトのルートでビルドします。

```sh
npm run app:build
```

`build/ledad.app`が作成されます。Finderから開いてください。

### APIキーの登録

「設定」→「AI」でOpenAI APIキーを登録してください。Geminiを併用する場合は「Geminiも使う」をオンにし、Gemini APIキーも登録します。

OpenAI互換の接続先（`base_url`）を指定すると、文章・音声処理をその接続先へ送れます。指定中はLiveの聞き取りがApple固定になり、Geminiは使いません。接続先には既存のモデル名とAPI形式への対応が必要です。[接続先の要件](docs/design/05-ai/02-connection.md)を参照してください。

### 音声取得の許可

初めて会議を開始するときに、マイク・システム音声へのアクセスを許可してください。拒否した場合は、システム設定 → プライバシーとセキュリティ → マイク／画面収録とシステムオーディオ録音でledadを許可し、再起動を求められた場合はアプリを開き直します。

## 使い方

1. ホームで音声の入力元と言語を選び、「会議を始める」を押します。
2. 文字起こし・翻訳を確認しながら、AIへの相談や発言案の作成・読み上げを利用します。
3. 「停止」「再開」で聞き取りを操作し、「終了」で会議を保存・要約します。

## 注意点

- OpenAI・Gemini APIの利用料が発生します。画面の料金は概算です。
- 会議データはMac内に保存します。音声・会話・資料などは、処理に応じて外部のAI APIへ送信します。
- 聞き取りは30分後(設定で変更可)に自動停止します。「再開」で続けられます。
- 読み上げ音声をZoomなどで送るには、別途音声共有の設定が必要です。

## ドキュメント

[設計資料（作成途中）](docs/design/00-overview.md)

## 変更履歴

[変更履歴](CHANGELOG.ja.md)を参照してください。

## ライセンス

[MIT](LICENSE)。同梱フォント・アイコンには、それぞれの[フォント](public/licenses/Outfit-OFL.txt)・[アイコン](public/icons/providers/LICENSE)のライセンスが適用されます。

このアプリは、Codexを使ったバイブコーディングで開発しています。
