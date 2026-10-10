/** 溢出画布的空白拖动、空格与中键平移，以及组件拖动和取消操作验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4192';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4192' }, stdio: 'pipe' });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, hasTouch: true }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-comp-id="lib-btn"]').click();
  await page.locator('#snapComponents').uncheck();
  await page.locator('#canvasPropertiesTab').click();
  await page.locator('#canvasWidthInput').fill('1400'); await page.locator('#canvasHeightInput').fill('1300');
  await page.locator('#applyCanvasSizeBtn').click();
  await page.locator('#componentPropertiesTab').click();
  await page.locator('#propX').fill('400'); await page.locator('#propY').fill('400');
  await page.locator('#selectionProps button[type="submit"]').click();
  const viewport = page.locator('#canvasViewport'), item = page.locator('.editor-item');
  const scroll = () => viewport.evaluate(node => [node.scrollLeft, node.scrollTop]);
  const position = () => item.evaluate(node => [node.style.left, node.style.top]);
  const seedScroll = () => viewport.evaluate(node => { node.scrollLeft = 160; node.scrollTop = 180; });
  const drag = async (point, dx, dy, button = 'left') => {
    await page.mouse.move(point.x, point.y); await page.mouse.down({ button });
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
    assert.equal(await viewport.evaluate(node => node.classList.contains('is-panning')), true);
    await page.mouse.up({ button });
    assert.equal(await viewport.evaluate(node => node.classList.contains('is-panning')), false);
  };
  await seedScroll();
  const view = await viewport.boundingBox(), blank = { x: view.x + 100, y: view.y + 100 };
  assert.equal(await page.evaluate(point => !!document.elementFromPoint(point.x, point.y)?.closest('#canvas'), blank), true);
  await drag(blank, -70, -90);
  assert.deepEqual(await scroll(), [230, 270], '空白拖动可同时浏览横向和纵向溢出区域');
  assert.deepEqual(await position(), ['400px', '400px']);
  assert.equal(await item.evaluate(node => node.classList.contains('selected')), true, '平移保留选中组件');
  await drag(blank, 70, 90);
  assert.deepEqual(await scroll(), [160, 180], '反向拖动返回原位置');

  const itemPoint = async () => { const rect = await item.boundingBox(); return { x: rect.x + 20, y: rect.y + 20 }; };
  await page.locator('#canvas').focus(); await page.keyboard.down('Space');
  assert.equal(await viewport.evaluate(node => node.classList.contains('pan-ready')), true);
  await drag(await itemPoint(), -50, -40);
  await page.keyboard.up('Space');
  assert.deepEqual(await scroll(), [210, 220], '空格允许从组件上拖动画布');
  assert.deepEqual(await position(), ['400px', '400px'], '空格平移不移动组件');
  await seedScroll();
  await drag(await itemPoint(), -30, -50, 'middle');
  assert.deepEqual(await scroll(), [190, 230], '中键允许从组件上拖动画布');
  assert.deepEqual(await position(), ['400px', '400px']);

  await seedScroll();
  const point = await itemPoint();
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 25, point.y + 35, { steps: 6 }); await page.mouse.up();
  assert.deepEqual(await position(), ['425px', '435px'], '普通左键仍拖动组件');
  assert.deepEqual(await scroll(), [160, 180]);
  await page.mouse.click(blank.x, blank.y);
  assert.equal(await item.evaluate(node => node.classList.contains('selected')), false, '单击空白仍取消选择');

  await page.mouse.move(blank.x, blank.y); await page.mouse.down();
  await page.mouse.move(blank.x - 20, blank.y - 20);
  await viewport.dispatchEvent('pointercancel'); await page.mouse.up();
  assert.equal(await viewport.evaluate(node => node.classList.contains('is-panning')), false, '取消指针清理拖动状态');
  await seedScroll();
  await drag(blank, -150, -150);
  assert.deepEqual(await scroll(), [310, 330], '移出视口后仍持续拖动，松手正常结束');
  await page.mouse.move(blank.x, blank.y); await page.mouse.down();
  await page.mouse.move(blank.x - 20, blank.y - 20); await page.keyboard.press('Escape');
  const cancelled = await scroll();
  await page.mouse.move(blank.x - 40, blank.y - 40); await page.mouse.up();
  assert.deepEqual(await scroll(), cancelled, 'Esc 结束平移，后续移动不再滚动画布');
  await page.locator('#canvas').focus(); await page.keyboard.down('Space');
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.keyboard.up('Space');
  assert.equal(await viewport.evaluate(node => node.classList.contains('pan-ready')), false, '窗口失焦清理空格状态');
  await page.locator('#canvasPropertiesTab').click();
  await page.locator('#canvasWidthInput').focus(); await page.keyboard.press('Space');
  assert.equal(await viewport.evaluate(node => node.classList.contains('pan-ready')), false, '输入框中的空格不会启用平移');

  await page.locator('#fitBtn').click();
  await page.waitForFunction(() => !document.querySelector('#canvasViewport').classList.contains('can-pan'));
  const fitted = await scroll();
  await page.mouse.move(blank.x, blank.y); await page.mouse.down();
  await page.mouse.move(blank.x - 40, blank.y - 40); await page.mouse.up();
  assert.deepEqual(await scroll(), fitted, '画布完整显示时不启动平移');

  await page.locator('#zoomSelect').selectOption('1'); await seedScroll();
  await page.mouse.move(view.x + view.width / 2, view.y + 200); await page.mouse.wheel(0, -80);
  await page.waitForFunction(() => Number(document.querySelector('#zoomSelect').value) > 1);
  await page.locator('#zoomSelect').selectOption('1');
  const cdp = await page.context().newCDPSession(page), x = view.x + view.width / 2, y = view.y + 200;
  const touches = distance => [{ x: x - distance / 2, y, id: 1 }, { x: x + distance / 2, y, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches(100) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touches(160) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(Math.abs(Number(await page.locator('#zoomSelect').inputValue()) - 1.6) < .001, '平移保留滚轮及真实双指缩放');
  assert.deepEqual(await position(), ['425px', '435px'], '捏合不会移动组件');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#zoomSelect').selectOption('1'); await seedScroll();
  const mobile = await viewport.boundingBox(), mobilePoint = { x: mobile.x + 100, y: mobile.y + 200 };
  await drag(mobilePoint, -40, -50);
  assert.deepEqual(await scroll(), [200, 230], '窄窗口也可拖动浏览画布');
  assert.deepEqual(errors, []);
  console.log('通过：画布空白、空格及中键双向平移，保留组件拖动与选择、滚轮及真实双指缩放，移出视口、取消和失焦清理、输入隔离、完整显示及窄窗口，无脚本错误');
} finally { await browser?.close(); server?.kill(); }
