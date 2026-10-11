import { clickAction } from './browser-actions.mjs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4197';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4197' }, stdio: 'pipe' });
let browser;
try {
  for (let index = 0; index < 40; index++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
  await page.goto(base);
  const item = (id, content, x, y, width, height, extra = {}) => ({ id, name: id, type: 'html', content, x, y, width, height, radius: 0, padding: '0', margin: '0', ...extra });
  const data = { version: 1, canvas: { width: 600, height: 600, preset: 'custom' }, frame: { device: 'pc', style: 'none' }, items: [
    item('button', '<button style="width:100%;height:100%;font-size:14px;border:0;padding:4px 12px">按钮</button>', 40, 40, 112, 40),
    item('text', '<span style="font-size:14px">测试文本</span>', 40, 160, 80, 32),
    item('fixed', '<button style="width:100%;height:100%;font-size:14px">指定</button>', 350, 40, 112, 40, { appearance: { fontSize: 20 } }),
    item('edge', '<span style="font-size:14px">边界处的文字需要完整显示</span>', 500, 160, 100, 32),
    item('container', '<div></div>', 300, 300, 240, 160, { padding: '16px', container: { mode: 'grid', columns: 1, gap: 0 } }),
    item('child', '<button style="width:100%;height:100%;font-size:14px;border:0">子项</button>', 316, 316, 100, 40, { parentId: 'container', layoutBasis: { width: 100, height: 40 } }),
    item('card', '<div style="width:100%;height:100%;padding:12px"><strong style="font-size:18px">标题</strong><p style="font-size:12px">正文</p></div>', 40, 300, 200, 100),
  ] };
  await clickAction(page, '#importProjectBtn');
  await page.locator('#projectFileInput').setInputFiles({ name: '字号验收.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  const node = id => page.locator(`.editor-item[data-item-id="${id}"]`);
  const font = (id, selector = 'span') => node(id).locator(selector).first().evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  const props = async (id, width, height, text) => {
    await node(id).click({ position: { x: 5, y: 5 } });
    await page.locator('#propW').fill(String(width)); await page.locator('#propH').fill(String(height));
    if (text !== undefined) await page.locator('#textContentFields textarea').first().fill(text);
    await page.locator('#selectionProps button[type="submit"]').click();
  };
  await props('button', 224, 80);
  assert.equal(await font('button', 'button'), 28);
  await props('button', 224, 80, '这是一段需要自动拉长的按钮文字');
  const wide = await node('button').evaluate(element => parseFloat(element.style.width));
  assert.ok(wide > 224 && wide <= 560, `文案自动拉长：${wide}`);
  assert.equal(await font('button', 'button'), 28);
  await props('fixed', 224, 80);
  assert.equal(await font('fixed', 'button'), 20);
  await props('text', 160, 64);
  assert.equal(await font('text'), 28);
  await props('text', 80, 32);
  assert.equal(await font('text'), 14);
  await props('text', 160, 64);
  assert.equal(await font('text'), 28);
  const edgeFont = await font('edge'); assert.ok(edgeFont < 14 && edgeFont > 0);
  assert.equal(await node('edge').evaluate(element => parseFloat(element.style.width)), 100);
  const childFont = await font('child', 'button'); assert.ok(childFont > 14);
  await props('container', 240, 240);
  assert.ok(await font('child', 'button') > childFont);
  await props('card', 400, 200);
  assert.equal(await font('card', 'strong'), 36); assert.equal(await font('card', 'p'), 24);
  console.log('通过：默认字号随尺寸放大、长文案拉长、指定字号、反复缩放、屏幕及容器边界、复合字号层级');

  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame');
  for (let index = 0; index < 40 && await preview.locator('[data-name="button"] button').evaluate(element => parseFloat(getComputedStyle(element).fontSize)) !== 28; index++) await page.waitForTimeout(50);
  assert.equal(await preview.locator('[data-name="button"] button').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 28);
  await preview.getByRole('button', { name: '编辑文字与尺寸', exact: true }).click();
  await preview.locator('[data-name="text"]').click({ position: { x: 5, y: 5 } });
  const handle = await preview.locator('[data-resize="s"]').boundingBox();
  await page.mouse.move(handle.x + 6, handle.y + 6); await page.mouse.down(); await page.mouse.move(handle.x + 6, handle.y + 38, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(() => document.querySelector('.editor-item[data-item-id="text"]').style.height === '96px');
  assert.equal(await preview.locator('[data-name="text"] span').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 42);
  await page.locator('[data-close="previewDialog"]').click();
  await clickAction(page, '#undoBtn'); assert.equal(await font('text'), 28);
  await clickAction(page, '#redoBtn'); assert.equal(await font('text'), 42);
  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload(); assert.equal(await font('text'), 42);
  const download = page.waitForEvent('download'); await clickAction(page, '#exportHtmlBtn');
  const html = await readFile(await (await download).path(), 'utf8');
  const exported = await context.newPage(); await exported.setContent(html);
  assert.equal(await exported.locator('[data-name="text"] span').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 42);
  assert.equal(await exported.locator('[data-name="fixed"] button').evaluate(element => parseFloat(getComputedStyle(element).fontSize)), 20);
  assert.equal(await exported.locator('[data-name="button"]').evaluate(element => parseFloat(element.style.width)), wide);
  const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results'); await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, 'typography.png') });
  assert.deepEqual(errors, []);
  console.log('通过：预览即时缩放、画布同步、撤销重做、刷新恢复、独立网页导出，无脚本错误');
} finally { await browser?.close(); server?.kill(); }
