import { launchBrowser } from './harness.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { startMCPClient } from '../mcp-client.mjs';
import { clickAction } from './browser-actions.mjs';

const root = resolve(import.meta.dirname, '../..');
const website = 'https://alunapp.cn/protolab/';
const bridgeAddress = 'http://127.0.0.1:4183';
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
const temp = await mkdtemp(resolve(tmpdir(), 'protolab-sidecar-'));
let browser, helper, client;
try {
  browser = await launchBrowser();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  // 仅替换网站静态内容；保持真实 HTTPS 站点来源，跨域请求使用实际本机外挂。
  await context.route(`${website}**`, async route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice('/protolab/'.length)) || 'index.html';
    if (!['index.html', 'downloads/protolab-mcp.mjs'].includes(path) && !path.startsWith('src/') && !path.startsWith('styles/')) { await route.abort(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
    await route.fulfill({ contentType: types[extname(path)] || 'application/octet-stream', ...(path === 'downloads/protolab-mcp.mjs' ? { headers: { 'Content-Disposition': 'attachment; filename="protolab-mcp.mjs"' } } : {}), body: await readFile(resolve(root, path)) });
  });
  const page = await context.newPage(), errors = [];
  const networkErrors = []; page.on('console', message => { if (message.type() === 'error') networkErrors.push(message.text()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(website); await clickAction(page, '#mcpSettingsBtn');
  assert.equal(await page.locator('#mcpSidecarHelp').isVisible(), true);
  assert.equal(await page.locator('#mcpConnectBtn').isEnabled(), true);
  assert.equal(await page.locator('a[download="protolab-mcp.mjs"]').getAttribute('href'), 'downloads/protolab-mcp.mjs');
  const script = resolve(temp, '易设 小外挂.mjs');
  // Chromium 的下载请求不经过静态页面拦截，部署前将发布文件复制到下载目录验证独立运行。
  await writeFile(script, await readFile(resolve(root, 'downloads/protolab-mcp.mjs')));
  assert.equal(await readFile(script, 'utf8'), await readFile(resolve(root, 'downloads/protolab-mcp.mjs'), 'utf8'));
  // 从仓库外的下载文件启动，证明外挂不依赖仓库文件或 node_modules。
  helper = spawn(process.execPath, [script, '--url', bridgeAddress], { cwd: temp, stdio: 'pipe' });
  let helperLog = ''; helper.stdout.on('data', chunk => { helperLog += chunk; }); helper.stderr.on('data', chunk => { helperLog += chunk; });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(`${bridgeAddress}/__protolab/config`)).ok) break; } catch { /* 等待外挂。 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(helperLog.includes('外挂已启动'), helperLog);
  assert.equal((await fetch(`${bridgeAddress}/src/app.js`)).status, 404);
  // 对启用本机网络权限提示的 Chromium，使用正常权限授权验证连接，不关闭浏览器保护。
  const loopbackPermission = await page.evaluate(async () => {
    try { return (await navigator.permissions.query({ name: 'loopback-network' })).state; } catch { return null; }
  });
  // 按权限名称正常授予测试站点，兼容新版 Chromium 独立的回环权限；不关闭访问保护。
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send('Target.getTargetInfo');
  for (const name of ['local-network-access', ...(loopbackPermission === null ? [] : ['local-network', 'loopback-network'])]) await cdp.send('Browser.setPermission', { permission: { name }, setting: 'granted', origin: new URL(website).origin, browserContextId: targetInfo.browserContextId });
  // 保持测试授权会话到验收结束；断开调试会话会撤回此临时权限。
  await page.locator('#mcpBridgeURL').fill(bridgeAddress); await page.locator('#mcpConnectBtn').click();
  try { await page.waitForFunction(() => document.getElementById('mcpStatus').textContent.includes('已连接'), null, { timeout: 10000 }); }
  catch (error) { throw new Error(`${await page.locator('#mcpStatus').textContent()}\n${networkErrors.join('\n')}\n${helperLog}\n${error.message}`); }
  const sessionId = await page.locator('#mcpSessionId').textContent();
  const value = await page.locator('#mcpConfig').inputValue(); assert.ok(value.includes('--stdio')); assert.ok(value.includes(script));
  for (const name of ['codex', 'cursor', 'claude', 'opencode', 'antigravity']) {
    await page.locator('#mcpClient').selectOption(name); const text = await page.locator('#mcpConfig').inputValue();
    assert.ok(text.includes('--stdio')); assert.ok(text.includes(bridgeAddress));
  }
  await page.locator('[data-close="mcpDialog"]').first().click();
  client = startMCPClient(bridgeAddress, { script, stdio: true }); await client.initialize();
  const call = async (name, args = {}) => { const result = await client.call(name, args); assert.ok(!result.isError, result.content[0].text); return result.structuredContent; };
  assert.equal((await call('protolab_list_sessions')).sessions[0].sessionId, sessionId);
  const read = () => call('protolab_get_project', { sessionId }); const current = await read();
  await call('protolab_apply_changes', { sessionId, expectedRevision: current.revision, summary: '修改线上工程', changes: [{ op: 'add', item: { id: 'online-heading', name: '线上标题', type: 'html', content: '<h1>外挂连接成功</h1>', x: 24, y: 100, width: 280, height: 60 } }] });
  assert.equal(await page.locator('[data-item-id="online-heading"].editor-item').count(), 1);
  await clickAction(page, '#undoBtn'); assert.equal(await page.locator('.editor-item').count(), 0);
  await clickAction(page, '#redoBtn'); assert.equal(await page.locator('.editor-item').count(), 1);
  const archive = await call('protolab_export', { sessionId, format: 'project' }); assert.equal(JSON.parse(archive.content).project.items[0].id, 'online-heading');
  assert.equal(await page.evaluate(() => location.origin), 'https://alunapp.cn');
  await page.reload(); assert.equal(await page.locator('[data-item-id="online-heading"].editor-item').count(), 1);
  assert.equal((await client.call('protolab_get_project', { sessionId })).isError, true);
  await clickAction(page, '#mcpSettingsBtn'); await page.locator('#mcpBridgeURL').fill(bridgeAddress); await page.locator('#mcpConnectBtn').click();
  await page.waitForFunction(() => document.getElementById('mcpStatus').textContent.includes('已连接'));
  const newSession = await page.locator('#mcpSessionId').textContent();
  assert.equal((await call('protolab_get_project', { sessionId: newSession })).project.items.length, 1);
  const config = await page.locator('#mcpConfig').inputValue();
  await page.locator('#languageSelect').selectOption('en'); assert.equal(await page.locator('#mcpConnectBtn').textContent(), 'Disconnect this tab');
  assert.equal(await page.locator('#mcpConfig').inputValue(), config);
  await page.locator('#languageSelect').selectOption('zh');
  await page.screenshot({ path: resolve(output, 'mcp-sidecar-online.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'mcp-sidecar-mobile.png') });
  await page.locator('#mcpConnectBtn').click();
  await page.waitForFunction(() => !document.getElementById('mcpConnectBtn').disabled);
  assert.equal((await call('protolab_list_sessions')).sessions.some(session => session.sessionId === newSession), false);
  await page.locator('#mcpBridgeURL').fill('https://evil.example'); await page.locator('#mcpConnectBtn').click();
  assert.ok((await page.locator('#mcpStatus').textContent()).includes('本机 HTTP'));
  assert.deepEqual(errors, []);
  console.log('通过：线上 HTTPS 页面连接独立外挂、本机跨域、五种客户端配置、实际 MCP 修改、撤销重做、原站点保存恢复、导出、断开、地址校验和双语窄屏');
} finally {
  await client?.close(); await browser?.close(); helper?.kill();
  if (helper && helper.exitCode === null && helper.signalCode === null) await new Promise(resolve => helper.once('exit', resolve));
  await rm(temp, { recursive: true, force: true });
}
