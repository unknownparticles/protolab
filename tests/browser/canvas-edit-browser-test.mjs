import { startBrowserTest } from './harness.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clickAction } from './browser-actions.mjs';

const { base, output, browser, close } = await startBrowserTest({ port: 4196 });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const item = (id, content, x, y, width, height, extra = {}) => ({ id, name: id, type: 'html', content, x, y, width, height, radius: 0, padding: '0', margin: '0', ...extra });
  const card = item('card', '<div style="width:100%;height:100%;padding:20px;background:#f8fafc"><strong>原始标题</strong><p>保留正文 <b>强调</b> 尾部</p></div>', 80, 60, 240, 128);
  const data = { version: 1, canvas: { width: 600, height: 800, preset: 'custom' }, frame: { device: 'pc', style: 'none' }, safeArea: { enabled: false }, items: [
    card,
    item('input', '<input placeholder="原始提示" value="原始值" style="width:100%;height:100%">', 80, 240, 220, 40),
    item('vector', '<svg width="100%" height="100%" viewBox="0 0 180 100"><text x="10" y="50">矢量文字</text></svg>', 340, 60, 180, 100, { type: 'svg' }),
    item('plain', '直接文字', 80, 340, 180, 32),
    item('container', '<div></div>', 80, 420, 300, 180, { container: { mode: 'vertical', gap: 12, columns: 2 }, padding: '16px' }),
    item('child', '<span>容器文字</span>', 96, 436, 268, 50, { parentId: 'container', layoutBasis: { width: 268, height: 50 } }),
  ] };
  await page.goto(base);
  await clickAction(page, '#importProjectBtn');
  await page.locator('#projectFileInput').setInputFiles({ name: '画布交互.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) });
  await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  await page.locator('#zoomSelect').selectOption('1');
  const node = id => page.locator(`.editor-item[data-item-id="${id}"]`);
  const select = async id => { await page.locator('#layerList button').filter({ hasText: id }).first().click(); };
  const at = async target => {
    const box = await target.boundingBox(); assert.ok(box);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  };
  const edit = async (target, value, key = 'Enter') => {
    await at(target);
    const input = page.locator('.canvas-text-editor textarea').first();
    await input.fill(value); await input.press(key);
  };
  await edit(node('card').locator('strong'), '新标题 <安全文本>');
  assert.equal(await node('card').locator('strong').textContent(), '新标题 <安全文本>');
  assert.equal(await node('card').locator('p').textContent(), '保留正文 强调 尾部');
  await edit(node('card').locator('b'), '新强调');
  assert.equal(await node('card').locator('b').textContent(), '新强调');
  await edit(node('card').locator('strong'), '取消标题', 'Escape');
  assert.equal(await node('card').locator('strong').textContent(), '新标题 <安全文本>');
  await edit(node('card').locator('strong'), '');
  await edit(node('card').locator('strong'), '恢复标题');
  assert.equal(await node('card').locator('strong').textContent(), '恢复标题');
  await at(node('input'));
  await page.locator('.canvas-text-editor').getByRole('textbox', { name: '输入提示', exact: true }).fill('新提示');
  await page.locator('.canvas-text-editor').getByRole('textbox', { name: '输入内容', exact: true }).fill('新值');
  await page.locator('.canvas-text-editor button[type=submit]').click();
  assert.equal(await node('input').locator('input').getAttribute('placeholder'), '新提示');
  assert.equal(await node('input').locator('input').getAttribute('value'), '新值');
  await edit(node('vector').locator('text'), '新矢量文字');
  await edit(node('plain'), '第一行\n第二行');
  await at(node('card').locator('strong'));
  await page.locator('.canvas-text-editor textarea').fill('外部点击保存');
  await select('plain');
  assert.equal(await node('card').locator('strong').textContent(), '外部点击保存');
  await clickAction(page, '#undoBtn'); assert.equal(await node('card').locator('strong').textContent(), '恢复标题');
  await clickAction(page, '#redoBtn'); assert.equal(await node('card').locator('strong').textContent(), '外部点击保存');
  console.log('通过：双击独立文字、空文字恢复、表单与矢量文字、取消、点击外部保存、撤销重做');

  const geometry = id => node(id).evaluate(node => ['left', 'top', 'width', 'height'].map(key => parseFloat(node.style[key])));
  const drag = async (id, direction, dx, dy, cancel = '') => {
    await select(id);
    const box = await node(id).locator(`[data-canvas-resize="${direction}"]`).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 5 });
    if (cancel === 'escape') await page.keyboard.press('Escape');
    if (cancel === 'pointercancel') await node(id).dispatchEvent('pointercancel');
    await page.mouse.up();
  };
  const cases = { e: [80, 60, 260, 128], w: [100, 60, 220, 128], n: [80, 75, 240, 113], s: [80, 60, 240, 143],
    nw: [100, 75, 220, 113], ne: [80, 75, 260, 113], sw: [100, 60, 220, 143], se: [80, 60, 260, 143] };
  for (const [direction, expected] of Object.entries(cases)) {
    await drag('card', direction, 20, 15);
    assert.deepEqual(await geometry('card'), expected, direction);
    await clickAction(page, '#undoBtn'); assert.deepEqual(await geometry('card'), [80, 60, 240, 128]);
  }
  for (const cancel of ['escape', 'pointercancel']) {
    await drag('card', 'se', 40, 40, cancel);
    assert.deepEqual(await geometry('card'), [80, 60, 240, 128]);
  }
  await page.locator('#zoomSelect').selectOption('0.5');
  await select('card');
  const scaledHandle = await node('card').locator('[data-canvas-resize="se"]').boundingBox();
  assert.equal(scaledHandle.width, 10); assert.equal(scaledHandle.height, 10);
  await drag('card', 'se', 20, 15); assert.deepEqual(await geometry('card'), [80, 60, 280, 158]);
  await clickAction(page, '#undoBtn'); await page.locator('#zoomSelect').selectOption('1');
  await drag('card', 'e', 400, 0); assert.deepEqual(await geometry('card'), [80, 60, 520, 128]);
  await clickAction(page, '#undoBtn');
  await drag('card', 'nw', -200, -120); assert.deepEqual(await geometry('card'), [0, 0, 320, 188]);
  await clickAction(page, '#undoBtn');
  await drag('card', 'se', -300, -200); assert.deepEqual(await geometry('card'), [80, 60, 1, 1]);
  await clickAction(page, '#undoBtn');
  await select('vector'); await page.locator('#propOrientationEnabled').check();
  await page.locator('#propPortraitAction').selectOption('rotate90');
  await page.locator('#selectionProps button[type=submit]').click();
  await drag('vector', 'e', 0, 20); assert.deepEqual(await geometry('vector'), [330, 70, 200, 100]);
  await clickAction(page, '#undoBtn');
  await drag('container', 'e', 20, 0);
  assert.deepEqual(await geometry('container'), [80, 420, 320, 180]);
  assert.deepEqual(await geometry('child'), [96, 436, 288, 50]);
  await drag('child', 's', 0, 20); assert.equal((await geometry('child'))[3], 70);
  await drag('container', 's', 0, 40, 'escape');
  assert.deepEqual(await geometry('container'), [80, 420, 320, 180]);
  assert.equal((await geometry('child'))[3], 70);
  await page.screenshot({ path: resolve(output, 'canvas-edit-resize.png') });
  console.log('通过：四边四角连续拖动、撤销、逃逸与指针取消、边界和最小尺寸、缩放与旋转换算、容器重排及子组件尺寸');

  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload();
  assert.equal(await node('card').locator('strong').textContent(), '外部点击保存');
  assert.equal((await geometry('container'))[2], 320);
  const event = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const exported = JSON.parse(await readFile(await (await event).path(), 'utf8')).project;
  assert.match(exported.items.find(item => item.id === 'card').content, /外部点击保存/);
  assert.equal(exported.items.find(item => item.id === 'container').width, 320);
  assert.equal(exported.items.find(item => item.id === 'child').layoutBasis.height, 70);
  assert.deepEqual(errors, []);
  console.log('通过：文字与尺寸自动保存、刷新恢复和工程导出，无页面脚本错误');
} finally { await close(); }
