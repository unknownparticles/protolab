import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4206';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4206' }, stdio: 'pipe' });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (window !== window.top) return;
    localStorage.clear();
    localStorage.setItem('protolab.project.v1', JSON.stringify({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' },
      frame: { device: 'phone', style: 'none', camera: 'none' }, items: ['first', 'second', 'outside'].map((id, i) => ({
        id, name: id, type: 'html', content: '<button>按钮</button>', x: i === 2 ? 250 : 40, y: i === 2 ? 300 : 60 + i * 70, width: 100, height: 40,
      })) }));
    localStorage.setItem('protolab.ai.settings.v1', JSON.stringify({ url: 'https://selection.example.test/v1', model: 'mock' }));
  });
  let body, release;
  await page.route('https://selection.example.test/**', async route => {
    body = route.request().postDataJSON();
    const data = JSON.parse(body.messages.at(-1).content);
    let changes = [];
    if (data.requirement === '优化') changes = data.selectionScope.itemIds.map(id => ({ op: 'update', id, fields: { name: `${id}优化` } }));
    if (data.requirement === '越界') changes = [{ op: 'update', id: 'outside', fields: { name: '越界名称' } }];
    if (data.requirement === '等待优化') { changes = [{ op: 'update', id: 'first', fields: { name: '合并优化' } }]; await new Promise(resolve => { release = resolve; }); }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, summary: data.requirement, changes }) } }] }) });
  });
  await page.goto(base); await page.locator('.editor-item').first().waitFor();
  await page.locator('#zoomSelect').selectOption('0.75');
  const draw = async (start, end, shift = false) => {
    const b = await page.locator('#canvas').boundingBox(), scale = b.width / await page.locator('#canvas').evaluate(node => node.offsetWidth);
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.move(b.x + start[0] * scale, b.y + start[1] * scale); await page.mouse.down();
    await page.mouse.move(b.x + end[0] * scale, b.y + end[1] * scale, { steps: 8 }); await page.mouse.up();
    if (shift) await page.keyboard.up('Shift');
  };
  const selected = () => page.locator('.editor-item.selected').evaluateAll(nodes => nodes.map(node => node.dataset.itemId));
  await page.locator('#marqueeBtn').click();
  await draw([30, 50], [150, 180]); assert.deepEqual(await selected(), ['first', 'second']);
  await draw([360, 350], [240, 290], true); assert.deepEqual(await selected(), ['first', 'second', 'outside']);
  await draw([150, 180], [30, 50]); assert.deepEqual(await selected(), ['first', 'second']);
  // Escape cancels the active marquee and retains its original selection.
  const b = await page.locator('#canvas').boundingBox();
  await page.mouse.move(b.x + 10, b.y + 10); await page.mouse.down(); await page.mouse.move(b.x + 20, b.y + 20);
  await page.keyboard.press('Escape'); await page.mouse.up(); assert.deepEqual(await selected(), ['first', 'second']);
  assert.equal(await page.locator('#marqueeBtn').getAttribute('aria-pressed'), 'false');
  await page.locator('#optimizeSelectionBtn').click(); assert.equal(await page.locator('#aiMode').inputValue(), 'selection');
  assert.match(await page.locator('#aiSelectionSummary').textContent(), /2 个组件/);
  assert.equal(await page.locator('#aiLayoutRows tr').count(), 2);
  await page.screenshot({ path: '/private/tmp/protolab-selection.png' });
  const send = async text => { await page.locator('#aiRequirement').fill(text); await page.locator('#aiSendBtn').click(); };
  const done = () => page.waitForFunction(() => document.getElementById('aiCancelBtn').hidden);
  await send('优化'); await done();
  assert.deepEqual(JSON.parse(body.messages.at(-1).content).selectionScope.itemIds, ['first', 'second']);
  assert.match(await page.locator('[data-item-id="first"] .item-label').textContent(), /优化/);
  assert.equal(await page.locator('[data-item-id="outside"] .item-label').textContent(), 'outside');
  await page.locator('#aiCloseBtn').click(); await page.locator('#marqueeBtn').click(); await draw([30, 50], [150, 180]); await page.locator('#optimizeSelectionBtn').click();
  await send('越界'); await done(); assert.match(await page.locator('#aiStatus').textContent(), /超出了所选/);
  assert.equal(await page.locator('[data-item-id="outside"] .item-label').textContent(), 'outside');
  await send('等待优化'); await page.waitForFunction(() => !document.getElementById('aiCancelBtn').hidden);
  while (!release) await new Promise(resolve => setTimeout(resolve, 20));
  await page.locator('#aiCloseBtn').click();
  await page.locator('.editor-item[data-item-id="outside"]').click({ position: { x: 20, y: 20 } });
  await page.locator('#propName').fill('本地外部修改'); await page.locator('#selectionProps button[type="submit"]').click();
  release(); await done(); assert.equal(await page.locator('#aiPending').isVisible(), true);
  assert.deepEqual(JSON.parse(body.messages.at(-1).content).selectionScope.itemIds, ['first', 'second']);
  await page.locator('#mergeOpenBtn').click(); await page.locator('#mergeApplyBtn').click();
  assert.equal(await page.locator('[data-item-id="first"] .item-label').textContent(), '合并优化');
  assert.equal(await page.locator('[data-item-id="outside"] .item-label').textContent(), '本地外部修改');
  await page.locator('#aiCloseBtn').click();
  await page.locator('#canvasPropertiesTab').click();
  await page.locator('#canvasWidthInput').fill('1000'); await page.locator('#canvasHeightInput').fill('1000');
  await page.locator('#applyCanvasSizeBtn').click(); await page.locator('#zoomSelect').selectOption('1');
  const viewport = page.locator('#canvasViewport');
  await viewport.evaluate(node => { node.scrollLeft = 150; node.scrollTop = 200; });
  const scroll = await viewport.evaluate(node => [node.scrollLeft, node.scrollTop]);
  await page.locator('#marqueeBtn').click();
  await draw([240, 290], [360, 350]);
  assert.deepEqual(await selected(), ['outside']);
  assert.deepEqual(await viewport.evaluate(node => [node.scrollLeft, node.scrollTop]), scroll);
  assert.deepEqual(errors, []);
  console.log('通过：缩放与滚动框选、反向框选、Shift 追加、取消、所选请求、越界拒绝及等待期间本地编辑合并');
} finally { await browser?.close(); server?.kill(); }
