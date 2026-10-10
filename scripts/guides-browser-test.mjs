/** 标尺、网格、多选与对齐的浏览器验收；复用主验收的浏览器配置。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4175';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4175' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* 等待本地服务 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  // 自由移动回归关闭吸附；吸附与安全区由专门流程验证。
  await page.locator('#snapComponents').uncheck();
  const position = async () => [Number(await page.locator('#propX').inputValue()), Number(await page.locator('#propY').inputValue())];
  const positions = async () => page.locator('.editor-item').evaluateAll(nodes => nodes.map(node => [parseInt(node.style.left), parseInt(node.style.top)]));
  const align = direction => page.locator(`[data-align="${direction}"]`).click();
  const update = async fields => {
    for (const [name, value] of Object.entries(fields)) await page.locator(`#prop${name}`).fill(String(value));
    await page.locator('#selectionProps button[type="submit"]').click();
  };
  assert.equal(await page.locator('#rulerHorizontal').isVisible(), true);
  assert.equal(await page.locator('#canvasGrid').isVisible(), false);
  assert.equal(await page.locator('[data-align="center"]').isDisabled(), true);
  await page.locator('#showGrid').check(); await page.locator('#gridSize').selectOption('10');
  assert.equal(await page.locator('#canvasGrid').evaluate(node => getComputedStyle(node).backgroundSize), '10px 10px, 10px 10px');
  await page.locator('#showRulers').uncheck();
  assert.equal(await page.locator('#rulerHorizontal').isVisible(), false);
  assert.equal(await page.locator('#canvasGrid').isVisible(), true);
  await page.locator('#showRulers').check();
  for (const scale of ['0.25', '0.5', '1', '2']) {
    await page.locator('#zoomSelect').selectOption(scale);
    const canvas = await page.locator('#canvas').boundingBox();
    const horizontal = await page.locator('#rulerHorizontal').boundingBox();
    const vertical = await page.locator('#rulerVertical').boundingBox();
    assert.ok(Math.abs(horizontal.x - canvas.x) <= 1);
    assert.ok(Math.abs(vertical.y - canvas.y) <= 1);
    assert.equal(await page.locator('#rulerHorizontal svg').getAttribute('width'), String(375 * Number(scale)));
    assert.equal(await page.locator('#rulerVertical svg').getAttribute('height'), String(667 * Number(scale)));
  }
  await page.locator('#zoomSelect').selectOption('1');
  console.log('通过：辅助线独立开关、网格间距、缩放后的标尺原点与真实刻度');

  await page.locator('[data-comp-id="lib-btn"]').click();
  await update({ X: 20, Y: 30, W: 100, H: 40 });
  const firstId = await page.locator('.editor-item').getAttribute('data-item-id');
  const expected = { left: [0, 30], right: [275, 30], top: [275, 0], bottom: [275, 627], centerX: [138, 627], centerY: [138, 314] };
  for (const [direction, point] of Object.entries(expected)) { await align(direction); assert.deepEqual(await position(), point); }
  await page.locator('#undoBtn').click(); assert.deepEqual(await position(), [138, 627]);
  await page.locator('#redoBtn').click(); assert.deepEqual(await position(), [138, 314]);
  await update({ X: 20, Y: 30 });
  await align('center'); assert.deepEqual(await position(), [138, 314]);
  await page.locator('#undoBtn').click(); assert.deepEqual(await position(), [20, 30]);
  await page.locator('#alignReference').selectOption('selection');
  assert.equal(await page.locator('[data-align="center"]').isDisabled(), true);
  await page.locator('#alignReference').selectOption('canvas');
  console.log('通过：七种画布对齐、奇数尺寸居中、撤销重做与单选禁用互相对齐');

  await page.locator('[data-comp-id="lib-text"]').click();
  await update({ X: 180, Y: 200, W: 60, H: 80 });
  const secondId = await page.locator('.editor-item.selected').getAttribute('data-item-id');
  await page.locator(`#layerList [data-item-id="${firstId}"]`).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.editor-item.selected').count(), 2);
  await page.locator('#alignReference').selectOption('selection');
  const groupExpected = { left: [[20, 30], [20, 200]], right: [[140, 30], [180, 200]], top: [[20, 30], [180, 30]], bottom: [[20, 240], [180, 200]], centerX: [[80, 30], [100, 200]], centerY: [[20, 135], [180, 115]], center: [[80, 135], [100, 115]] };
  for (const [direction, points] of Object.entries(groupExpected)) {
    await align(direction); assert.deepEqual(await positions(), points);
    await page.locator('#undoBtn').click(); assert.deepEqual(await positions(), [[20, 30], [180, 200]]);
  }
  await page.locator('#zoomSelect').selectOption('0.5');
  const first = page.locator(`#canvas [data-item-id="${firstId}"]`);
  let box = await first.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y + 30, { steps: 5 }); await page.mouse.up();
  assert.deepEqual(await positions(), [[70, 70], [230, 240]]);
  await page.locator('#undoBtn').click(); assert.deepEqual(await positions(), [[20, 30], [180, 200]]);
  await page.locator('#canvas').focus(); await page.keyboard.press('Shift+ArrowLeft');
  assert.deepEqual(await positions(), [[10, 30], [170, 200]]);
  await page.keyboard.press('Shift+ArrowLeft'); await page.keyboard.press('Shift+ArrowLeft');
  assert.deepEqual(await positions(), [[0, 30], [160, 200]]);
  box = await first.boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 35, box.y + 30, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  assert.deepEqual(await positions(), [[0, 30], [160, 200]]);
  assert.equal(await page.locator('.editor-item.selected').count(), 0);
  await first.click();
  await page.locator(`#canvas [data-item-id="${secondId}"]`).click({ modifiers: ['Shift'] });
  assert.equal(await page.locator('.editor-item.selected').count(), 2);
  await page.locator('#duplicateItemBtn').click(); assert.equal(await page.locator('.editor-item').count(), 4);
  assert.equal(await page.locator('.editor-item.selected').count(), 2);
  await page.locator('#deleteItemBtn').click(); assert.equal(await page.locator('.editor-item').count(), 2);
  console.log('通过：画布及图层多选、七种互相对齐、缩放下整组拖动、边界微调、取消、整组复制删除');

  await page.locator('#frameStyle').selectOption('classic');
  const canvas = await page.locator('#canvas').boundingBox();
  const ruler = await page.locator('#rulerVertical').boundingBox(); assert.ok(Math.abs(canvas.y - ruler.y) <= 1);
  await page.locator('#showRulers').uncheck();
  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload();
  assert.equal(await page.locator('#showRulers').isChecked(), false);
  assert.equal(await page.locator('#showGrid').isChecked(), true);
  assert.equal(await page.locator('#gridSize').inputValue(), '10');
  assert.deepEqual(await positions(), [[0, 30], [160, 200]]);
  await page.locator('#showRulers').check();
  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame'); await preview.locator('.prototype').waitFor();
  assert.equal(await preview.locator('.canvas-grid,.canvas-ruler').count(), 0);
  await page.locator('[data-close="previewDialog"]').click();
  const downloading = page.waitForEvent('download'); await page.locator('#exportHtmlBtn').click();
  const downloaded = await downloading; const html = await readFile(await downloaded.path(), 'utf8');
  assert.doesNotMatch(html, /canvas-grid|canvas-ruler|data-align/);
  await page.screenshot({ path: resolve(output, 'guides-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  assert.equal(await page.locator('body').evaluate(node => node.scrollWidth > innerWidth), false);
  await page.locator('#showRulers').uncheck(); await page.locator('#showGrid').uncheck();
  assert.equal(await page.locator('#canvasGrid').isVisible(), false);
  await page.locator('#showRulers').check(); await page.locator('#showGrid').check();
  await page.locator('[data-panel="properties"]').click();
  await page.locator(`#layerList [data-item-id="${firstId}"]`).click();
  await page.locator('#alignReference').selectOption('canvas'); await align('center');
  assert.deepEqual(await position(), [138, 314]);
  await page.locator('[data-panel="properties"]').click();
  await page.screenshot({ path: resolve(output, 'guides-mobile.png') });
  console.log('通过：设备外框原点、刷新恢复、预览导出、窄屏开关与居中');
  assert.deepEqual(errors, []);
} finally { await browser?.close(); server?.kill(); }
