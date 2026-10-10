/** 工程关联设置与轻量组件清单的端到端验收，使用本地 AI 桩。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4187';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4187' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const menuClick = async id => {
    const button = page.locator(`#${id}`);
    if (await button.isHidden()) {
      const menu = await button.evaluate(node => node.closest('[role="menu"]')?.id);
      if (menu) await page.locator(`[aria-controls="${menu}"]`).click();
    }
    await button.click();
  };
  const current = () => page.evaluate(() => { const catalog = JSON.parse(localStorage.getItem('protolab.projects.v1')); return catalog.entries.find(entry => entry.id === catalog.activeId); });
  const saved = () => page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.goto(base);
  await page.locator('#customTab').click(); await page.locator('#newGroupBtn').click(); await page.locator('#groupName').fill('品牌组件'); await page.locator('#groupForm button[type=submit]').click();
  await page.locator('#addHtmlCompBtn').click(); await page.locator('#customName').fill('品牌按钮');
  await page.locator('#customWidth').fill('180'); await page.locator('#customHeight').fill('48');
  await page.locator('#customCode').fill('<button style="width:100%;height:100%;background:#7c3aed;color:#fff">品牌登录</button>');
  await page.locator('#componentForm button[type=submit]').click(); await saved();
  const originalId = (await current()).id;
  const componentId = (await current()).library.find(item => item.name === '品牌按钮').id;
  await menuClick('engineeringSettingsBtn');
  await page.locator('#engineeringName').fill('品牌工程'); await page.locator('#engineeringPalette').selectOption('purple');
  await page.locator('#engineeringLibraryScope').selectOption('groups'); await page.locator('#engineeringLibraryGroups input').check();
  await page.locator('#engineeringSafeMode').selectOption('custom');
  for (const [edge, value] of [['Top', '24'], ['Right', '16'], ['Bottom', '20'], ['Left', '16']]) await page.locator(`#engineeringSafe${edge}`).fill(value);
  assert.match(await page.locator('#engineeringManifestSummary').textContent(), /1 个组件/);
  const manifestPromise = page.waitForEvent('download'); await page.locator('#exportEngineeringManifestBtn').click();
  const manifest = JSON.parse(await readFile(await (await manifestPromise).path(), 'utf8'));
  assert.equal(manifest.components[0].width, 180); assert.equal(manifest.components[0].name, '品牌按钮'); assert.equal('content' in manifest.components[0], false);
  await page.screenshot({ path: resolve(output, 'engineering-design-desktop.png') });
  await page.locator('#engineeringSubmitBtn').click();
  assert.equal((await current()).design.palette.colors.primary, '#7c3aed');
  await page.reload(); await menuClick('engineeringSettingsBtn');
  assert.equal(await page.locator('#engineeringSafeTop').inputValue(), '24'); assert.equal(await page.locator('#engineeringLibraryGroups input:checked').count(), 1);
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: resolve(output, 'engineering-design-mobile.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(await page.locator('#engineeringDialog').evaluate(node => node.scrollWidth <= node.clientWidth), true);
  await page.locator('[data-close="engineeringDialog"]').first().click(); await page.setViewportSize({ width: 1440, height: 1000 });
  console.log('通过：配色、组件分组、安全区保存与刷新，轻量清单导出，桌面及窄屏布局');
  await menuClick('newProjectBtn'); await page.locator('#engineeringName').fill('未关联工程'); await page.locator('#engineeringSubmitBtn').click();
  assert.equal((await current()).design.palette, null);
  await page.locator('#projectSelect').selectOption(originalId); assert.equal((await current()).design.palette.name, '商务紫');
  const exportPromise = page.waitForEvent('download'); await menuClick('exportProjectBtn');
  const archive = await readFile(await (await exportPromise).path(), 'utf8');
  assert.equal(JSON.parse(archive).details.design.safeArea.top, 24);
  await menuClick('engineeringSettingsBtn'); await page.locator('#engineeringPalette').selectOption('none'); await page.locator('#engineeringSubmitBtn').click();
  await menuClick('importProjectBtn'); await page.locator('#projectFileInput').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(archive) }); await page.locator('#applyProjectImportBtn').click();
  await page.locator('#projectDialog').waitFor({ state: 'hidden' }); await saved(); assert.equal((await current()).design.palette.name, '商务紫');
  console.log('通过：工程切换隔离关联设置，工程导出导入完整恢复');
  const requests = [];
  await page.route('https://ai.example.test/**', async route => {
    const request = route.request().postDataJSON(); const data = JSON.parse(request.messages.at(-1).content); requests.push(data);
    assert.equal(data.designContext.palette.colors.primary, '#7c3aed');
    assert.equal(data.designContext.library.components.length, 1); assert.equal(data.designContext.library.components[0].id, componentId);
    assert.equal(data.designContext.safeArea.top, 24); assert.equal(JSON.stringify(data.designContext).includes('品牌登录'), false);
    assert.match(request.messages[0].content, /必须遵循/);
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, name: '品牌登录', summary: '使用品牌组件', changes: [{ op: 'add', item: { id: `reuse-${data.mode}`, libraryId: componentId, x: 0, y: 0 } }] }) } }] }) });
  });
  await menuClick('settingsBtn'); await page.locator('#aiURL').fill('https://ai.example.test/v1'); await page.locator('#aiModel').fill('test-model'); await page.locator('#aiSettingsForm button[type=submit]').click();
  await menuClick('aiToggleBtn');
  for (const mode of ['modify', 'page', 'component']) {
    await page.locator('#aiMode').selectOption(mode); await page.locator('#aiRequirement').fill('生成品牌登录'); await page.locator('#aiSendBtn').click();
    await page.waitForFunction(() => document.getElementById('aiCancelBtn').hidden);
    if (mode !== 'modify') { await page.locator('#generationDialog').waitFor({ state: 'visible' }); await page.locator('#generationApplyBtn').click(); }
    await saved();
    const entry = await current();
    if (mode !== 'component') {
      assert.equal(entry.project.items[0].width, 180); assert.match(entry.project.items[0].content, /品牌登录/); assert.equal(entry.project.safeArea.top, 24); assert.equal(entry.project.items[0].x, 16);
      if (mode === 'page') assert.equal(entry.project.canvas.background, '#faf5ff');
    } else {
      const generated = entry.library.find(item => item.name === '品牌登录'); assert.equal(generated.defaultHeight, 48); assert.match(generated.content, /品牌登录/);
    }
  }
  assert.deepEqual(requests.map(request => request.mode), ['modify', 'page', 'component']); assert.deepEqual(errors, []);
  console.log('通过：三种智能模式遵循关联信息，按轻量标识复用真实组件，页面安全区实际约束布局');
} finally { await browser?.close(); server?.kill(); }
