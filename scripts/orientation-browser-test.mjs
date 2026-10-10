/** 方向切换、组件响应及工程往返的独立浏览器验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4178';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4178' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* 等待服务 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('#snapComponents').uncheck();
  await page.locator('#showStatusBar').check();
  await page.locator('#safeTop').fill('10'); await page.locator('#safeBottom').fill('10');
  await page.locator('#safeAreaEnabled').check();
  await page.locator('[data-comp-id="lib-btn"]').click();
  for (const [field, value] of Object.entries({ propName: '底部固定组件', propX: '24', propY: '600', propW: '300', propH: '40' })) await page.locator(`#${field}`).fill(value);
  await page.locator('#selectionProps button[type="submit"]').click();
  const geometry = async () => page.locator('.editor-item').evaluateAll(nodes => nodes.map(node => [node.style.left, node.style.top, node.style.width, node.style.height]));
  const initial = await geometry();
  await page.locator('#rotateBtn').click();
  assert.equal(await page.locator('#canvasHeightInput').inputValue(), '375');
  assert.deepEqual(await geometry(), initial);
  await page.locator('#propName').fill('底部固定组件已改名');
  await page.locator('#selectionProps button[type="submit"]').click();
  assert.deepEqual(await geometry(), initial);
  await page.locator('#rotateBtn').click(); assert.deepEqual(await geometry(), initial);
  await page.locator('#undoBtn').click(); assert.equal(await page.locator('#canvasHeightInput').inputValue(), '375');
  await page.locator('#redoBtn').click(); assert.equal(await page.locator('#canvasHeightInput').inputValue(), '667');
  console.log('通过：启用安全区的边缘组件保留坐标、尺寸，切换、属性编辑及撤销重做不重排');

  await page.locator('[data-comp-id="lib-btn"]').click();
  for (const [field, value] of Object.entries({ propName: '方向旋转组件', propX: '100', propY: '120', propW: '160', propH: '60' })) await page.locator(`#${field}`).fill(value);
  await page.locator('#propOrientationEnabled').check();
  await page.locator('#propLandscapeAction').selectOption('rotate90');
  await page.locator('#selectionProps button[type="submit"]').click();
  await page.locator('#addHtmlCompBtn').click();
  await page.locator('#customName').fill('横屏隐藏卡片');
  await page.locator('#customOrientationEnabled').check();
  await page.locator('#customLandscapeAction').selectOption('hide');
  await page.locator('#componentForm button[type="submit"]').click();
  await page.locator('#customList .component-item').click();
  assert.equal(await page.locator('#propLandscapeAction').inputValue(), 'hide');
  const portraitGeometry = await geometry();
  await page.locator('#rotateBtn').click();
  assert.deepEqual(await geometry(), portraitGeometry);
  const rotating = page.locator('.editor-item').nth(1), hidden = page.locator('.editor-item').nth(2);
  assert.equal(await rotating.evaluate(node => node.style.transform), 'rotate(90deg)');
  assert.equal(await hidden.isVisible(), false);
  assert.match(await page.locator('#layerList').textContent(), /横屏隐藏卡片 · 当前方向隐藏/);
  await page.locator('#layerList .layer-item').filter({ hasText: '横屏隐藏卡片' }).click();
  assert.equal(await page.locator('#propOrientationEnabled').isChecked(), true);
  await page.locator('#propOrientationEnabled').uncheck();
  await page.locator('#selectionProps button[type="submit"]').click();
  assert.equal(await hidden.isVisible(), true);
  await page.locator('#undoBtn').click(); assert.equal(await hidden.isVisible(), false);
  await page.locator('#redoBtn').click(); assert.equal(await hidden.isVisible(), true);
  await page.locator('#propOrientationEnabled').check();
  await page.locator('#selectionProps button[type="submit"]').click();
  await page.locator('#layerList .layer-item').filter({ hasText: '方向旋转组件' }).click();
  for (const [action, angle] of [['rotate180', 180], ['rotate270', -90], ['none', 0], ['rotate90', 90]]) {
    await page.locator('#propLandscapeAction').selectOption(action);
    await page.locator('#selectionProps button[type="submit"]').click();
    assert.equal(await rotating.evaluate(node => node.style.transform), angle ? `rotate(${angle}deg)` : '');
    assert.deepEqual(await geometry(), portraitGeometry);
  }
  await page.locator('#propPortraitAction').selectOption('hide');
  await page.locator('#selectionProps button[type="submit"]').click();
  await page.locator('#rotateBtn').click();
  assert.equal(await rotating.isVisible(), false); assert.equal(await hidden.isVisible(), true);
  await page.locator('#rotateBtn').click();
  assert.equal(await rotating.isVisible(), true); assert.equal(await hidden.isVisible(), false);
  console.log('通过：新建组件继承响应，分别设置横竖屏旋转和隐藏，图层修改隐藏组件，关闭及历史恢复');

  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload();
  assert.deepEqual(await geometry(), portraitGeometry);
  assert.equal(await rotating.evaluate(node => node.style.transform), 'rotate(90deg)');
  assert.equal(await hidden.isVisible(), false);
  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame');
  const previewRotating = preview.locator('.prototype-item').nth(1);
  await previewRotating.waitFor();
  assert.equal(await previewRotating.evaluate(node => node.style.transform), 'rotate(90deg)');
  assert.equal(await preview.locator('.prototype-item').nth(2).isVisible(), false);
  await page.locator('[data-close="previewDialog"]').click();
  const downloadFile = async id => {
    const downloading = page.waitForEvent('download'); await page.locator(`#${id}`).click();
    return readFile(await (await downloading).path(), 'utf8');
  };
  const html = await downloadFile('exportHtmlBtn');
  const exported = await context.newPage(); await exported.setContent(html);
  assert.equal(await exported.locator('.prototype-item').nth(1).evaluate(node => node.style.transform), 'rotate(90deg)');
  assert.equal(await exported.locator('.prototype-item').nth(2).isVisible(), false);
  assert.equal(await exported.locator('.prototype-item').first().evaluate(node => node.style.top), '600px');
  const library = JSON.parse(await downloadFile('exportLibBtn'));
  assert.deepEqual(library.components.find(component => component.name === '横屏隐藏卡片').orientationResponse, { enabled: true, portrait: 'none', landscape: 'hide' });
  const projectJSON = await downloadFile('exportProjectBtn');
  const importFile = async (name, mimeType, value) => {
    await page.locator('#importProjectBtn').click();
    await page.locator('#projectFileInput').setInputFiles({ name, mimeType, buffer: Buffer.from(value) });
    await page.locator('#applyProjectImportBtn').click();
    await page.locator('#projectDialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await geometry(), portraitGeometry);
    assert.equal(await page.locator('.editor-item').nth(1).evaluate(node => node.style.transform), 'rotate(90deg)');
    assert.equal(await page.locator('.editor-item').nth(2).isVisible(), false);
  };
  await importFile('方向工程.json', 'application/json', projectJSON);
  await importFile('方向原型.html', 'text/html', html);
  await page.locator('#rotateBtn').click();
  assert.deepEqual(await geometry(), portraitGeometry);
  assert.equal(await rotating.isVisible(), false); assert.equal(await hidden.isVisible(), true);
  await page.locator('#rotateBtn').click();
  await page.locator('#layerList .layer-item').filter({ hasText: '方向旋转组件' }).click();
  await page.screenshot({ path: resolve(output, 'orientation-editor.png') });
  console.log('通过：刷新、预览、独立 HTML 导出、组件库数据、工程 JSON / HTML 往返及方向恢复');
  assert.deepEqual(errors, []);
  console.log('屏幕方向浏览器验收全部通过；截图目录：' + output);
} finally { await browser?.close(); server?.kill(); }
