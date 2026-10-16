# 05.27 Live / OpenAI

[Transcribe / Transcript](20-transcribe.md)

v0.7.1で追加しました。AI設定の「聞き取り（Live）」で`gpt-live-transcribe`を選択します。既存のGemini／Apple設定とFixedの選択は維持します。

## 接続と入力

Backendが`POST /v1/realtime/client_secrets`で有効期限60秒の一時キーを発行し、Frontendが`wss://api.openai.com/v1/realtime?intent=transcription`へ直接接続します。通常のAPIキーはFrontendへ渡さず、一時キーもAPI詳細へ保存しません。

- モデル：`OPENAI_LIVE_STT_MODEL`、既定`gpt-live-transcribe`。
- セッション：`type: transcription`、音声は24kHz・モノラルPCM16。取得・Fixed保存は既存の16kHzを維持し、送信時だけ連続性を保って変換します。
- 認識設定：`languages: [会議の言語]`、`delay: low`、`keywords: 用語集`。`< >`や改行を含む語はAPIの制約に合わせて除外します。資料本文・プロフィールは渡しません。
- `turn_detection: null`。このモデルはサーバーVADを使えないため、アプリ側で10msごとのRMS（閾値0.01）と会議設定の無音時間を使い、発話終了時に`input_audio_buffer.commit`を送ります。無音も含め最大15秒で区切ります。通常は100ms未満をcommitせず、停止時の短い末尾だけは変換の遅延分を見込んで110msまで無音を補って確定します。補った送信時間も料金の概算に含めます。

## 反映・停止・接続更新

途中結果は`item_id`ごとに連結します。commitの応答で発話区間とIDを結び、確定結果は受信順によらず音声の順に反映します。時刻はアプリ側の録音位置から計算し、単語時刻や話者分離は扱いません。

9分ごとに末尾をcommitして接続を更新します。接続待ちは15秒、末尾の確定待ちは最大5秒、更新中の音声保持は最大20秒です。停止時もNativeの残り音声を受け取り、commit後の確定を待ってからFixed処理と利用記録を終了します。確定が間に合わなければ途中結果を残して通知します。切断時の自動再送はせず、再開操作で新しく接続します。

## 利用料金と検証

送信した音声の累積秒数を5秒ごとと終了時に保存し、$0.017/分で概算します。実際の請求額ではありません。停止・切断までに送信した音声も計算対象です。旧会議のスナップショットにこのモデルだけがない場合は導入時の単価で補完し、保存済み単価は変更しません。

2026-10-16に実APIで一時キー・接続・日本語の合成音声から途中／確定テキストの受信を確認しました。実マイク・混合音声・長時間接続でのVAD精度と遅延は未評価です。

[OpenAI公式仕様](https://developers.openai.com/api/docs/guides/realtime-transcription)、[料金](https://developers.openai.com/api/docs/pricing#transcription-and-speech)。

実装：[OpenAIProvider](../../../backend/ledad/ai/openai.py)、[OpenAILiveTranscription](../../../src/lib/audio/openai-live-transcription.ts)、[Listener](../../../src/lib/audio/listener.ts)。

### 途中結果の訂正に関する実API検証（2026-10-16）

同音異義語・後続の文脈説明・話者の言い直し・専門用語の合成音声を`low / minimal`で計8試行、ノイズ追加を1試行しました。途中でcommitせず各音声の最後で1回確定する条件で、全9試行とも前後空白を除くdelta連結と確定全文が一致しました。3試行は先頭空白のみ除去され、誤認識の訂正・置換位置・別の訂正イベントは観測していません。

これは訂正機能が存在しないことの証明ではありません。現在の実装はdeltaを追記し、確定全文が異なればそれで置き換えます。その置換を回帰テストで確認しています。受信形式の根拠がない途中置換処理は追加していません。ローカル検証資料は`output/openai-live-revisions/`（Git管理外）に保持します。
