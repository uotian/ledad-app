# 04.03 配布構成

[Native](00-overview.md)

Frontend・Backend・音声取得機能を一つのMacアプリに同梱します。

- **Frontend**：静的ファイルとして同梱し、WebViewに表示します。
- **Backend**：Pythonの実行環境と依存ライブラリを同梱します。
- **音声取得**：Swiftの実行ファイルを同梱します。
- **アプリ本体**：Tauriでウィンドウ・通信・OS連携を管理します。

利用時にPython・Node.js・開発サーバーの導入は不要です。製品版はHTTPサーバーを起動しません。

## 署名と更新

- Apple Developmentでアプリと同梱実行ファイルに署名します。
- 署名検証に成功したアプリを完成品として置き換えます。
- 権限とKeychainの継続利用のため、同じ署名主体を使います。
- DMGをGitHub Releasesで配布します。Developer ID署名・公証・自動更新は未対応で、macOSがダウンロードしたアプリの起動をブロックする場合があります。

ビルド・証明書の設定・検証手順は[利用・開発ガイド](../../guide.md#開発する)にまとめます。

## DMG

`npm run app:build`は署名済みの`build/ledad.app`からDMGとSHA-256ファイルを生成します。DMGだけの再作成は`npm run app:dmg`です。

- `scripts/package-dmg.mjs`がアプリのバージョン・arm64形式・署名を確認します。
- DMGには`ledad.app`と`/Applications`へのリンクだけを入れます。
- イメージの整合性を検証し、読み取り専用でマウントして格納後のアプリ署名・バージョンとApplicationsリンクを確認します。
- 成果物は`build/ledad_<version>_aarch64.dmg`と同名の`.sha256`です。既存タグから作ったアプリを配布する場合、タグは変更せず、その版のReleaseへ2ファイルを追加します。
- Release本文にはApple Development署名・未公証であることを明記します。Developer ID署名・公証に移行する際は署名手順を更新します。

## アプリアイコン

カフェラテ色の背景に、楔形文字「𒅗」をモチーフにしたこげ茶の記号を大きく配置します。左の縦長の楔は右の縦画と高さを揃え、三辺を内側へ緩やかにくぼませます。

原画像は`assets/ledad-icon.png`です。`npx tauri icon assets/ledad-icon.png --output src-tauri/icons`で各サイズと`icon.icns`を生成し、Tauriのbundle設定から同梱します。アプリ内のホームボタンには家型アイコンを使用します。
