/** 显隐布局、提示、弹窗跳转、属性联动与工程往返的浏览器验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4191';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4191' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  context.setDefaultTimeout(15000);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const click = async id => {
    const control = page.locator(`#${id}`);
    if (!await control.isVisible()) {
      const trigger = await control.evaluate(node => node.closest('[role="menu"]')?.getAttribute('aria-labelledby'));
      if (trigger) await page.locator(`#${trigger}`).click();
      else await control.locator('xpath=ancestor::details').locator('summary').click();
    }
    await control.click();
  };
  const apply = () => page.locator('#selectionProps button[type=submit]').click();
  const layer = name => page.locator('#layerList button').filter({ hasText: name });
  const selectPage = id => page.locator(`[data-page-id="${id}"]`).click();
  const addButton = async (name, y, height = 40, action = 'none', target) => {
    await page.locator('[data-comp-id="lib-btn"]').click();
    await page.locator('#propName').fill(name); await page.locator('#propY').fill(String(y));
    await page.locator('#propW').fill('200'); await page.locator('#propH').fill(String(height));
    await page.locator('#propClickAction').selectOption(action);
    if (target) await page.locator('#propClickTarget').selectOption(target);
    if (action === 'showToast') await page.locator('#propToastDuration').fill('1000');
    await apply(); return page.locator('.editor-item.selected').getAttribute('data-item-id');
  };
  const visibility = async (name, mode, targets) => {
    await layer(name).click(); await page.locator('#propClickAction').selectOption('visibility');
    await page.locator('#propVisibilityMode').selectOption(mode);
    for (const id of targets) await page.locator(`#propVisibilityTargets input[value="${id}"]`).check();
    await apply();
  };
  const editorTop = id => page.locator(`.editor-item[data-item-id="${id}"]`).evaluate(node => parseFloat(node.style.top));
  await click('addToastBtn');
  const toast = await page.locator('#pageList .active').getAttribute('data-page-id');
  await layer('提示文案').click(); await page.locator('[data-text-index="0"]').fill('保存成功'); await apply();
  console.log('已准备提示内容，验证预览编辑');
  await click('previewBtn');
  let preview = page.frameLocator('#previewFrame');
  await preview.locator('[data-prototype-toast]:popover-open').waitFor();
  await preview.locator('.prototype-toast-heading .preview-mode-toggle').click();
  await preview.locator('[data-name="提示文案"] .prototype-content').dblclick();
  await preview.locator('.preview-text-editor textarea').fill('已保存内容');
  await preview.locator('.preview-save').click();
  await preview.locator('[data-name="提示文案"]').filter({ hasText: '已保存内容' }).waitFor();
  await page.locator('[data-close="previewDialog"]').click();
  await click('addPopupBtn');
  const popup = await page.locator('#pageList .active').getAttribute('data-page-id');
  await addButton('弹窗提示', 30, 40, 'showToast', toast);
  await addButton('弹窗跳回首页', 110, 40, 'navigate', 'page-home');
  await click('addPageBtn');
  await selectPage('page-home');
  await addButton('切换板块', 40);
  const first = await addButton('板块上半', 120, 80);
  const second = await addButton('板块下半', 210, 60);
  const footer = await addButton('后续内容', 300);
  await addButton('显示板块', 380); await addButton('隐藏板块', 450);
  await addButton('页面提示', 520, 40, 'showToast', toast);
  await addButton('打开弹窗', 590, 40, 'openPopup', popup);
  await visibility('切换板块', 'toggle', [first, second]);
  await visibility('显示板块', 'show', [first, second]);
  await visibility('隐藏板块', 'hide', [first, second]);
  for (const name of ['板块上半', '板块下半']) { await layer(name).click(); await page.locator('#propVisible').uncheck(); await apply(); }
  assert.equal(await editorTop(footer), 160);
  await layer('后续内容').click(); assert.equal(await page.locator('#propY').inputValue(), '160');
  await page.locator('#propY').fill('170'); await apply(); assert.equal(await editorTop(footer), 170);
  await click('undoBtn'); assert.equal(await editorTop(footer), 160);
  await layer('后续内容').click(); await page.locator('[data-align="centerY"]').click();
  assert.equal(await editorTop(footer), 314); assert.equal(await page.locator('#propY').inputValue(), '314');
  await click('undoBtn');
  await layer('板块上半').click(); await page.locator('#propCollapseSpace').uncheck(); await apply();
  assert.equal(await editorTop(footer), 240); await click('undoBtn');
  assert.equal(await editorTop(footer), 160);
  console.log('通过：新建并预览编辑提示、初始显隐释放空间、坐标属性、对齐与保留空间联动');

  await click('previewBtn'); preview = page.frameLocator('#previewFrame');
  const visible = name => preview.locator(`[data-prototype-page="page-home"] [data-name="${name}"]`);
  const previewTop = () => visible('后续内容').evaluate(node => parseFloat(node.style.top));
  assert.equal(await previewTop(), 160);
  for (let i = 0; i < 3; i++) {
    await visible('切换板块').click(); assert.equal(await previewTop(), 300); assert.ok(await visible('板块上半').isVisible());
    await visible('切换板块').focus(); await page.keyboard.press('Enter'); assert.equal(await previewTop(), 160); assert.equal(await visible('板块下半').isVisible(), false);
  }
  await visible('显示板块').click(); assert.equal(await previewTop(), 300);
  await visible('显示板块').click(); assert.equal(await previewTop(), 300);
  await visible('隐藏板块').click(); assert.equal(await previewTop(), 160);
  await visible('页面提示').click(); await preview.locator('[data-prototype-toast]:popover-open').waitFor();
  await preview.locator('[data-prototype-toast]:popover-open').waitFor({ state: 'hidden' });
  await visible('打开弹窗').click(); await preview.locator('dialog[open]').waitFor();
  await preview.locator('[data-name="弹窗提示"]').click();
  await preview.locator('[data-prototype-toast]:popover-open').waitFor();
  await preview.locator('[data-prototype-toast]:popover-open').waitFor({ state: 'hidden' });
  assert.ok(await preview.locator('dialog[open]').isVisible());
  await preview.locator('[data-name="弹窗跳回首页"]').click(); await preview.locator('dialog[open]').waitFor({ state: 'hidden' });
  await visible('显示板块').click(); await preview.locator('#prototypeRestart').click(); assert.equal(await previewTop(), 160);
  // 收起状态进入预览编辑，调整尺寸仍保留展开坐标。
  await preview.locator('.preview-edit-tools button').filter({ hasText: '编辑文字与尺寸' }).click();
  await visible('后续内容').click();
  assert.equal(await preview.locator('.preview-selection').evaluate(node => parseFloat(node.style.top)), 160);
  const handle = await preview.locator('.preview-selection [data-resize="e"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 20, handle.y + handle.height / 2, { steps: 4 }); await page.mouse.up();
  await page.waitForFunction(id => document.querySelector(`.editor-item[data-item-id="${id}"]`).style.width === '220px', footer);
  assert.equal(await previewTop(), 160);
  await page.screenshot({ path: resolve(output, 'interactions-collapsed.png') });
  await page.locator('[data-close="previewDialog"]').click();
  console.log('通过：显隐三种动作、键盘与反复切换、页面及弹窗提示自动消失、弹窗跳转页面、重置显隐');

  const download = async id => { const pending = page.waitForEvent('download'); await click(id); return readFile(await (await pending).path(), 'utf8'); };
  const json = await download('exportProjectBtn'), html = await download('exportHtmlBtn');
  const savedFooter = JSON.parse(json).project.items.find(item => item.id === footer);
  assert.equal(savedFooter.y, 300); assert.equal(savedFooter.width, 220);
  const path = resolve(output, 'interactions-prototype.html'); await writeFile(path, html);
  const exported = await context.newPage(); exported.on('pageerror', error => errors.push(error.message));
  await exported.goto(pathToFileURL(path).href);
  await exported.locator('[data-name="切换板块"]').click();
  assert.equal(await exported.locator('[data-name="后续内容"]').evaluate(node => parseFloat(node.style.top)), 300);
  await exported.locator('[data-name="页面提示"]').click(); await exported.locator('[data-prototype-toast]:popover-open').waitFor();
  await exported.screenshot({ path: resolve(output, 'interactions-toast.png') });
  for (const [name, value] of [['interactions.json', json], ['interactions.html', html]]) {
    await click('importProjectBtn');
    await page.locator('#projectFileInput').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/html', buffer: Buffer.from(value) });
    await click('applyProjectImportBtn'); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
    assert.equal(await editorTop(footer), 160);
  }
  await page.reload(); assert.equal(await editorTop(footer), 160);
  await layer('板块上半').click(); await click('deleteItemBtn');
  await layer('切换板块').click(); assert.equal(await page.locator('#propVisibilityTargets input:checked').count(), 1);
  await layer('板块下半').click(); await click('deleteItemBtn');
  await layer('切换板块').click(); assert.equal(await page.locator('#propClickAction').inputValue(), 'none');
  await click('undoBtn'); await layer('切换板块').click(); assert.equal(await page.locator('#propClickAction').inputValue(), 'visibility');
  assert.deepEqual(errors, []);
  console.log('通过：独立导出运行、提示展示、工程与导出文件往返、刷新、目标删除清理与撤销，无脚本异常');
} finally { await browser?.close(); server?.kill(); }
