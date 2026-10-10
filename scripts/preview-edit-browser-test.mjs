import { clickAction } from './browser-actions.mjs';
/** 多页、弹窗、点击动作与工程往返的独立浏览器验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4185';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4185' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const canvas = { width: 600, height: 500, preset: 'custom' };
  const frame = { device: 'pc', style: 'none' };
  const item = (id, content, x, y, width, height, extra = {}) => ({ id, name: id, type: 'html', content, x, y, width, height, radius: 0, padding: '0', margin: '0', ...extra });
  const card = item('card', '<div style="width:100%;height:100%;padding:20px;background:#f8fafc"><strong>原始标题</strong><p>保留正文 <b>强调</b> 尾部</p></div>', 40, 40, 240, 128, { interaction: { type: 'navigate', targetId: 'details' } });
  const input = item('input', '<input placeholder="原始提示" value="原始值" style="width:100%;height:100%">', 40, 220, 220, 40);
  const vector = item('vector', '<svg width="100%" height="100%" viewBox="0 0 180 100"><text x="10" y="50">矢量文字</text></svg>', 330, 40, 180, 100, { type: 'svg' });
  const plain = item('plain', '直接文字', 40, 350, 180, 32);
  const board = { canvas, frame, safeArea: { enabled: false }, items: [card, input, vector, plain] };
  const data = { version: 1, ...board, activePageId: 'home', startPageId: 'home', pages: [
    { id: 'home', name: '首页', kind: 'page', ...board },
    { id: 'details', name: '详情', kind: 'page', canvas, frame, items: [item('open', '<button>打开弹窗</button>', 40, 40, 180, 60, { interaction: { type: 'openPopup', targetId: 'popup' } })] },
    { id: 'popup', name: '确认', kind: 'popup', canvas: { width: 320, height: 240, preset: 'custom' }, frame, items: [item('popup-text', '<span>弹窗文字</span>', 40, 60, 180, 60)] }
  ] };
  await clickAction(page, '#importProjectBtn');
  await page.locator('#projectFileInput').setInputFiles({ name: '预览测试.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator('#applyProjectImportBtn').click();
  await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame');
  const mode = preview.locator('.preview-edit-tools').getByRole('button', { name: '编辑文字与尺寸', exact: true });
  await mode.click();
  const edit = async (target, value, label = '文本') => {
    await target.dblclick();
    await preview.locator('.preview-text-editor').getByRole('textbox', { name: label, exact: true }).fill(value);
    await preview.getByRole('button', { name: '保存文字', exact: true }).click();
  };
  await edit(preview.locator('[data-name="card"] strong'), '新标题 <安全文本>');
  await preview.locator('[data-name="card"] strong').filter({ hasText: '新标题 <安全文本>' }).waitFor();
  assert.equal(await preview.locator('[data-name="card"] p').textContent(), '保留正文 强调 尾部');
  assert.equal(await preview.locator('[data-prototype-page="details"]').isVisible(), false);
  await edit(preview.locator('[data-name="card"] b'), '独立强调');
  await preview.locator('[data-name="card"] b').filter({ hasText: '独立强调' }).waitFor();
  await edit(preview.locator('[data-name="card"] strong'), '');
  await page.waitForFunction(() => document.querySelector('.editor-item strong')?.textContent === '');
  await edit(preview.locator('[data-name="card"] strong'), '恢复标题');
  await preview.locator('[data-name="card"] strong').filter({ hasText: '恢复标题' }).waitFor();
  await preview.locator('[data-name="input"] input').dblclick();
  await preview.getByRole('textbox', { name: '输入提示', exact: true }).fill('新提示');
  await preview.getByRole('textbox', { name: '输入内容', exact: true }).fill('新值');
  await preview.getByRole('button', { name: '保存文字', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.editor-item input')?.getAttribute('value') === '新值');
  assert.equal(await preview.locator('[data-name="input"] input').getAttribute('placeholder'), '新提示');
  await edit(preview.locator('[data-name="vector"] text'), '新矢量文字');
  await preview.locator('[data-name="vector"] text').filter({ hasText: '新矢量文字' }).waitFor();
  await edit(preview.locator('[data-name="plain"] .prototype-content'), '新直接文字');
  await preview.locator('[data-name="plain"]').filter({ hasText: '新直接文字' }).waitFor();
  console.log('通过：多段与嵌套文字独立编辑、空文字恢复、表单提示与值、矢量文字、编辑时阻止跳转');

  await preview.locator('[data-name="card"]').click({ position: { x: 10, y: 10 } });
  const drag = async (direction, dx, dy, cancel = false) => {
    const box = await preview.locator(`[data-resize="${direction}"]`).boundingBox();
    const frameBox = await page.locator('#previewFrame').boundingBox();
    const boardBox = await preview.locator(`[data-resize="${direction}"]`).locator('xpath=ancestor::main').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    // 指针留在预览区域内，保证松开事件送达；终点仍可超过画布边界。
    await page.mouse.move(Math.max(frameBox.x + 24, Math.min(frameBox.x + frameBox.width - 24, boardBox.x + boardBox.width + 12, box.x + box.width / 2 + dx)),
      Math.max(frameBox.y + 24, Math.min(frameBox.y + frameBox.height - 24, boardBox.y + boardBox.height + 12, box.y + box.height / 2 + dy)), { steps: 5 });
    if (cancel) await preview.locator(`[data-resize="${direction}"]`).press('Escape');
    await page.mouse.up();
  };
  await drag('se', 40, 30);
  await page.waitForFunction(() => document.querySelector('.editor-item[data-item-id="card"]').style.width === '280px');
  assert.equal(await preview.locator('[data-name="card"]').evaluate(node => node.style.height), '158px');
  await drag('nw', 10, 15);
  await page.waitForFunction(() => document.querySelector('.editor-item[data-item-id="card"]').style.left === '50px');
  assert.equal(await preview.locator('[data-name="card"]').evaluate(node => node.style.top), '55px');
  await drag('se', 50, 50, true);
  assert.equal(await preview.locator('[data-name="card"]').evaluate(node => node.style.width), '270px');
  await preview.locator('[data-name="card"]').click({ position: { x: 10, y: 10 } });
  await drag('se', 1200, 1200);
  await page.waitForFunction(() => document.querySelector('.editor-item[data-item-id="card"]').style.width === '550px');
  assert.equal(await preview.locator('[data-name="card"]').evaluate(node => node.style.height), '445px');
  await page.screenshot({ path: resolve(output, 'preview-edit.png') });
  console.log('通过：角点缩放、反向缩放位置、逃逸取消、页面边界限制与画布同步');
  await mode.click();
  await preview.locator('[data-name="card"]').click({ position: { x: 10, y: 10 } });
  await preview.locator('[data-prototype-page="details"]').waitFor({ state: 'visible' });
  await mode.click();
  await edit(preview.locator('[data-name="open"] button'), '新的弹窗按钮');
  await preview.locator('[data-name="open"] button').filter({ hasText: '新的弹窗按钮' }).waitFor();
  await mode.click(); await preview.locator('[data-name="open"] button').click();
  await preview.locator('[data-prototype-popup="popup"]').waitFor({ state: 'visible' });
  await preview.locator('[data-prototype-popup="popup"]').getByRole('button', { name: '编辑文字与尺寸' }).click();
  await edit(preview.locator('[data-name="popup-text"] span'), '新弹窗文字');
  await preview.locator('[data-name="popup-text"] span').filter({ hasText: '新弹窗文字' }).waitFor();
  await preview.locator('[data-name="popup-text"]').click(); await drag('e', 20, 0);
  await preview.locator('[data-name="popup-text"]').evaluate(node => new Promise(resolve => { const timer = setInterval(() => { if (node.style.width === '200px') { clearInterval(timer); resolve(); } }, 10); }));
  await page.locator('[data-close="previewDialog"]').click();
  await clickAction(page, '#undoBtn');
  const undoneEvent = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const undone = JSON.parse(await readFile(await (await undoneEvent).path(), 'utf8')).project;
  assert.equal(undone.pages.find(page => page.id === 'popup').items[0].width, 180);
  assert.match(undone.pages.find(page => page.id === 'popup').items[0].content, /新弹窗文字/);
  await clickAction(page, '#redoBtn');
  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload();
  const event = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const exported = JSON.parse(await readFile(await (await event).path(), 'utf8')).project;
  assert.equal(exported.activePageId, 'home');
  assert.match(exported.items.find(item => item.id === 'card').content, /恢复标题/);
  assert.equal(exported.items.find(item => item.id === 'card').width, 550);
  assert.match(exported.pages.find(page => page.id === 'details').items[0].content, /新的弹窗按钮/);
  assert.match(exported.pages.find(page => page.id === 'popup').items[0].content, /新弹窗文字/);
  assert.equal(exported.pages.find(page => page.id === 'popup').items[0].width, 200);
  const htmlEvent = page.waitForEvent('download'); await clickAction(page, '#exportHtmlBtn');
  const html = await readFile(await (await htmlEvent).path(), 'utf8');
  const standalone = await context.newPage(); await standalone.setContent(html);
  assert.equal(await standalone.locator('.preview-edit-tools').count(), 0);
  assert.equal(await standalone.locator('[data-name="card"]').evaluate(node => node.style.width), '550px');
  assert.deepEqual(errors, []);
  console.log('通过：跨页与弹窗编辑、自动保存、撤销重做、刷新恢复、工程和独立网页导出，无脚本错误');
} finally { await browser?.close(); server?.kill(); }
