# 05.20 Transcribe / Transcript

[AI Overview](00-overview.md)

Liveで途中・確定テキストを表示し、録音区間ごとのFixで再認識します。翻訳は認識とは別のOpenAI呼び出しです。

| 段階      | ページ                                                  | 入力・結果                |
| --------- | ------------------------------------------------------- | ------------------------- |
| Live認識  | [OpenAI](27-live-openai.md) / [Gemini](21-live-gemini.md) / [Apple](22-live-apple.md) | 音声から途中・確定原文    |
| Fix再認識 | [OpenAI](23-fix-openai.md) / [Gemini](24-fix-gemini.md) | 録音から置換用の原文      |
| Live翻訳  | [Live Translate](25-live-translate.md)                  | 途中原文の全文から暫定訳  |
| 確定翻訳  | [Transcript Translate](26-transcript-translate.md)      | 確定原文・Fix原文から訳文 |

## 共通入力と設定

- 音声：16kHz・モノラル・16bit PCM。OpenAI Liveへの送信時だけ24kHzへ変換し、Fixへは16kHzのWAVで送ります。
- 言語：[会議設定](../02-frontend/02-home/02-meeting-setting.md#基本設定)の「会議の言語」「翻訳先の言語」。
- 用語：[認識用の用語集](28-glossary.md)。登録名・ドキュメント・会話分析を統合してSTTへ渡します。資料本文・要約は認識へ送りません。Apple Liveは用語集を使いません。翻訳はドキュメント・会話分析の語だけを使います。
- プロバイダー：[アプリ設定](../02-frontend/01-layout/01.01-setting.md)の「Live文字起こしのモデル」「Fixed文字起こしのモデル」。Liveの既定はOpenAIのみのモードでOpenAI、Gemini併用でGeminiです。FixはどちらもOpenAIが既定です。
- 区切り：Liveは連続音声15秒で確定を促します。Fixは[会議設定](../02-frontend/02-home/02-meeting-setting.md#詳細設定)の「Fixed文字起こしの間隔」（既定30秒）です。

## Fixの共通制御

`refine-transcripts`へ録音PCM、対象発言ID、翻訳先を渡します。Backendは音声の形式・最大190秒・IDの重複・対象の存在を検証し、手入力・手修正済み発言を含む要求は拒否します。録音は発言の確定境界で区切り、前後に最大5秒ずつの音声文脈を重ねます。この音声文脈はFix間隔とは別の設定です。元のLiveテキストは再認識のプロンプトには使いません。

再認識後はOpenAIで[翻訳](26-transcript-translate.md)し、`originals: [{id, text}]`, `text`, `translation`, `translationLanguage`を返します。

- 期限：全体90秒。再認識・翻訳をそれぞれ最大3回試行します。
- 再試行：408・429・500・502・503・504、接続・タイムアウトエラー。待機はプロバイダー指定、なければ5秒です。
- 再試行しないもの：入力・アプリ検証エラー、明確な課金・日次上限など。試行ごとに利用記録を残します。

実装：[Refinement](../../../backend/ledad/ai/refinement.py)、[再試行](../../../backend/ledad/ai/retry.py)、[要求検証](../../../backend/ledad/service.py)、[録音バッファ](../../../src/lib/audio/review-buffer.ts)、[音声取得の設計](../04-native/02-audio.md)。

カスタム接続先使用中の割り当てと制約は[AI接続先](02-connection.md)を参照してください。
