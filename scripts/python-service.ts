import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

// Development probes exercise the same Python service and JSON protocol as the app.
export function pythonService(dataDirectory: string) {
  for (const file of ['.env.local', 'env.local']) if (existsSync(file)) process.loadEnvFile(file);
  const child = spawn(process.execPath, ['scripts/python.mjs', '-m', 'ledad'], {
    env: { ...process.env, LEDAD_DATA_DIR: resolve(dataDirectory) },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const pending = new Map<
    string,
    { resolve: (value: Response) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  const lines = createInterface({ input: child.stdout });
  const fail = (error: Error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('Python service exited')));
  child.stdin.on('error', fail);
  lines.on('line', (line) => {
    try {
      const value = JSON.parse(line);
      const waiter = pending.get(value.id);
      if (!waiter) return;
      clearTimeout(waiter.timer);
      pending.delete(value.id);
      waiter.resolve(
        new Response(Buffer.from(value.body, 'base64'), {
          status: value.status,
          headers: { 'Content-Type': value.contentType },
        }),
      );
    } catch {
      fail(new Error('Invalid service response'));
    }
  });
  async function request(path: string, method = 'GET', body?: unknown) {
    const id = crypto.randomUUID();
    const response = await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        child.stdin.write(JSON.stringify({ cancel: id }) + '\n');
        reject(new Error('Python service timeout'));
      }, 120_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({
          id,
          path,
          method,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }) + '\n',
      );
    });
    if (!response.ok)
      throw new Error((await response.json()).error || `Service error: ${response.status}`);
    return response;
  }
  return {
    request,
    async json<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
      return (await request(path, method, body)).json();
    },
    async close() {
      lines.close();
      const closed =
        child.exitCode !== null
          ? Promise.resolve()
          : new Promise<void>((resolve) => child.once('close', () => resolve()));
      child.stdin.end();
      const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed;
      clearTimeout(timer);
    },
  };
}
