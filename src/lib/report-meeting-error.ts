import { api } from './api';

function redactErrorMessage(message: string) {
  return message
    .replace(/\bBearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[a-zA-Z0-9_-]+|AIza[a-zA-Z0-9_-]+)/g, '[redacted]')
    .replace(/([?&](?:key|api_key|token)=)[^\s&#"']+/gi, '$1[redacted]')
    .slice(0, 2000);
}

export async function reportMeetingError(sessionId: string, message: string, occurredAt: string) {
  if (!message) return;
  const record = { sessionId, message: redactErrorMessage(message), occurredAt };
  // サービスとの通信自体が壊れた場合も、直近100件は画面側に残します。
  try {
    const key = 'ledad.error-notices.v1';
    const previous = JSON.parse(localStorage.getItem(key) || '[]');
    localStorage.setItem(
      key,
      JSON.stringify([...(Array.isArray(previous) ? previous : []), record].slice(-100)),
    );
  } catch {
    console.error('[ledad] error notice backup could not be saved');
  }
  try {
    await api('/api/diagnostics', { method: 'POST', body: JSON.stringify(record) });
  } catch {
    // ログの失敗を再度通知すると再帰するため、画面のエラーにはしません。
    console.error('[ledad] error notice could not be sent to local service');
  }
}
