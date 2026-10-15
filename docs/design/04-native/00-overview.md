# 04 Native

[Design Overview](../00-overview.md)

TauriとSwiftでMacアプリを動かし、Frontend・BackendとOS機能をつなぎます。

- [起動と終了](01-lifecycle.md)：ウィンドウとBackendの管理、終了時の保存待ち
- [音声](02-audio.md)：マイク・PC音声の取得、Appleの文字起こし
- APIキーの保管とBackendへの提供
- [配布構成](03-packaging.md)：Frontend・Backend・音声機能の同梱と署名

## APIキーと権限

- APIキーはKeychainの`jp.ledad.desktop`に保存し、Backendへ渡します。
- Frontendへは登録有無だけを返します。
- OS機能の操作はアプリのメインウィンドウからの呼び出しに限定します。
- 外部接続先とファイル操作は、CSPとTauriの権限設定で制限します。

## 資料のドラッグ＆ドロップ

- メインウィンドウの`dragDropEnabled`を`false`にし、WebViewの標準ファイルドロップをFrontendで受け取ります。登録はファイル選択と同じ処理を使用します。
- 登録対象外の画面でも、ドロップされたファイルを開いてアプリから離れる標準動作は抑止します。
- 受付範囲と画面の動作は[会議設定](../02-frontend/02-home/02-meeting-setting.md#資料の追加)に定義します。

## 対象環境

- Macアプリ：macOS 14以上
- Appleの文字起こし：macOS 26以上。言語・音声形式などの条件は[音声](02-audio.md)に定義します。
