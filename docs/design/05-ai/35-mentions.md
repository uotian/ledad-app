# 05.35 @You：Analyzeによる言及の検知と整理

[AI Overview](00-overview.md) / [Analyze](30-analyze.md) / [You](../02-frontend/03-meeting/02.02.02-you.md)

## 責務とAPI

`POST /api/sessions/:id/analyze`の一度のOpenAI Responses呼び出しで、Topics・Chat/Ask入力候補・引き継ぎ要約と一緒に、本人への言及の検知・分類・要約・引用を返します。モデル・待機時間・再試行・キャンセルは[Analyze](30-analyze.md)と共通です。Decisionsと独立した`/mentions`の呼び出しは廃止しました。

名前・呼ばれ方は本人の手動設定を使います。登録名はSTTの認識ヒントへ追加せず、会話分析の`names`へ渡します。会話の文脈から本人への質問・依頼・その他の言及を拾い、文字起こしの表記揺れ・誤認識（例：「コレコレ」→「コロコロ」）は呼びかけ・宛先と前後の文脈で判断します。音が似ているだけの場合や、通常の語・別人との区別がつかない場合は抽出しません。引用は名前を補正せず、原文の完全一致を維持します。名前が空なら言及は抽出しませんが、Topics等の分析は継続します。後続会話による回答済み・対応完了の管理は対象外です。

## 対象の選択と蓄積

- `conversationForAnalyze`の確定イベントを受けたLive・Fix・手入力・実際に再生した文を使います。未確定速報、未発話候補、私的Chatは含めません。統合Fixの本文を優先し、訂正前の`liveSegments`を二重送信しません。
- 発言IDごとに本文と`settled`のハッシュを`Analyze.mentionSources`へ保存します。初回・本文訂正・Live→Fixを再抽出対象にします。同じ本文でもFix化したら再判定します。
- 未FixのLiveは次の会話更新時にも対象に含めます。同一入力の未Fix Liveだけを理由に繰り返し送信しません。未変更のFixは再抽出せず、既存の言及を保持します。
- 抽出対象を短い発言IDの`mentionTargetIds`で指定します。AIは`conversation`と`handoff`を文脈に使い、対象の原文からだけ言及を返します。旧版の要約済み範囲に未判定の発言があれば、要約をリセットして原文から確認します。
- Fix統合・削除で消えたIDの言及は除去します。訂正後に言及がなければ旧候補を取り消します。登録名・表示言語が変わった場合も再抽出します。

## 出力と検証

`mentions`は`{kind, summary, evidenceId, quote}`の配列です。`kind`は`question / request / mention`、`summary`は表示言語による短い具体的な内容です。該当なしは空配列です。

Backendは要求内の短い発言IDを保存用IDへ戻し、抽出対象であることと、引用が対象行の完全一致部分文字列であることを検証します。未知のID、対象外のID、空・架空の引用は分析全体の失敗とします。過去の候補と結合し、重複を除いて発言時刻順に並べます。

Topics・言及・確認済みリビジョン・引き継ぎ要約は、一つの成功したAnalyze結果として扱います。失敗・取消時に前回の結果や確認済み印を進めません。@Youだけの独立した更新・再試行は行いません。

## 保存・表示・旧記録

- 新しい結果は`Session.analyze`へ保存し、Youの更新時刻・処理中・エラーもAnalyzeと共通にします。
- 処理中に訂正・削除・Fix化された発言は、応答時に本文と確定状態を突き合わせ、古い言及と確認済み印を採用しません。追加だけなら既存の有効な結果を保持し、次のAnalyzeで新しい入力を扱います。
- 表示時も現行発言と引用を照合します。既存の引用・時刻による表示重複排除は維持します。
- 旧`Session.mentionAnalysis`は読み込み互換用に残します。統合Analyzeの初回成功までは表示と前回結果に読み継ぎ、成功時に`analyze`へ移して`mentionAnalysis`をnullにします。保存済みの旧Analyzeだけがある場合も再検証します。
- 新しい利用記録は`meeting_analyze`の一件です。過去の`mention_detection / meeting_mentions`の履歴表示と旧料金計算は維持します。

## 検証範囲

単一呼び出し、Liveの持ち越し・Fix再判定、訂正による取り消し、削除・統合、引用検証、失敗・取消時の前回状態保持、旧要約済み原文の再確認、旧保存形式の移行をモックで検証します。ブラウザでは共通の再試行・TopicsとYouの同時保存・古いLive応答の除外を確認します。統合プロンプトの実API精度・遅延は未評価です。

実装：[対象と蓄積](../../../backend/ledad/ai/mentions.py)、[Analyze入力](../../../backend/ledad/ai/tasks.py)、[共通プロンプト](../../../backend/ledad/ai/prompts/analyze.txt)、[Frontend](../../../src/components/meeting/analyze/useAnalyze.ts)。
