import { startBrowserTest } from './harness.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { startMCPClient } from '../mcp-client.mjs';
import { clickAction } from './browser-actions.mjs';

const { base, output, browser, close } = await startBrowserTest({ port: 4181 });
let client, secondClient;
try {
  client = startMCPClient(base); secondClient = startMCPClient(base);
  await client.initialize('2024-11-05'); await secondClient.initialize('2025-06-18');
  assert.equal((await client.request('tools/list')).tools.length, 5);
  const call = async (name, args) => { const result = await client.call(name, args); assert.ok(!result.isError, result.content[0].text); return result.structuredContent; };
  const sessions = () => call('protolab_list_sessions');
  assert.equal((await sessions()).sessions.length, 0);
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await clickAction(page, '#settingsBtn');
  await page.locator('#aiURL').fill('https://ai.example.test/v1'); await page.locator('#aiModel').fill('test');
  await page.locator('#aiKey').fill('mcp-secret-must-stay-private'); await page.locator('#aiRememberKey').check();
  await page.locator('#aiSettingsForm button[type=submit]').click();
  async function connect(target) {
    await clickAction(target, '#mcpSettingsBtn');
    await target.waitForFunction(() => !!document.getElementById('mcpConfig').value);
    await target.locator('#mcpConnectBtn').click();
    await target.waitForFunction(() => document.getElementById('mcpStatus').textContent.includes('已连接'));
    const sessionId = await target.locator('#mcpSessionId').textContent();
    await target.locator('[data-close="mcpDialog"]').first().click();
    return sessionId;
  }
  const sessionId = await connect(page);
  const read = args => call('protolab_get_project', { sessionId, ...args });
  const modify = async (changes, args = {}) => call('protolab_apply_changes', { sessionId, expectedRevision: (await read()).revision, summary: '设计登录页', changes, ...args });
  let state = await read();
  assert.equal(state.project.items.length, 0); assert.ok(!JSON.stringify(state).includes('mcp-secret'));
  assert.equal(state.designContext.library.components.length, 23);
  await modify([{ op: 'add', item: { id: 'mcp-heading', name: '登录标题', type: 'html', content: '<h1 onclick="bad()">欢迎登录</h1><script>bad()</script>', x: 24, y: 100, width: 280, height: 60 } },
    { op: 'add', item: { id: 'mcp-button', libraryId: 'lib-btn', x: 24, y: 240 } }]);
  assert.equal(await page.locator('.editor-item').count(), 2);
  state = await read(); assert.ok(!state.project.items[0].content.includes('script')); assert.ok(!state.project.items[0].content.includes('onclick'));
  assert.equal(state.project.items[1].name, '按钮');
  await clickAction(page, '#undoBtn'); assert.equal(await page.locator('.editor-item').count(), 0);
  await clickAction(page, '#redoBtn'); assert.equal(await page.locator('.editor-item').count(), 2);
  const oldRevision = (await read()).revision;
  await page.locator('[data-item-id="mcp-heading"].editor-item').click();
  await page.locator('#propName').fill('手动修改的标题'); await page.locator('#selectionProps button[type=submit]').click();
  const stale = await client.call('protolab_apply_changes', { sessionId, expectedRevision: oldRevision, summary: '旧请求', changes: [{ op: 'update', id: 'mcp-heading', fields: { name: '不应覆盖' } }] });
  assert.equal(stale.isError, true); assert.match(stale.content[0].text, /工程已改变/);
  assert.equal((await read()).project.items[0].name, '手动修改的标题');
  const invalid = await client.call('protolab_apply_changes', { sessionId, expectedRevision: (await read()).revision, summary: '非法批次', changes: [{ op: 'update', id: 'mcp-heading', fields: { name: '不应保存' } }, { op: 'remove', id: 'absent' }] });
  assert.equal(invalid.isError, true); assert.equal((await read()).project.items[0].name, '手动修改的标题');
  console.log('通过：真实 MCP 握手和组件修改、组件库复用、内容清理、撤销重做、人工编辑冲突与整批校验');

  const homeId = (await read()).project.activePageId;
  const popup = await call('protolab_create_page', { sessionId, expectedRevision: (await read()).revision, name: '欢迎弹窗', kind: 'popup', changes: [{ op: 'add', item: { id: 'popup-message', name: '弹窗文案', type: 'html', content: '<p>登录成功</p>', x: 20, y: 40, width: 260, height: 80 } }] });
  assert.equal((await read()).project.activePageId, popup.pageId);
  await modify([{ op: 'update', id: 'mcp-button', fields: { interaction: { type: 'openPopup', targetId: popup.pageId } } }], { pageId: homeId });
  assert.equal((await read()).project.activePageId, popup.pageId);
  const exported = await call('protolab_export', { sessionId, format: 'html' });
  assert.ok(exported.content.includes('欢迎登录')); assert.ok(exported.content.includes('登录成功')); assert.ok(!exported.content.includes('mcp-secret'));
  const standalone = await context.newPage(); await standalone.setContent(exported.content);
  await standalone.locator('[data-element-id="mcp-button"]').click();
  await standalone.waitForFunction(() => document.querySelector('[data-prototype-popup]')?.open);
  const projectExport = await call('protolab_export', { sessionId, format: 'project' });
  const archive = JSON.parse(projectExport.content); assert.equal(archive.format, 'protolab-project'); assert.equal(archive.project.pages.length, 2);
  assert.ok(!projectExport.content.includes('mcp-secret'));
  console.log('通过：新建弹窗、指定页面修改、完整工程导出和独立 HTML 弹窗交互');

  await clickAction(page, '#mcpSettingsBtn');
  for (const name of ['codex', 'cursor', 'claude', 'opencode', 'antigravity']) {
    await page.locator('#mcpClient').selectOption(name);
    const text = await page.locator('#mcpConfig').inputValue(); assert.ok(text.includes(base)); assert.ok(text.includes('mcp-server.mjs'));
    if (name !== 'codex') JSON.parse(text);
  }
  await page.locator('#mcpCopyBtn').click();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), await page.locator('#mcpConfig').inputValue());
  const configuration = await page.locator('#mcpConfig').inputValue();
  await page.locator('#languageSelect').selectOption('en');
  assert.equal(await page.locator('#mcpConnectBtn').textContent(), 'Disconnect this tab');
  assert.equal(await page.locator('#mcpConfig').inputValue(), configuration);
  await page.locator('#languageSelect').selectOption('zh');
  await page.screenshot({ path: resolve(output, 'mcp-connection.png') });
  await page.locator('[data-close="mcpDialog"]').first().click();
  const otherContext = await browser.newContext({ locale: 'zh-CN' }); const other = await otherContext.newPage();
  await other.goto(base); const otherSession = await connect(other);
  assert.equal((await sessions()).sessions.length, 2);
  const otherState = await secondClient.call('protolab_get_project', { sessionId: otherSession });
  assert.equal(otherState.structuredContent.project.items.length, 0);
  const concurrentRevision = (await read()).revision;
  const concurrent = await Promise.all([
    client.call('protolab_apply_changes', { sessionId, expectedRevision: concurrentRevision, summary: '请求一', changes: [{ op: 'update', id: 'popup-message', fields: { name: '第一个请求' } }] }),
    secondClient.call('protolab_apply_changes', { sessionId, expectedRevision: concurrentRevision, summary: '请求二', changes: [{ op: 'update', id: 'popup-message', fields: { name: '第二个请求' } }] }),
  ]);
  assert.equal(concurrent.filter(result => result.isError).length, 1);
  assert.equal((await secondClient.call('protolab_get_project', { sessionId: otherSession })).structuredContent.project.items.length, 0);
  await otherContext.close();
  const savedVersions = await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.projects.v1')).entries[0].workspace.versions.entries.length);
  assert.ok(savedVersions >= 7);
  await page.reload();
  assert.equal(await page.locator('[data-item-id="popup-message"].editor-item').count(), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.projects.v1')).entries[0].workspace.versions.entries.length), savedVersions);
  assert.equal((await client.call('protolab_get_project', { sessionId })).isError, true);
  const restoredSession = await connect(page); assert.notEqual(restoredSession, sessionId);
  assert.equal((await call('protolab_get_project', { sessionId: restoredSession })).project.pages.length, 2);
  await page.setViewportSize({ width: 390, height: 844 }); await clickAction(page, '#mcpSettingsBtn');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'mcp-mobile.png') });
  await page.locator('#mcpConnectBtn').click();
  assert.equal((await client.call('protolab_get_project', { sessionId: restoredSession })).isError, true);
  assert.deepEqual(errors, []);
  console.log('通过：五种客户端配置、复制与双语、多个标签页隔离、并发版本检查、保存恢复、断开连接和窄屏');
} finally {
  await client?.close(); await secondClient?.close(); await close();
}
