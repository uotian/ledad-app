import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Test the shipped executable with isolated data and no provider credentials.
const directory = await mkdtemp(join(tmpdir(), 'ledad-service-check-'));
const executable = resolve(process.argv[2] || 'src-tauri/resources/service/ledad-service');
const child = spawn(executable, [], {
  stdio: ['pipe', 'pipe', 'inherit'],
  env: { ...process.env, LEDAD_DATA_DIR: directory, OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
});
const pending = new Map();
const lines = createInterface({ input: child.stdout });
let nextId = 0;
function fail(error) {
  for (const { reject, timeout } of pending.values()) {
    clearTimeout(timeout);
    reject(error);
  }
  pending.clear();
}
child.on('error', fail);
child.on('exit', (code, signal) => fail(new Error(`Service exited: ${code ?? signal}`)));
child.stdin.on('error', fail);
lines.on('line', (line) => {
  try {
    const response = JSON.parse(line);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    const value = JSON.parse(Buffer.from(response.body, 'base64').toString());
    clearTimeout(waiter.timeout);
    pending.delete(response.id);
    waiter.resolve({ status: response.status, value });
  } catch (error) {
    fail(error);
  }
});
function request(path, method = 'GET', body) {
  const id = String(++nextId);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Service timeout: ${method} ${path}`));
    }, 10_000);
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(
      JSON.stringify({ id, path, method, ...(body ? { body: JSON.stringify(body) } : {}) }) + '\n',
    );
  });
}
try {
  const config = await request('/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.value.openai, false);
  assert.equal(config.value.gemini, false);
  const created = await request('/api/sessions', 'POST', {
    mode: 'audience',
    title: 'Packaged Python check',
  });
  assert.equal(created.status, 201);
  const path = `/api/sessions/${created.value.id}`;
  assert.equal((await request(path, 'PUT', { ...created.value, status: 'active' })).status, 200);
  const saved = await request(path);
  assert.equal(saved.value.status, 'active');
  assert.ok(saved.value.pricing?.rates.length);
  const command = { commandId: randomUUID(), command: { type: 'end' } };
  const ended = await request(`${path}/commands`, 'POST', command);
  assert.equal(ended.status, 200);
  assert.equal(ended.value.status, 'ended');
  assert.ok(ended.value.endedAt);
  assert.deepEqual((await request(`${path}/commands`, 'POST', command)).value, ended.value);
  const restored = await request(`${path}/commands`, 'POST', {
    commandId: randomUUID(),
    command: { type: 'restore' },
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.value.status, 'ended');
  assert.equal(restored.value.appliedCommands.length, 2);
  assert.equal((await request('/api/sessions')).value.length, 1);
  assert.equal((await request(path, 'DELETE')).status, 200);
  assert.equal((await request(path)).status, 404);
  console.log(
    'Packaged Python service: startup, IPC, storage, commands, deduplication, pricing and deletion passed.',
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  lines.close();
  const exited = child.exitCode !== null || child.signalCode !== null;
  const closed = exited
    ? Promise.resolve()
    : new Promise((resolve) => child.once('close', resolve));
  child.stdin.end();
  const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
  await closed;
  clearTimeout(kill);
  await rm(directory, { recursive: true, force: true });
}
