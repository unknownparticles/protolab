/** 多页、弹窗、点击动作与工程往返的独立浏览器验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4179';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4179' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const apply = () => page.locator('#selectionProps button[type="submit"]').click();
  const renamePage = async (name, start = false) => {
    await page.locator('#managePageBtn').click(); await page.locator('#pageName').fill(name);
    if (start) await page.locator('#pageStart').check();
    await page.locator('#pageForm button[type="submit"]').click();
  };
  const addButton = async (name, y, type = 'none', target) => {
    await page.locator('[data-comp-id="lib-btn"]').click();
    await page.locator('#propName').fill(name); await page.locator('#propY').fill(String(y));
    await page.locator('#propClickAction').selectOption(type);
    if (target) await page.locator('#propClickTarget').selectOption(target);
    await apply();
  };
  const action = async (name, type, target) => {
    await page.locator('#layerList button').filter({ hasText: name }).click();
    await page.locator('#propClickAction').selectOption(type);
    if (target) await page.locator('#propClickTarget').selectOption(target);
    await apply();
  };
  const selectPage = id => page.locator(`[data-page-id="${id}"]`).click();
  await addButton('进入详情', 100);
  await renamePage('首页');
  await page.locator('#addPageBtn').click();
  const details = await page.locator('#pageList .active').getAttribute('data-page-id');
  assert.equal(await page.locator('.editor-item').count(), 0);
  await renamePage('详情页'); await addButton('返回首页', 100, 'back'); await addButton('显示确认框', 180);
  await page.locator('#addPopupBtn').click();
  const popupId = await page.locator('#pageList .active').getAttribute('data-page-id');
  assert.equal(await page.locator('#canvasWidthInput').inputValue(), '320');
  assert.equal(await page.locator('#frameStyle').inputValue(), 'none');
  await renamePage('确认弹窗');
  await addButton('关闭确认框', 70, 'closePopup');
  await page.locator('#previewBtn').click();
  let preview = page.frameLocator('#previewFrame');
  await preview.locator('dialog[open]').waitFor();
  await preview.locator('[data-name="关闭确认框"]').click();
  await preview.locator('dialog[open]').waitFor({ state: 'hidden' });
  await page.locator('[data-close="previewDialog"]').click();
  await selectPage(details); await action('显示确认框', 'openPopup', popupId);
  await selectPage('page-home'); await action('进入详情', 'navigate', details);
  assert.equal(await page.locator('.editor-item').count(), 1);
  await page.locator('#previewBtn').click(); preview = page.frameLocator('#previewFrame');
  await preview.locator('[data-name="进入详情"]').click();
  await preview.locator('[data-prototype-page]:not([hidden]) [data-name="显示确认框"]').click();
  await preview.locator('dialog[open]').waitFor();
  await preview.locator('[data-name="关闭确认框"]').click();
  await preview.locator('dialog[open]').waitFor({ state: 'hidden' });
  await preview.locator('[data-name="显示确认框"]').click();
  await preview.locator('dialog[open]').waitFor();
  await page.keyboard.press('Escape');
  await preview.locator('dialog[open]').waitFor({ state: 'hidden' });
  // 原型弹窗的 Esc 不应关闭编辑器预览。
  assert.equal(await page.locator('#previewDialog').evaluate(node => node.open), true);
  await preview.locator('[data-name="显示确认框"]').click();
  await preview.locator('dialog[open]').waitFor();
  await preview.locator('body').click({ position: { x: 2, y: 2 }, force: true });
  await preview.locator('dialog[open]').waitFor({ state: 'hidden' });
  await preview.locator('[data-name="返回首页"]').click();
  await preview.locator('[data-name="进入详情"]').waitFor({ state: 'visible' });
  await preview.locator('[data-name="进入详情"]').focus(); await page.keyboard.press('Enter');
  await preview.locator('[data-name="返回首页"]').waitFor({ state: 'visible' });
  await preview.locator('#prototypeBack').click();
  await preview.locator('[data-name="进入详情"]').waitFor({ state: 'visible' });
  await page.locator('[data-close="previewDialog"]').click();
  console.log('通过：页面独立编辑、点击跳转与返回，预览弹窗、动作关闭、Esc、遮罩与键盘触发');

  await selectPage(details); await renamePage('详情首页', true);
  await selectPage('page-home');
  const downloading = async id => { const event = page.waitForEvent('download'); await page.locator(`#${id}`).click(); return readFile(await (await event).path(), 'utf8'); };
  const json = await downloading('exportProjectBtn'); const bundle = JSON.parse(json);
  assert.equal(bundle.project.pages.length, 3); assert.equal(bundle.project.startPageId, details);
  const html = await downloading('exportHtmlBtn');
  const exportedPath = resolve(output, 'multi-page-prototype.html'); await writeFile(exportedPath, html);
  const exported = await context.newPage(); exported.on('pageerror', error => errors.push(error.message));
  await exported.goto(pathToFileURL(exportedPath).href);
  await exported.locator('[data-name="显示确认框"]').waitFor({ state: 'visible' });
  await exported.locator('[data-name="显示确认框"]').click(); await exported.locator('dialog[open]').waitFor();
  await exported.screenshot({ path: resolve(output, 'pages-export-popup.png') });
  await exported.locator('dialog[open] .prototype-popup-heading button').click();
  await exported.locator('dialog[open]').waitFor({ state: 'hidden' });
  await exported.locator('#prototypeRestart').click();
  assert.equal(await exported.locator('[data-prototype-page]:not([hidden])').getAttribute('data-prototype-page'), details);
  const importFile = async (name, value) => {
    await page.locator('#importProjectBtn').click();
    await page.locator('#projectFileInput').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/html', buffer: Buffer.from(value) });
    await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  };
  const savedProject = () => page.evaluate(() => { const { savedAt, ...project } = JSON.parse(localStorage.getItem('protolab.project.v1')); return project; });
  await importFile('pages.json', json); assert.deepEqual(await savedProject(), bundle.project);
  await importFile('pages.html', html); assert.deepEqual(await savedProject(), bundle.project);
  await page.reload(); assert.deepEqual(await savedProject(), bundle.project);
  await selectPage(details); assert.equal(await page.locator('.editor-item').count(), 2);
  console.log('通过：独立文件直接打开、设置首页、完整工程 JSON / HTML 往返及刷新恢复');

  await selectPage(popupId); await page.locator('#managePageBtn').click(); await page.locator('#duplicatePageBtn').click();
  const copyId = await page.locator('#pageList .active').getAttribute('data-page-id');
  assert.notEqual(copyId, popupId); assert.equal(await page.locator('.editor-item').count(), 1);
  await page.locator('#managePageBtn').click(); await page.locator('#deletePageBtn').click();
  assert.equal(await page.locator(`[data-page-id="${copyId}"]`).count(), 0);
  await selectPage(popupId); await page.locator('#managePageBtn').click(); await page.locator('#deletePageBtn').click();
  await selectPage(details); await page.locator('#layerList button').filter({ hasText: '显示确认框' }).click();
  assert.equal(await page.locator('#propClickAction').inputValue(), 'none');
  // 删除后已回到设定首页；一次撤销恢复弹窗与关联动作。
  await page.locator('#undoBtn').click();
  assert.equal(await page.locator(`[data-page-id="${popupId}"]`).count(), 1);
  await page.locator('#redoBtn').click(); assert.equal(await page.locator(`[data-page-id="${popupId}"]`).count(), 0);
  await page.locator('#undoBtn').click();
  await selectPage(details); await page.locator('#layerList button').filter({ hasText: '显示确认框' }).click();
  assert.equal(await page.locator('#propClickAction').inputValue(), 'openPopup');
  assert.equal(await page.locator('#propClickTarget').inputValue(), popupId);
  await page.screenshot({ path: resolve(output, 'pages-editor.png') });
  console.log('通过：复制与删除弹窗、关联动作清理、撤销重做恢复');

  const baseline = await savedProject();
  const damaged = structuredClone(bundle); damaged.project.pages[1].items[0].interaction = { type: 'openPopup', targetId: 'missing' };
  // 校验未编辑页的数据，失败后保留整个工程。
  await page.locator('#importProjectBtn').click();
  await page.locator('#projectFileInput').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(damaged)) });
  await page.locator('#applyProjectImportBtn').click();
  await page.waitForFunction(() => !document.getElementById('applyProjectImportBtn').disabled);
  assert.match(await page.locator('#projectError').textContent(), /目标/);
  assert.deepEqual(await savedProject(), baseline);
  await page.locator('#projectDialog [data-close]').first().click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'pages-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('通过：损坏的跨页面引用拒绝导入、窄屏页面管理及无脚本异常');
} finally { await browser?.close(); server?.kill(); }
