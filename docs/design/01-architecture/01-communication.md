# 01.01 通信とデータの流れ

[Architecture](00-overview.md)

Frontendからの操作をBackendへ渡し、音声やAIの結果を画面へ返します。

- MacアプリではNativeがFrontendとBackendの通信を仲介します。
- ブラウザ開発ではFrontendからBackendへローカルHTTPで接続します。
- Frontendが外部AIへ直接接続するのはGemini Liveです。

## アプリ内の通信

```text
Macアプリ：Frontend → Native → stdio → Backend
ブラウザ：Frontend → loopback HTTP → Backend
```

| 項目       | 内容                                                               |
| ---------- | ------------------------------------------------------------------ |
| リクエスト | `id`、`path`、`method`、JSON文字列の`body`、必要ならBase64の`file` |
| 応答       | `id`、`status`、`contentType`、Base64の`body`                      |
| 取消       | FrontendからNativeを通じてBackendへ伝える                          |
| APIキー    | NativeからBackendへ渡す。Frontendには登録有無だけを返す            |

リクエストの`id`で応答を対応付けます。更新の二重適用は`commandId`で防ぎます。詳細は[保存と更新](../06-data/03-persistence.md)にまとめます。

## Chatの途中応答

Chatだけ、最終応答の前に表示用の`text`（累積文字列）を返します。他の処理は従来の一括応答です。

- Mac：リクエストに`stream: true`を付け、stdioの`{id, text}`をNativeが該当リクエストのTauri Channelへ転送します。途中応答では最終応答の待ち合わせを解除しません。
- ブラウザ開発：`/consult?stream=true`からNDJSONを受信します。途中は`{text}`、最後は通常の応答エンベロープです。HTTP接続が終了しても、最終エンベロープがなければ成功とは扱いません。
- 取消・失敗時は途中テキストを保存しません。完了判定・保存条件は[Chat](../05-ai/31-chat.md#途中表示と保存)にまとめます。

## 音声とAIの経路

| 処理                         | 経路                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------- |
| 音声取得                     | Native → Frontend                                                                     |
| Gemini Live                  | Backendで一時トークン発行 → FrontendからGeminiへ直接接続                              |
| Apple Live                   | Native内で認識 → Frontend                                                             |
| Live翻訳                     | Frontend → Backend → OpenAI → Frontend                                                |
| Fixed                        | Frontendの録音 → Backend → OpenAIまたはGeminiで再認識 → OpenAIで解析・翻訳 → Frontend |
| 発言案・相談・会話分析・要約 | Frontend → Backend → 外部AI → Frontend                                                |
| 読み上げ                     | Backend → Geminiで音声生成 → Frontendで再生                                           |

Apple Liveでも、Fixedや翻訳には外部AIを使います。

## 入力検証と失敗時の動作

- Nativeは呼出元ウィンドウと操作パスを検証します。
- Backendはリクエスト・会議ID・入力形式を検証します。
- 開発用HTTPはローカル接続に限定し、Host・Origin・入力サイズを検査します。
- Nativeは待機期限を超えたらBackendへ取消を送ります。現行の期限と異常終了時の扱いは[起動と終了](../04-native/01-lifecycle.md#backendの応答と異常終了)を参照してください。
- Frontendは会議ID・原文・状態を照合し、古い応答を反映しません。
- 取消後も外部AIの処理・課金が続く場合があります。
