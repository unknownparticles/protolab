import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4177';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4177' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* 等待开发服务 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let release;
  let requestBody;
  await page.route('https://ai.example.test/**', async route => {
    requestBody = route.request().postDataJSON();
    const { requirement, project } = JSON.parse(requestBody.messages.at(-1).content);
    let changes = [];
    if (requirement === '新增标题') changes = [{ op: 'add', item: { id: 'ai-heading', name: 'AI 标题', type: 'html', content: '<h1 style="color:#2563eb">欢迎登录</h1>', x: 30, y: 150, width: 220, height: 50 } }];
    if (requirement === '等待后放大标题') changes = [{ op: 'update', id: 'ai-heading', fields: { width: 260 } }];
    if (requirement === '等待后修改名称') changes = [{ op: 'update', id: 'ai-heading', fields: { name: 'AI 名称' } }];
    if (requirement.startsWith('等待')) await new Promise(resolve => { release = resolve; });
    if (route.request().headers().authorization !== 'Bearer mock-secret') throw new Error('请求缺少 Key');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: requirement === '非法返回' ? '```json\n{}\n```' : JSON.stringify({ version: 1, summary: requirement, changes }) } }] }) }).catch(() => {});
    assert.equal(project.version, 1);
  });
  await page.goto(base);
  await page.locator('#settingsBtn').click();
  await page.locator('#aiURL').fill('https://ai.example.test/v1');
  await page.locator('#aiKey').fill('mock-secret'); await page.locator('#aiModel').fill('test-model');
  await page.locator('#aiSettingsForm button[type=submit]').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.ai.settings.v1')).key), '');
  await page.locator('[data-comp-id="lib-btn"]').click();
  const initialId = await page.locator('.editor-item').getAttribute('data-item-id');
  const send = async requirement => {
    if (await page.locator('#aiPanel').isHidden()) await page.locator('#aiToggleBtn').click();
    await page.locator('#aiRequirement').fill(requirement); await page.locator('#aiSendBtn').click();
  };
  const waitDone = () => page.waitForFunction(() => document.getElementById('aiCancelBtn').hidden);
  await send('新增标题'); await waitDone();
  assert.equal(await page.locator('.editor-item').count(), 2);
  assert.match(requestBody.messages[0].content, /唯一 JSON/);
  assert.equal(requestBody.model, 'test-model');
  console.log('通过：配置接口、需求协议和 AI 应用');

  await send('等待后放大标题');
  await page.waitForFunction(() => !document.getElementById('aiCancelBtn').hidden);
  await page.locator('#aiCloseBtn').click();
  await page.locator(`[data-item-id="${initialId}"].editor-item`).click();
  await page.locator('#canvas').focus(); await page.keyboard.press('ArrowRight');
  const localX = await page.locator('#propX').inputValue();
  assert.ok(release); release(); await waitDone();
  assert.equal(await page.locator('#aiPending').isVisible(), true);
  assert.equal(await page.locator('[data-item-id="ai-heading"].editor-item').evaluate(node => node.style.width), '220px');
  await page.locator('#mergeOpenBtn').click();
  assert.equal(await page.locator('.merge-conflict').count(), 0);
  await page.screenshot({ path: resolve(output, 'ai-merge-clean.png') });
  await page.locator('#mergeApplyBtn').click();
  assert.equal(await page.locator('[data-item-id="ai-heading"].editor-item').evaluate(node => node.style.width), '260px');
  assert.equal(await page.locator(`[data-item-id="${initialId}"].editor-item`).evaluate(node => parseInt(node.style.left)), Number(localX));
  assert.equal(requestBody.messages.some(message => message.content === '新增标题'), true);
  console.log('通过：多轮上下文及等待期间本地修改无冲突合并');

  await send('等待后修改名称'); await page.locator('#aiCloseBtn').click();
  await page.locator('[data-item-id="ai-heading"].editor-item').click();
  await page.locator('#propName').fill('本地名称'); await page.locator('#selectionProps button[type=submit]').click();
  release(); await waitDone();
  await page.locator('#settingsBtn').click(); await page.locator('#aiRememberKey').check(); await page.locator('#aiSettingsForm button[type=submit]').click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('protolab.workspace.v1'))?.pending);
  await page.reload(); await page.locator('#aiToggleBtn').click();
  assert.equal(await page.locator('#aiPending').isVisible(), true);
  await page.locator('#mergeOpenBtn').click();
  assert.equal(await page.locator('.merge-conflict').count(), 1);
  await page.locator('#mergeApplyBtn').click(); assert.match(await page.locator('#mergeError').textContent(), /每项冲突/);
  await page.locator('.merge-conflict select').selectOption('ai');
  await page.screenshot({ path: resolve(output, 'ai-merge-conflict.png') });
  await page.locator('#mergeApplyBtn').click();
  await page.waitForTimeout(350);
  const workspace = await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.workspace.v1')));
  assert.equal(await page.locator('[data-item-id="ai-heading"] .item-label').textContent(), 'AI 名称');
  console.log('通过：冲突必须确认且选择 AI 后正确应用');

  const count = await page.locator('.editor-item').count();
  await send('非法返回'); await waitDone();
  assert.equal(await page.locator('.editor-item').count(), count); assert.match(await page.locator('#aiStatus').textContent(), /JSON/);
  await send('等待后修改名称'); await page.locator('#aiCancelBtn').click(); await waitDone();
  release(); assert.match(await page.locator('#aiStatus').textContent(), /取消/);
  console.log('通过：非法响应和取消请求不修改画布');

  await page.locator('#aiCloseBtn').click(); await page.locator('#versionsBtn').click();
  const versionsBefore = await page.locator('.version-row').count();
  assert.ok(versionsBefore >= 7);
  await page.locator('.version-row').last().locator('button').click();
  assert.equal(await page.locator('.editor-item').count(), 0);
  await page.locator('[data-close="versionsDialog"]').click();
  await page.locator('[data-comp-id="lib-text"]').click();
  await page.waitForTimeout(350); await page.reload();
  assert.equal(await page.locator('.editor-item').count(), 1);
  await page.locator('#versionsBtn').click();
  assert.equal(await page.locator('.version-row').count(), versionsBefore + 1);
  assert.ok(workspace.versions.entries.length > 1);
  const downloadPromise = page.waitForEvent('download'); await page.locator('#versionsExportBtn').click();
  const download = await downloadPromise; const archive = await readFile(await download.path(), 'utf8');
  assert.equal(archive.includes('mock-secret'), false);
  const data = JSON.parse(archive); assert.ok(data.versions.entries.some(entry => entry.mergeParent));
  await page.locator('#versionsFileInput').setInputFiles({ name: 'versions.json', mimeType: 'application/json', buffer: Buffer.from(archive) });
  await page.waitForFunction(size => document.querySelectorAll('.version-row').length === size, data.versions.entries.length * 2);
  await page.waitForTimeout(350); await page.reload();
  assert.equal(await page.locator('.editor-item').count(), 1);
  await page.locator('#aiToggleBtn').click();
  assert.match(await page.locator('#aiMessages').textContent(), /新增标题/);
  console.log('通过：历史回退、保留分支、刷新及无 Key 备份导入导出');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'ai-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []); console.log('通过：窄屏对话及无浏览器错误');

  const partial = await browser.newPage();
  await partial.goto(base); await partial.locator('[data-comp-id="lib-btn"]').click();
  await partial.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await partial.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'protolab.workspace.v1') throw new DOMException('版本存储配额不足', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await partial.locator('[data-comp-id="lib-text"]').click();
  await partial.waitForFunction(() => document.getElementById('saveState').textContent === '草稿未保存');
  assert.equal(await partial.evaluate(() => JSON.parse(localStorage.getItem('protolab.project.v1')).items.length), 2);
  await partial.reload(); assert.equal(await partial.locator('.editor-item').count(), 2);
  await partial.locator('#versionsBtn').click();
  assert.match(await partial.locator('.version-row').first().textContent(), /较新的本地草稿/);
  console.log('通过：版本写入失败时保留较新草稿，刷新不会恢复旧画布');
} finally { await browser?.close(); server?.kill(); }
