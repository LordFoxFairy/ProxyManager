import { spawn } from 'node:child_process';

const [node, script, port = '18787'] = process.argv.slice(2);
if (!node || !script) throw new Error('usage: api-smoke.mjs NODE SCRIPT [PORT]');
const child = spawn(node, [script, 'serve', '--no-gateway', '--port', port], { stdio: 'inherit', env: process.env });
const base = `http://127.0.0.1:${port}`;
let ok = false;
try {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.ok) { ok = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!ok) throw new Error('bundled backend health check timed out');
  const health = await (await fetch(`${base}/health`)).json();
  if (health.ok !== true) throw new Error('health response invalid');
  const runtime = await (await fetch(`${base}/runtime`)).json();
  if (!runtime.status || !runtime.config) throw new Error('runtime response invalid');
} finally {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}
