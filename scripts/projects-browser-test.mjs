/** 工程隔离、独立生成与规范注入的浏览器验收；接口使用本地桩响应。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4181';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4181' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('protolab.projects.v1')));
  const current = async () => { const value = await store(); return value.entries.find(entry => entry.id === value.activeId); };
  const saved = () => page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.locator('[data-comp-id="lib-btn"]').click();
  await page.locator('#propName').fill('原工程按钮'); await page.locator('#selectionProps button[type=submit]').click();
  await page.locator('#addHtmlCompBtn').click(); await page.locator('#customName').fill('原工程组件');
  await page.locator('#componentForm button[type=submit]').click(); await saved();
  const originalId = (await store()).activeId;
  await page.locator('#newProjectBtn').click(); await page.locator('#engineeringName').fill('商城工程');
  await page.locator('#engineeringPreset').selectOption('pc'); await page.locator('#engineeringRules').fill('主色为紫色，卡片圆角十二像素');
  await page.locator('#engineeringSubmitBtn').click(); await saved();
  const shopId = (await store()).activeId;
  assert.notEqual(shopId, originalId); assert.equal(await page.locator('.editor-item').count(), 0);
  assert.equal(await page.locator('#customList button').count(), 0); assert.equal(await page.locator('#canvasWidthInput').inputValue(), '1280');
  assert.equal(await page.locator('#undoBtn').isDisabled(), true);
  await page.locator('[data-comp-id="lib-text"]').click();
  // 在自动保存延迟内切换也必须保留修改。
  await page.locator('#projectSelect').selectOption(originalId);
  assert.equal(await page.locator('.editor-item').count(), 1); assert.equal(await page.locator('#customList button').count(), 1);
  await page.locator('#projectSelect').selectOption(shopId); assert.equal(await page.locator('.editor-item').count(), 1);
  await page.reload(); assert.equal(await page.locator('#projectSelect').inputValue(), shopId);
  assert.equal((await current()).rules, '主色为紫色，卡片圆角十二像素');
  console.log('通过：创建、即时切换、刷新、画布和组件库隔离及撤销边界');

  await page.locator('#settingsBtn').click(); await page.locator('#aiURL').fill('https://generation.test/v1');
  await page.locator('#aiModel').fill('test-model'); await page.locator('#aiKey').fill('memory-only-secret');
  await page.locator('#aiSettingsForm button[type=submit]').click();
  let requestBody; let release;
  await page.route('https://generation.test/**', async route => {
    requestBody = route.request().postDataJSON();
    const task = JSON.parse(requestBody.messages.at(-1).content);
    if (task.requirement.includes('等待')) await new Promise(resolve => { release = resolve; });
    let changes = [{ op: 'add', item: { id: 'ai-card', name: '卡片', type: 'html', content: '<div style="padding:16px;background:#f3e8ff;border-radius:12px">欢迎商城</div>', x: 24, y: 80, width: 280, height: 100 } }];
    if (task.mode === 'page') changes.push({ op: 'add', item: { id: 'ai-button', name: '按钮', type: 'html', content: '<button style="background:#7c3aed;color:white;width:100%;height:100%">立即登录</button>', x: 24, y: 200, width: 280, height: 44 } });
    if (task.requirement === '生成非法页面') changes = [{ op: 'remove', id: 'existing' }];
    if (task.mode === 'modify') changes = [{ op: 'canvas', fields: { background: '#fafafa' } }];
    try { await route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ version: 1, name: task.mode === 'page' ? '商城登录页' : '欢迎卡片', summary: '已按工程规范生成', changes }) } }] } }); } catch {}
  });
  const send = async (mode, prompt) => {
    if (await page.locator('#aiPanel').isHidden()) await page.locator('#aiToggleBtn').click();
    await page.locator('#aiMode').selectOption(mode); await page.locator('#aiRequirement').fill(prompt); await page.locator('#aiSendBtn').click();
  };
  const waitDone = () => page.waitForFunction(() => document.getElementById('aiCancelBtn').hidden);
  await send('component', '生成欢迎卡片'); await page.locator('#generationDialog').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.editor-item').count(), 1);
  assert.equal(await page.locator('#customList button').count(), 0);
  assert.match(requestBody.messages[0].content, /主色为紫色/); assert.match(requestBody.messages[0].content, /内置设计规范/);
  assert.equal(requestBody.messages.length, 2); assert.equal(JSON.parse(requestBody.messages.at(-1).content).project.items.length, 0);
  assert.match(await page.frameLocator('#generationPreview').locator('body').textContent(), /欢迎商城/);
  await page.locator('#generationName').fill('商城欢迎卡片'); await page.locator('#generationApplyBtn').click(); await saved();
  assert.equal(await page.locator('#customList button').count(), 1); assert.equal(await page.locator('.editor-item').count(), 1);
  await page.locator('#customList button').click(); assert.equal(await page.locator('.editor-item').count(), 2);
  const beforePages = (await current()).project.pages.length;
  await send('page', '生成商城登录页'); await page.locator('#generationDialog').waitFor({ state: 'visible' });
  assert.equal((await current()).project.pages.length, beforePages);
  await page.screenshot({ path: resolve(output, 'projects-generation-preview.png') });
  await page.locator('#generationApplyBtn').click(); await saved();
  assert.equal(await page.locator('.editor-item').count(), 2);
  assert.equal((await current()).project.pages.length, beforePages + 1);
  assert.equal((await current()).project.pages[0].items.length, 2);
  await page.locator('#aiCloseBtn').click(); await page.locator('#undoBtn').click(); assert.equal(await page.locator('#pageList button').count(), beforePages);
  await page.locator('#redoBtn').click(); assert.equal(await page.locator('#pageList button').count(), beforePages + 1);
  await saved(); await page.reload(); assert.equal(await page.locator('#customList button').count(), 1);
  console.log('通过：规范注入、组件预览复用、新增可编辑页面、撤销重做及刷新恢复');

  // 设置和规范随工程导出，密钥不进入工程集合及导出文件。
  const download = page.waitForEvent('download'); await page.locator('#exportProjectBtn').click();
  const file = await download; const json = await readFile(await file.path(), 'utf8');
  assert.equal(JSON.parse(json).details.rules, '主色为紫色，卡片圆角十二像素'); assert.ok(!json.includes('memory-only-secret'));
  assert.ok(!JSON.stringify(await store()).includes('memory-only-secret'));
  await page.locator('#engineeringSettingsBtn').click(); await page.locator('#engineeringRules').fill('临时规范'); await page.locator('#engineeringSubmitBtn').click();
  await page.locator('#importProjectBtn').click(); await page.locator('#projectFileInput').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  assert.equal((await current()).rules, '主色为紫色，卡片圆角十二像素');

  const unchanged = JSON.stringify((await current()).project);
  // 刷新后重新填写仅存内存的 Key；接口 URL 和模型已经恢复。
  await send('page', '生成非法页面'); await waitDone();
  assert.match(await page.locator('#aiStatus').textContent(), /独立生成/);
  assert.equal(JSON.stringify((await current()).project), unchanged);
  await send('component', '等待生成卡片'); await page.waitForFunction(() => !document.getElementById('aiCancelBtn').hidden);
  await page.waitForTimeout(100); assert.ok(release);
  await page.locator('#projectSelect').selectOption(originalId);
  release(); await page.waitForTimeout(200);
  assert.equal(await page.locator('#generationDialog').isVisible(), false);
  assert.equal(await page.locator('#aiCancelBtn').isHidden(), true);
  assert.equal(await page.locator('#customList button').count(), 1);
  assert.equal((await current()).workspace.messages.length, 0);
  await page.locator('#projectSelect').selectOption(shopId);
  // 当前工程已有对话，等待新修改时切换到另一个工程不会污染其对话。
  assert.ok((await current()).workspace.messages.length > 0);
  await send('modify', '等待修改背景'); await page.waitForTimeout(100);
  await page.locator('#projectSelect').selectOption(originalId); release(); await page.waitForTimeout(200);
  assert.equal((await current()).project.canvas.background, undefined);
  assert.equal((await current()).workspace.messages.length, 0);
  console.log('通过：工程规范导入导出、非法生成拒绝、切换取消请求和迟到响应隔离');

  await page.locator('#projectSelect').selectOption(shopId);
  await send('modify', '等待产生待合并版本'); await page.waitForTimeout(100);
  await page.locator('#canvasWidthInput').fill('1200'); await page.locator('#applyCanvasSizeBtn').click();
  release(); await waitDone(); await saved(); assert.equal(await page.locator('#aiPending').isVisible(), true);
  await page.locator('#projectSelect').selectOption(originalId); assert.equal(await page.locator('#aiPending').isVisible(), false);
  await page.locator('#projectSelect').selectOption(shopId); assert.equal(await page.locator('#aiPending').isVisible(), true);
  await page.reload(); await page.locator('#aiToggleBtn').click(); assert.equal(await page.locator('#aiPending').isVisible(), true);
  await page.locator('#discardAIBtn').click(); await page.locator('#projectSelect').selectOption(originalId);
  console.log('通过：待合并版本随所属工程切换和刷新保留');

  // 工程集合写入失败必须阻止切换并保留内存中的编辑。
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === 'protolab.projects.v1') throw new DOMException('已满', 'QuotaExceededError'); return original.call(this, key, value); };
  });
  await page.locator('#projectSelect').selectOption(shopId);
  assert.equal(await page.locator('#projectSelect').inputValue(), originalId);
  assert.match(await page.locator('#toast').textContent(), /保存失败/);
  await page.reload(); await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#newProjectBtn').click(); await page.locator('#engineeringName').fill('移动端工程'); await page.locator('#engineeringSubmitBtn').click();
  assert.equal(await page.locator('.editor-item').count(), 0);
  await page.screenshot({ path: resolve(output, 'projects-mobile.png') });
  assert.deepEqual(errors, []); console.log('通过：存储失败阻止切换、窄屏新建及无页面异常');

  // 旧单工程草稿、组件库与对话首次使用新功能时完整迁移。
  const migrated = await browser.newPage();
  await migrated.addInitScript(entry => {
    localStorage.setItem('protolab.project.v1', JSON.stringify(entry.project));
    localStorage.setItem('protolab.library.v1', JSON.stringify({ version: 1, components: entry.library }));
    localStorage.setItem('protolab.workspace.v1', JSON.stringify(entry.workspace));
  }, (await store()).entries.find(entry => entry.id === shopId));
  await migrated.goto(base); assert.equal(await migrated.locator('#projectSelect option').count(), 1);
  assert.equal(await migrated.locator('.editor-item').count(), 2); assert.equal(await migrated.locator('#customList button').count(), 1);
  await migrated.locator('#newProjectBtn').click(); await migrated.locator('#engineeringName').fill('迁移后新工程'); await migrated.locator('#engineeringSubmitBtn').click();
  const value = await migrated.evaluate(() => JSON.parse(localStorage.getItem('protolab.projects.v1')));
  assert.equal(value.entries[0].project.pages.length, 2); assert.ok(value.entries[0].workspace.messages.length > 0);
  console.log('通过：已有单工程草稿、组件库、版本和对话迁移');
} finally { await browser?.close(); server?.kill(); }
