import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');

export async function launchBrowser() {
  const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
  const { chromium } = await import(moduleName ? pathToFileURL(resolve(moduleName)).href : 'playwright');
  return chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
}

/** 验收共用启动、就绪检查和清理；外部服务由调用方管理。 */
export async function startBrowserTest({ port }) {
  const base = process.env.PROTOLAB_TEST_URL || `http://127.0.0.1:${port}`;
  const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || resolve(root, 'test-results'));
  let server, browser;
  const close = async () => {
    try { await browser?.close(); }
    finally {
      if (server?.pid && server.exitCode === null && server.signalCode === null) {
        const exited = new Promise(done => server.once('exit', done));
        server.kill(); await exited;
      }
    }
  };
  try {
    await mkdir(output, { recursive: true });
    if (!process.env.PROTOLAB_TEST_URL) {
      server = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs')], { cwd: root, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
      await new Promise((done, reject) => {
        let diagnostic = '';
        const timer = setTimeout(() => finish(new Error('开发服务器启动超时')), 5000);
        const finish = error => {
          clearTimeout(timer);
          server.off('error', onError); server.off('exit', onExit); server.stdout.off('data', onData);
          error ? reject(error) : done();
        };
        const onError = error => finish(error);
        const onExit = code => finish(new Error(`开发服务器启动失败（${code}）：${diagnostic}`));
        const onData = data => { if (data.toString().includes('Protolab 已启动：')) finish(); };
        server.stderr.on('data', data => { diagnostic += data.toString(); });
        server.once('error', onError); server.once('exit', onExit); server.stdout.on('data', onData);
      });
    }
    const response = await fetch(base, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`验收地址不可用：${base}（${response.status}）`);
    await response.body?.cancel();
    browser = await launchBrowser();
    return { base, output, browser, close };
  } catch (error) { await close(); throw error; }
}
