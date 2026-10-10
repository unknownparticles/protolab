/** 可选端到端验收；本地安装 playwright 或通过环境变量指定已安装模块。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { COMPONENTS } from '../src/presets.js';
const builtinCount = COMPONENTS.length;
const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4174';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4174' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* 等待开发服务器 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(base);
  await page.waitForSelector('.component-item');
  assert.equal(await page.locator('.component-item').count(), builtinCount);
  await page.screenshot({ path: resolve(output, 'desktop-empty.png') });
  console.log('通过：基础组件及桌面首屏');

  // 原稿 bug 回归：首个 pointerdown 选中后，仍能实际移动节点。
  await page.locator('[data-comp-id="lib-btn"]').click();
  let node = page.locator('.editor-item');
  let box = await node.boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.mouse.move(box.x + 85, box.y + 70, { steps: 8 }); await page.mouse.up();
  assert.equal(await page.locator('#propX').inputValue(), '97');
  assert.equal(await page.locator('#propY').inputValue(), '82');
  console.log('通过：首次选中并拖动');

  await page.locator('#propX').fill('0'); await page.locator('#propY').fill('0'); await page.locator('#propRadius').fill('0');
  await page.locator('#propName').fill('按钮 "测试" <名称>');
  await page.locator('#propPadding').fill('4px'); await page.locator('#propMargin').fill('2px');
  await page.locator('#selectionProps button[type="submit"]').click();
  assert.equal(await page.locator('#propX').inputValue(), '0');
  assert.equal(await page.locator('.editor-item > .prototype-item').evaluate(element => getComputedStyle(element).borderRadius), '0px');
  console.log('通过：零坐标、零圆角与名称');

  await page.locator('#canvas').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
  assert.equal(await page.locator('#propX').inputValue(), '1'); assert.equal(await page.locator('#propY').inputValue(), '10');
  await page.locator('#undoBtn').click(); assert.equal(await page.locator('#propY').inputValue(), '0');
  await page.locator('#redoBtn').click(); assert.equal(await page.locator('#propY').inputValue(), '10');
  await page.locator('#duplicateItemBtn').click(); assert.equal(await page.locator('.editor-item').count(), 2);
  await page.locator('#deleteItemBtn').click(); assert.equal(await page.locator('.editor-item').count(), 1);
  console.log('通过：微调、撤销、重做、复制、删除');

  await page.locator('#zoomSelect').selectOption('0.5');
  node = page.locator('.editor-item'); box = await node.boundingBox();
  await page.mouse.move(box.x + 15, box.y + 10); await page.mouse.down();
  await page.mouse.move(box.x + 40, box.y + 30, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.locator('#propX').inputValue(), '51'); assert.equal(await page.locator('#propY').inputValue(), '50');
  const canvasBox = await page.locator('#canvas').boundingBox();
  await page.locator('[data-comp-id="lib-text"]').dragTo(page.locator('#canvas'), { targetPosition: { x: 100, y: 120 } });
  assert.equal(await page.locator('.editor-item').count(), 2);
  assert.equal(await page.locator('#propX').inputValue(), '200');
  assert.equal(await page.locator('#propY').inputValue(), '240');
  console.log('通过：缩放后的拖动与库组件放置');

  await page.locator('#canvasWidthInput').fill('432'); await page.locator('#canvasHeightInput').fill('876');
  await page.locator('#applyCanvasSizeBtn').click(); await page.locator('#rotateBtn').click();
  assert.equal(await page.locator('#canvasWidthInput').inputValue(), '876');
  assert.equal(await page.locator('#canvasHeightInput').inputValue(), '432');
  await page.locator('#rotateBtn').click();
  await page.locator('[data-preset="pc"]').click();
  assert.match(await page.locator('#presetLabel').textContent(), /横屏/);
  await page.locator('[data-preset="phone"]').click();
  await page.locator('#zoomSelect').selectOption('1');
  console.log('通过：预设、自定义与旋转');

  assert.equal(await page.locator('#presetList .component-item').count(), 14);
  assert.equal(await page.locator('#vectorList .component-item').count(), 9);
  await page.locator('#frameStyle').selectOption('classic');
  assert.equal(await page.locator('.device-home').count(), 1);
  await page.locator('#showStatusBar').check();
  await page.locator('#statusTime').fill('13:20'); await page.locator('#statusTime').press('Tab');
  await page.locator('#statusBattery').fill('67'); await page.locator('#statusBattery').press('Tab');
  await page.locator('#navigationStyle').selectOption('buttons');
  assert.match(await page.locator('.device-status').textContent(), /13:20.*67%/);
  assert.equal(await page.locator('.device-navigation.buttons').count(), 1);
  await page.locator('#undoBtn').click(); assert.equal(await page.locator('.device-navigation').count(), 0);
  await page.locator('#redoBtn').click(); assert.equal(await page.locator('.device-navigation.buttons').count(), 1);
  await page.locator('#navigationStyle').selectOption('gesture');
  assert.equal(await page.locator('.device-gesture').count(), 1);
  await page.locator('[data-preset="tablet"]').click();
  for (const style of ['modern', 'classic']) {
    await page.locator('#frameStyle').selectOption(style);
    assert.equal(await page.locator(`#deviceShell.tablet-${style}`).count(), 1);
    assert.equal(await page.locator('.device-status').count(), 1);
  }
  await page.locator('[data-preset="pc"]').click();
  for (const style of ['monitor', 'laptop', 'browser']) {
    await page.locator('#frameStyle').selectOption(style);
    assert.equal(await page.locator(`#deviceShell.pc-${style}`).count(), 1);
    assert.equal(await page.locator('.device-status,.device-navigation').count(), 0);
  }
  await page.locator('[data-preset="phone"]').click();
  await page.locator('#frameStyle').selectOption('none');
  assert.equal(await page.locator('#deviceShell').evaluate(element => element.clientWidth), 375);
  await page.locator('#frameStyle').selectOption('custom');
  await page.locator('#frameCode').fill('<script>alert(1)</script>');
  await page.locator('#frameForm button[type="submit"]').click();
  assert.match(await page.locator('#frameError').textContent(), /可用/);
  await page.locator('#frameCode').fill('<style>body{display:none}</style><div onclick="alert(1)" style="width:100%;height:100%;background:#17324d;border-radius:24px"><span style="position:absolute;bottom:2px;left:32px;color:white;font-size:12px">自定义外框</span><script>alert(1)</script></div>');
  for (const [id, value] of Object.entries({ frameTop: '10', frameRight: '16', frameBottom: '24', frameLeft: '18' })) await page.locator(`#${id}`).fill(value);
  await page.locator('#frameForm button[type="submit"]').click();
  assert.equal(await page.locator('#deviceShell').evaluate(element => element.clientWidth), 409);
  assert.equal(await page.locator('#deviceShell').evaluate(element => element.clientHeight), 701);
  assert.equal(await page.locator('#deviceShell script,#deviceShell style,#deviceShell [onclick]').count(), 0);
  assert.match(await page.locator('.device-decoration').textContent(), /自定义外框/);
  await page.locator('#undoBtn').click(); assert.equal(await page.locator('#frameStyle').inputValue(), 'none');
  await page.locator('#redoBtn').click(); assert.equal(await page.locator('#frameStyle').inputValue(), 'custom');
  await page.locator('#editFrameBtn').click(); await page.locator('[data-close="frameDialog"]').first().click();
  assert.equal(await page.locator('#frameStyle').inputValue(), 'custom');
  console.log('通过：各设备外框、系统栏、时间电量、自定义 HTML 清理、留白和撤销重做');

  await page.locator('#addHtmlCompBtn').click(); await page.locator('#customName').fill('欢迎卡片');
  await page.locator('#customCode').fill('<style>body{display:none}</style><div onclick="alert(1)" style="background:#eff6ff;width:100%;height:100%;padding:12px">欢迎<script>alert(1)</script></div>');
  await page.locator('#componentForm button[type="submit"]').click();
  assert.equal(await page.locator('#customList .component-item').count(), 1);
  await page.locator('#customList .component-item').click();
  assert.equal(await page.locator('.editor-item script,.editor-item style,.editor-item [onclick]').count(), 0);
  assert.equal(await page.locator('body').isVisible(), true);
  await page.locator('#addSvgCompBtn').click(); await page.locator('#customName').fill('圆形');
  await page.locator('#componentForm button[type="submit"]').click();
  assert.equal(await page.locator('#customList .component-item').count(), 2);
  await page.locator('#componentSearch').fill('圆形'); assert.equal(await page.locator('.component-item').count(), 2);
  await page.locator('#componentSearch').fill('');
  console.log('通过：HTML、SVG 创建、内容清理与搜索');

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG4cAAAAASUVORK5CYII=', 'base64');
  await page.locator('#imgFileInput').setInputFiles({ name: '测试图片.png', mimeType: 'image/png', buffer: png });
  await page.locator('#componentDialog').waitFor({ state: 'visible' });
  await page.locator('#componentForm button[type="submit"]').click();
  assert.equal(await page.locator('#customList .component-item').count(), 3);
  console.log('通过：图片导入');

  const libraryDownload = page.waitForEvent('download'); await page.locator('#exportLibBtn').click();
  const libraryFile = await libraryDownload;
  const libraryData = JSON.parse(await readFile(await libraryFile.path(), 'utf8'));
  assert.equal(libraryData.components.length, builtinCount + 3);
  await page.locator('#libFileInput').setInputFiles({ name: '旧版.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify([{ id: 'legacy', name: '旧版组件', type: 'custom', html: '<div>兼容导入</div>', defaultWidth: 100, defaultHeight: 40 }])) });
  await page.waitForFunction(() => document.getElementById('libCount').textContent === '24');
  assert.equal(await page.locator('.editor-item').count(), 3);
  await page.locator('#libFileInput').setInputFiles({ name: '无效.json', mimeType: 'application/json', buffer: Buffer.from('[{"name":"无内容"}]') });
  await page.waitForFunction(() => document.getElementById('toast').classList.contains('error'));
  assert.equal(await page.locator('.component-item').count(), builtinCount + 1);
  await page.locator('#libFileInput').setInputFiles({ name: '恢复.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(libraryData)) });
  await page.waitForFunction(() => document.getElementById('libCount').textContent === '26');
  console.log('通过：JSON 导出、旧版导入、无效文件不改变组件库');

  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload(); await page.waitForSelector('.editor-item');
  assert.equal(await page.locator('.editor-item').count(), 3); assert.equal(await page.locator('.component-item').count(), builtinCount + 3);
  assert.equal(await page.locator('#frameStyle').inputValue(), 'custom');
  assert.match(await page.locator('.device-status').textContent(), /13:20.*67%/);
  assert.equal(await page.locator('.device-gesture').count(), 1);
  console.log('通过：组件库与草稿刷新恢复');

  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame');
  await preview.locator('.prototype').waitFor();
  assert.equal(await preview.locator('.prototype').evaluate(element => element.clientHeight), 667);
  assert.equal(await preview.locator('.prototype-item').count(), 3);
  assert.match(await preview.locator('.device-status').textContent(), /13:20.*67%/);
  assert.equal(await preview.locator('.device-shell').evaluate(element => element.clientWidth), 409);
  await page.locator('[data-close="previewDialog"]').click();
  const prototypeDownload = page.waitForEvent('download'); await page.locator('#exportHtmlBtn').click();
  const prototypeFile = await prototypeDownload;
  const prototype = await readFile(await prototypeFile.path(), 'utf8');
  const exported = await context.newPage(); await exported.setContent(prototype);
  assert.equal(await exported.locator('.prototype').evaluate(element => element.clientHeight), 667);
  assert.equal(await exported.locator('.prototype').evaluate(element => element.clientWidth), 375);
  assert.match(await exported.locator('.device-decoration').textContent(), /自定义外框/);
  assert.equal(await exported.locator('.device-shell').evaluate(element => element.clientHeight), 701);
  assert.equal(await exported.locator('.prototype-item').first().getAttribute('data-name'), '按钮 "测试" <名称>');
  const properties = ['width','height','padding','margin','borderRadius','backgroundColor','display','boxShadow'];
  const editorStyles = await page.locator('.editor-item > .prototype-item').evaluateAll((elements, properties) => elements.map(element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]))), properties);
  const exportStyles = await exported.locator('.prototype-item').evaluateAll((elements, properties) => elements.map(element => Object.fromEntries(properties.map(property => [property, getComputedStyle(element)[property]]))), properties);
  assert.deepEqual(exportStyles, editorStyles);
  console.log('通过：预览及独立 HTML 导出尺寸、样式、名称一致');
  await page.screenshot({ path: resolve(output, 'desktop-editor.png') });

  await page.setViewportSize({ width: 390, height: 844 }); await page.reload();
  await page.waitForSelector('.editor-item');
  assert.equal(await page.locator('body').evaluate(element => element.scrollWidth > innerWidth), false);
  await page.locator('[data-panel="library"]').click(); assert.equal(await page.locator('#libraryPanel').isVisible(), true);
  await page.locator('[data-panel="properties"]').click(); assert.equal(await page.locator('#propertiesPanel').isVisible(), true);
  assert.equal(await page.locator('#libraryPanel').isVisible(), false);
  await page.locator('[data-panel="properties"]').click();
  await page.screenshot({ path: resolve(output, 'mobile-editor.png') });
  console.log('通过：窄屏面板折叠和画布浏览');

  const restricted = await context.newPage();
  await restricted.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('存储配额已满', 'QuotaExceededError'); }; });
  await restricted.goto(base); await restricted.locator('[data-comp-id="lib-btn"]').click();
  await restricted.waitForFunction(() => document.getElementById('saveState').textContent === '草稿未保存');
  assert.equal(await restricted.locator('.editor-item').count(), 4);
  assert.match(await restricted.locator('#toast').textContent(), /未保存/);
  console.log('通过：存储不可用时保留内存设计并提示');
  const stress = await context.newPage();
  const projectSeed = await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.project.v1')));
  projectSeed.items = Array.from({ length: 200 }, (_, index) => ({ ...projectSeed.items[1], id: `stress-${index}`, x: index % 10 * 20, y: Math.floor(index / 10) * 20 }));
  await stress.addInitScript(seed => localStorage.setItem('protolab.project.v1', JSON.stringify(seed)), projectSeed);
  const started = performance.now();
  await stress.goto(base); await stress.waitForSelector('.editor-item');
  assert.equal(await stress.locator('.editor-item').count(), 200);
  const renderTime = Math.round(performance.now() - started);
  await stress.locator('[data-comp-id="lib-btn"]').click();
  assert.equal(await stress.locator('.editor-item').count(), 200);
  assert.match(await stress.locator('#toast').textContent(), /最多 200/);
  await stress.locator('.layer-item').first().click();
  await stress.locator('#layerDownBtn').click();
  assert.equal(await stress.locator('#layerList .layer-item').nth(1).evaluate(element => element.classList.contains('selected')), true);
  console.log(`通过：200 组件加载与数量限制、图层排序（本机加载 ${renderTime} ms）`);

  const damagedContext = await browser.newContext();
  const damaged = await damagedContext.newPage();
  await damaged.addInitScript(() => { localStorage.setItem('protolab.project.v1', '{broken'); localStorage.setItem('protolab.library.v1', '{broken'); });
  await damaged.goto(base); await damaged.waitForSelector('.component-item');
  assert.equal(await damaged.locator('.component-item').count(), builtinCount);
  assert.equal(await damaged.locator('.editor-item').count(), 0);
  assert.match(await damaged.locator('#toast').textContent(), /读取失败/);
  console.log('通过：损坏存储回退且保留原始数据');
  await damagedContext.close();

  const controlsContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const controls = await controlsContext.newPage();
  controls.on('pageerror', error => errors.push(error.message));
  await controls.goto(base);
  assert.equal(await controls.locator('.device-cutout.island').count(), 1);
  await controls.locator('#showStatusBar').check();
  for (const camera of ['notch', 'island', 'punch-center', 'punch-left']) {
    await controls.locator('#cameraStyle').selectOption(camera);
    const mask = await controls.locator('.device-cutout').boundingBox();
    const screen = await controls.locator('#canvas').boundingBox();
    assert.ok(mask.x >= screen.x && mask.y >= screen.y && mask.x + mask.width <= screen.x + screen.width && mask.y + mask.height <= screen.y + screen.height);
    const coversScreen = await controls.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.device-cutout'), { x: mask.x + mask.width / 2, y: mask.y + mask.height / 2 });
    assert.equal(coversScreen, true);
    for (const selector of ['.device-status > span:first-child', '.device-indicators']) {
      const text = await controls.locator(selector).boundingBox();
      assert.ok(text.x + text.width <= mask.x || text.x >= mask.x + mask.width || text.y + text.height <= mask.y || text.y >= mask.y + mask.height, `${camera} 不应遮挡时间电量`);
    }
  }
  await controls.locator('#cameraStyle').selectOption('none');
  assert.equal(await controls.locator('.device-cutout').count(), 0);
  await controls.locator('#undoBtn').click(); assert.equal(await controls.locator('#cameraStyle').inputValue(), 'punch-left');
  await controls.locator('#redoBtn').click(); assert.equal(await controls.locator('.device-cutout').count(), 0);
  await controls.locator('#cameraStyle').selectOption('notch');
  await controls.locator('#rotateBtn').click();
  assert.equal(await controls.locator('.device-cutout.notch.landscape').count(), 1);
  assert.equal(await controls.locator('.device-cutout').evaluate(element => element.offsetLeft), 0);
  await controls.locator('#rotateBtn').click();
  await controls.locator('#frameStyle').selectOption('classic');
  assert.equal(await controls.locator('.device-cutout').count(), 0);
  await controls.locator('#frameStyle').selectOption('modern');
  await controls.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await controls.reload();
  assert.equal(await controls.locator('.device-cutout.notch').count(), 1);
  await controls.locator('#previewBtn').click();
  assert.equal(await controls.frameLocator('#previewFrame').locator('.device-cutout.notch').count(), 1);
  await controls.locator('[data-close="previewDialog"]').click();
  const cameraDownload = controls.waitForEvent('download'); await controls.locator('#exportHtmlBtn').click();
  const cameraFile = await cameraDownload;
  const cameraExport = await controlsContext.newPage(); await cameraExport.setContent(await readFile(await cameraFile.path(), 'utf8'));
  assert.equal(await cameraExport.locator('.device-cutout.notch').count(), 1);
  const cameraProperties = ['left', 'top', 'width', 'height', 'zIndex', 'borderRadius'];
  const readCameraStyle = (element, properties) => properties.map(property => getComputedStyle(element)[property]);
  assert.deepEqual(await cameraExport.locator('.device-cutout').evaluate(readCameraStyle, cameraProperties), await controls.locator('.device-cutout').evaluate(readCameraStyle, cameraProperties));
  await cameraExport.close();
  console.log('通过：刘海、灵动岛、打孔实际遮挡屏幕，状态栏避让、横屏旋转、历史、恢复和导出一致');
  for (const [id, x, y] of [['lib-slider', 30, 60], ['lib-textarea', 30, 120], ['lib-svg-line', 30, 260], ['lib-svg-circle', 30, 320], ['lib-svg-rect', 170, 320]]) {
    await controls.locator(`[data-comp-id="${id}"]`).click();
    await controls.locator('#propX').fill(String(x)); await controls.locator('#propY').fill(String(y));
    await controls.locator('#selectionProps button[type="submit"]').click();
  }
  assert.equal(await controls.locator('.vector-item').count(), 3);
  assert.equal(await controls.locator('.vector-item').first().evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  assert.equal(await controls.locator('#propRadius').inputValue(), '0');
  await controls.locator('#previewBtn').click();
  const controlsPreview = controls.frameLocator('#previewFrame');
  await controlsPreview.locator('input[type="range"]').focus();
  await controlsPreview.locator('input[type="range"]').press('ArrowRight');
  assert.equal(await controlsPreview.locator('input[type="range"]').inputValue(), '51');
  await controlsPreview.locator('textarea').fill('多行\n文本');
  assert.equal(await controlsPreview.locator('textarea').inputValue(), '多行\n文本');
  assert.equal(await controlsPreview.locator('.vector-item').count(), 3);
  await controls.locator('[data-close="previewDialog"]').click();
  await controls.locator('#vectorList').scrollIntoViewIfNeeded();
  await controls.screenshot({ path: resolve(output, 'desktop-components.png') });
  await controlsContext.close();
  console.log('通过：滑杆和多行文本框在预览中可操作，矢量图形保持透明底及零圆角');
  assert.deepEqual(errors, []);
  console.log('浏览器验收全部通过；截图目录：' + output);
} finally { await browser?.close(); server?.kill(); }
