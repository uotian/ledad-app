# 05.33 TTS（読み上げ）

[AI Overview](00-overview.md) / [Ask](32-ask.md)

本人が再生を選んだ発言文を音声化します。Frontendで句読点・改行ごとに分け、長い区間は最大280文字で分割し、区間ごとに生成・再生します。

## 利用先の選択（v0.7.2）

設定の「音声出力」でOpenAI / Geminiを選び、続けて「声の種類」でその利用先の声を選びます。OpenAIのみのモードではOpenAI固定、Gemini併用ではGeminiが既定です。声とモードの保存・移行は[アプリ設定](../06-data/03-persistence.md#アプリ設定)を参照してください。

Backendは検証済みの声から利用先を決定します。発言開始時にFrontendが現在のモードを取得して声を固定し、途中の区間や再開で利用先を変更しません。設定取得に失敗した場合も読み上げを失敗として扱い、自動フォールバックは行いません。

OpenAIは`POST /audio/speech`、モデルは`OPENAI_TTS_MODEL`（既定`gpt-4o-mini-tts`）を使います。本文を`input`、会議の言語と下記の読み方を`instructions`、声を`voice`へ渡し、`stream_format: sse`・`response_format: pcm`で受け取ります。`speech.audio.delta`を結合し、完了イベントを確認してから24kHz・16bit・モノラルのWAVに変換します。SDKの60秒タイムアウト・自動再試行なしを適用します。途中終了・空の音声・不正な使用量は失敗とし、既存の再開操作で再試行できます。

利用台帳にはOpenAI / speech、入力文字数、出力秒数、リクエストIDと成功・失敗、`speech.audio.done.usage`の入力・出力・合計トークン数を保存します。音声本文は詳細ログへ保存せず、完了イベントと使用量を記録します。料金は入力100万トークンあたり$0.60、音声出力100万トークンあたり$12で算出します（[公式料金](https://developers.openai.com/api/docs/pricing)、2026-10-16確認）。

既存会議の単価表にこのモデルがない場合だけ、導入時の上記固定単価を補って計算します。保存済みの単価・為替レートは変更しません。修正前の使用量がない履歴は復元せず、未算出のまま表示します。

実装：[OpenAIProvider.speech](../../../backend/ledad/ai/openai.py)。API仕様：[OpenAI Text to speech](https://developers.openai.com/api/docs/guides/text-to-speech)。

## Geminiの基本情報

| 項目                              | 内容                                                |
| --------------------------------- | --------------------------------------------------- |
| API                               | Gemini Interactions                                 |
| モデル                            | `GEMINI_TTS_MODEL`、既定`gemini-3.8-flash-lite-tts` |
| `generation_config.speech_config` | `[{voice: 入力の声}]`                               |
| `store`                           | `false`                                             |
| API・期限                         | `v1beta`、1区間のリクエスト・処理とも60秒           |
| SDK再試行                         | Interactionsの`max_retries: 0`                      |

## 入力

[Ask](32-ask.md#発言案)の`candidates[].spokenText`（編集した場合は編集後の本文）を区間分割し、speech metadataを付けます。

| 項目 | 内容                                                                                                                             |
| ---- | -------------------------------------------------------------------------------------------------------------------------------- |
| 本文 | [Ask](32-ask.md#発言案)の`spokenText`から切り出した区間                                                                          |
| 言語 | [会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」                                                |
| 声   | [アプリ設定](../02-frontend/01-layout/01.01-setting.md#一般設定)の「読み上げ音声」。現在のモード別設定を使用（OpenAI: Marin、Gemini: Koreが既定） |

本文は`input[].content[].text`に渡します。Backendの入力上限は1要求4,000文字です。

## 読み上げの指示

本文に付ける`annotations`の`type: speech_metadata`・`style`で指定します。独立したsystem promptは使いません。

```text
{言語}。落ち着いた明瞭な会議の発言。入力された文章をそのまま読む。
```

`{言語}`は「会議の言語」を`日本語 / English / 普通话`へ変換した値です。

## 出力

`response_format: {type: audio}`で音声を返します。

`output_audio.data`をBase64デコードし、`mime_type`（なければ`audio/wav`）とともに返します。

実装：[GeminiProvider.speech](../../../backend/ledad/ai/gemini.py)、[MeetingSpeaker](../../../src/lib/audio/speaker.ts)、[区間分割](../../../src/lib/audio/speech.ts)、[入力検証](../../../backend/ledad/transport/requests.py)。

カスタム接続先使用中の割り当てと制約は[AI接続先](02-connection.md)を参照してください。
