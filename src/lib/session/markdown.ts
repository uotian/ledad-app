import type { Session } from './schema';
import { saveMarkdownFile } from '@/lib/files';
const stamp = (value: string) => new Date(value).toLocaleString('ja-JP');
export function exportMarkdown(session: Session) {
  const lines = [
    `# ${session.title}`,
    '',
    `- 開始：${session.startedAt ? stamp(session.startedAt) : '未開始'}`,
    `- 終了：${session.endedAt ? stamp(session.endedAt) : '未終了'}`,
    '',
    '> 音声認識とAIによる記録です。重要な内容は原記録と照合してください。私的チャットと未発話の候補は含めていません。',
    '',
  ];
  const m = session.minutes;
  if (m) {
    for (const [heading, values] of [
      ['要点', m.summary],
      ['決定事項', m.decisions],
      ['次のアクション', m.actions],
      ['記録の注意点', m.caveats],
    ] as const)
      lines.push(
        `## ${heading}`,
        '',
        ...(values.length ? values.map((v) => `- ${v}`) : ['確認された内容はありません。']),
        '',
      );
    lines.push('## 質問と回答', '');
    m.questions.forEach((q, i) =>
      lines.push(
        `### ${i + 1}. ${q.question}`,
        '',
        `状態：${q.status === 'answered' ? '回答あり' : q.status === 'unanswered' ? '未回答' : '要確認'}`,
        '',
        q.answer,
        '',
        `根拠ID：${q.evidenceIds.join(', ')}`,
        '',
      ),
    );
  } else lines.push('議事録の要約は未作成です。以下に原記録を残します。', '');
  lines.push('## 会議の原記録', '');
  const events = [
    ...session.transcripts.map((t) => ({
      time: t.timestamp,
      content: `### ${stamp(t.timestamp)} · ${t.source === 'manual' ? '手入力' : '聞き取り'}\n\n${t.text}${t.translation ? `\n\n日本語訳：${t.translation}` : ''}\n\nID: ${t.id}`,
    })),
    ...session.utterances.map((u) => ({
      time: u.startedAt,
      content: `### ${stamp(u.startedAt)} · AIの${u.kind === 'presentation' ? '発表' : u.kind === 'question' ? '質問' : u.kind === 'answer' ? '回答' : '発言'}（${u.status === 'completed' ? '完了' : u.status === 'failed' ? '失敗' : '中断'}）\n\n${u.completedText || '再生完了を確認した区間はありません。'}${u.status !== 'completed' ? '\n\n※最後の区間が途中まで再生された可能性があります。用意した全文は記録に含めていません。' : ''}\n\nID: ${u.id}`,
    })),
  ].sort((a, b) => a.time.localeCompare(b.time));
  events.forEach((e) => lines.push(e.content, ''));
  return lines.join('\n');
}
export async function downloadMarkdown(session: Session) {
  await saveMarkdownFile(
    exportMarkdown(session),
    session.title.replace(/[\\/:*?"<>|]/g, '_') + '_記録.md',
  );
}
