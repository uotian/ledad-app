import { existsSync } from 'node:fs';
for (const f of ['env.local', '.env.local']) if (existsSync(f)) process.loadEnvFile(f);
for (const [provider, url, headers] of [
  [
    'OpenAI',
    'https://api.openai.com/v1/models',
    { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
  ],
  [
    'Gemini',
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    { 'x-goog-api-key': process.env.GEMINI_API_KEY },
  ],
]) {
  const res = await fetch(url, { headers });
  const json = await res.json();
  console.log(
    provider,
    res.status,
    res.ok
      ? (json.data || json.models)
          .map((x) => x.id || x.name)
          .filter((x) => /gpt-5.4-mini|gpt-6|transcribe-live|3.8.*tts/.test(x))
      : 'APIへ接続できません',
  );
}
