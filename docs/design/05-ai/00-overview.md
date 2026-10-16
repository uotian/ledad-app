# 05 AI Overview

[Design Overview](../00-overview.md)

2026-10-14時点の作業ツリーにあるAI呼び出しを整理します。各ページには、実行条件、プロンプトに渡す情報、APIパラメータ、出力・反映先、実装参照を記載します。モデル名はコードの既定値であり、プロバイダー側の最新モデル一覧ではありません。

## ページ構成

| 番号                                                  | 用途                                    | 呼び出し・既定モデル               |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------- |
| [01 Usage](01-usage.md)                               | 全処理共通の利用記録・API詳細・概算料金 | 外部APIの台帳                      |
| [10 Document](10-document.md)                         | 全資料から参照文・用語集を生成          | OpenAI `gpt-6-luna`固定            |
| [20 Transcribe / Transcript](20-transcribe.md)        | 音声認識と翻訳の全体像                  | 以下の21〜27                       |
| [21 Live / Gemini](21-live-gemini.md)                 | ストリーミング認識                      | `gemini-3.5-transcribe-live`       |
| [22 Live / Apple](22-live-apple.md)                   | 端末内認識                              | Apple SpeechTranscriber            |
| [23 Fix / OpenAI](23-fix-openai.md)                   | 録音の再認識                            | `gpt-transcribe`                   |
| [24 Fix / Gemini](24-fix-gemini.md)                   | 録音の再認識                            | `gemini-3.5-transcribe`            |
| [25 Live Translate](25-live-translate.md)             | 途中の発言の翻訳                        | OpenAI `gpt-6-luna`                |
| [26 Transcript Translate](26-transcript-translate.md) | 確定発言・Fix後の翻訳                   | OpenAI `gpt-6-luna`                |
| [27 Live / OpenAI](27-live-openai.md) | ストリーミング認識 | `gpt-live-transcribe` |
| [30 Analyze](30-analyze.md)                           | Topics・@You・Chat/Ask入力候補           | OpenAI `gpt-6-luna`                |
| [31 Chat](31-chat.md)                                 | 本人への私的な相談回答                  | OpenAI `gpt-6.1-sol`               |
| [32 Ask](32-ask.md)                                   | 会議相手に話す文の下書き・確認訳        | OpenAI `gpt-6-luna`                |
| [33 TTS](33-tts.md)                                   | 発言文の読み上げ                        | OpenAI `gpt-4o-mini-tts` / Gemini `gemini-3.8-flash-lite-tts` |
| [34 Summarize](34-summarize.md)                       | 終了後の議事録・要約                    | OpenAI `gpt-6-luna`                |

カスタム接続先の経路・制約・適用タイミングは[AI接続先](02-connection.md)を参照してください。

## AIの実行場所と接続経路

AI処理には、外部APIで実行するものと、端末内で実行するものがあります。

| 処理            | 実行場所・接続経路                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------------- |
| Gemini Live STT | BackendのPythonが制約付き一時トークンを発行し、FrontendのJavaScriptがWebSocketでGeminiへ直接接続します。 |
| OpenAI Live STT | Backendが一時キーを発行し、FrontendがWebSocketで直接接続します。[詳細](27-live-openai.md)。 |
| Apple Live STT  | NativeのSwiftからApple SpeechTranscriberを使い、端末内で音声認識します。                                 |
| その他のAI処理  | BackendのPythonからOpenAI・Geminiの外部APIへ問い合わせます。                                             |

## 読み方

- プロンプトの件数・文字数は生成指示です。コードで強制する制限は「検証上限」と記載します。
- プロンプト本文は各ページ、実ファイルは各ページのリンク先で確認できます。説明を要約している箇所は「指示の要点」と記載します。
- モデルの既定値・APIパラメータは現在の実装の設定です。外部APIの最新仕様や実機動作の検証結果を示すものではありません。

## 明示キャッシュの共通条件

[Live Translate](25-live-translate.md)・[Transcript Translate](26-transcript-translate.md)・[Analyze](30-analyze.md)・[Chat](31-chat.md)が対象です。

モデル名がGPT-6以降またはGPT-5.6以降の場合、`prompt_cache_options: {mode: explicit, ttl: 30m}`を付け、指示文と固定情報の末尾にキャッシュ境界を置きます。それ以外のモデルでは、`instructions`とJSON文字列の`input`を使い、明示キャッシュは指定しません。

ページ内の固定キーは配置上の区分です。資料・設定などの値が変われば、同じキーでも入力内容は変わります。

実装：[prompt_cache_request](../../../backend/ledad/ai/cache.py)。

- [35 @You](35-mentions.md)：Analyzeの一度の応答で本人への言及を検知・整理します。
