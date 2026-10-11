import { startBrowserTest } from './harness.mjs';
/** 顶部菜单的键盘、焦点、操作集成与窄屏验收。 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { clickAction } from './browser-actions.mjs';

const { base, output, browser, close } = await startBrowserTest({ port: 4192 });
try {

  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const focused = () => page.evaluate(() => document.activeElement.id);
  const closed = async () => assert.equal(await page.locator('.menu-dropdown:visible').count(), 0);
  await closed();
  assert.equal(await page.locator('.toolbar button:visible').count(), 5);
  await page.locator('#editMenuBtn').click();
  assert.equal(await page.locator('#undoBtn').isDisabled(), true);
  assert.equal(await page.locator('#menuDuplicateBtn').isDisabled(), true);
  await page.keyboard.press('Escape'); await closed();
  assert.equal(await focused(), 'editMenuBtn');
  await page.locator('#fileMenuBtn').focus(); await page.keyboard.press('Enter');
  assert.equal(await focused(), 'newProjectBtn');
  await page.keyboard.press('End'); assert.equal(await focused(), 'exportHtmlBtn');
  await page.keyboard.press('Home'); assert.equal(await focused(), 'newProjectBtn');
  await page.keyboard.press('Tab'); await closed(); assert.equal(await focused(), 'projectSelect');
  await page.locator('#fileMenuBtn').click(); await page.locator('#toolsMenuBtn').hover();
  assert.equal(await page.locator('#toolsMenu').isVisible(), true);
  assert.equal(await page.locator('#fileMenu').isHidden(), true);
  await page.locator('.canvas-topbar').click(); await closed();

  await page.locator('[data-comp-id="lib-btn"]').click();
  const x = await page.locator('#propX').inputValue();
  await page.locator('#editMenuBtn').focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await focused(), 'undoBtn');
  await page.keyboard.press('ArrowDown'); assert.equal(await focused(), 'menuDuplicateBtn');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#canvasMenu').isVisible(), true);
  await page.keyboard.press('ArrowLeft'); assert.equal(await focused(), 'undoBtn');
  await page.keyboard.press('Escape'); await closed();
  assert.equal(await page.locator('.editor-item.selected').count(), 1);
  assert.equal(await page.locator('#propX').inputValue(), x);
  await clickAction(page, '#menuDuplicateBtn'); assert.equal(await page.locator('.editor-item').count(), 2); await closed();
  await clickAction(page, '#menuDeleteBtn'); assert.equal(await page.locator('.editor-item').count(), 1);
  await clickAction(page, '#undoBtn'); assert.equal(await page.locator('.editor-item').count(), 2);
  await clickAction(page, '#redoBtn'); assert.equal(await page.locator('.editor-item').count(), 1);
  await clickAction(page, '#saveBtn'); assert.equal(await page.locator('#saveState').textContent(), '已保存版本');
  await page.locator('#fileMenuBtn').click(); await page.keyboard.press('Control+s'); await closed();
  assert.equal(await page.locator('#saveState').textContent(), '已保存版本');

  await clickAction(page, '[data-preset="tablet"]');
  assert.equal(await page.locator('[data-preset="tablet"]').getAttribute('aria-checked'), 'true');
  const width = await page.locator('#canvasWidthInput').inputValue();
  const height = await page.locator('#canvasHeightInput').inputValue();
  await clickAction(page, '#rotateBtn'); assert.equal(await page.locator('#canvasWidthInput').inputValue(), height);
  assert.equal(await page.locator('#canvasHeightInput').inputValue(), width);
  await clickAction(page, '#menuFitBtn'); await closed();
  await clickAction(page, '[data-preset="phone"]');
  await page.locator('#previewBtn').click(); assert.equal(await page.locator('#previewDialog').isVisible(), true);
  await page.locator('[data-close="previewDialog"]').click();
  await clickAction(page, '#engineeringSettingsBtn');
  assert.equal(await page.locator('#engineeringDialog').isVisible(), true);
  await page.locator('[data-close="engineeringDialog"]').first().click();
  await clickAction(page, '#newProjectBtn');
  await page.locator('#engineeringName').fill('菜单验收工程'); await page.locator('#engineeringSubmitBtn').click();
  assert.equal(await page.locator('#projectSelect option:checked').textContent(), '菜单验收工程');
  await page.locator('#projectSelect').selectOption({ index: 0 }); assert.equal(await page.locator('.editor-item').count(), 1);
  const downloading = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const json = await readFile(await (await downloading).path(), 'utf8');
  assert.equal(JSON.parse(json).project.items.length, 1);
  await clickAction(page, '#importProjectBtn');
  assert.equal(await page.locator('#projectDialog').isVisible(), true);
  await page.locator('#projectFileInput').setInputFiles({ name: '菜单工程.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.editor-item').count(), 1);
  const exporting = page.waitForEvent('download'); await clickAction(page, '#exportHtmlBtn');
  assert.equal((await exporting).suggestedFilename(), 'prototype.html');
  await clickAction(page, '#aiToggleBtn'); assert.equal(await page.locator('#aiPanel').isVisible(), true);
  await clickAction(page, '#aiToggleBtn'); assert.equal(await page.locator('#aiPanel').isHidden(), true);
  await clickAction(page, '#settingsBtn'); assert.equal(await page.locator('#settingsDialog').isVisible(), true);
  await closed(); await page.locator('[data-close="settingsDialog"]').first().click();

  await page.locator('#fileMenuBtn').click();
  await page.screenshot({ path: resolve(output, 'menus-desktop.png') });
  await page.keyboard.press('Escape');
  for (const viewportWidth of [1440, 1024, 768, 600, 599, 390, 320]) {
    await page.setViewportSize({ width: viewportWidth, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${viewportWidth} 像素无页面溢出`);
    const controls = await page.locator('.toolbar button:visible, #projectSelect').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth;
    }));
    assert.ok(controls.every(Boolean), `${viewportWidth} 像素顶部入口可见`);
    for (const id of ['fileMenuBtn', 'editMenuBtn', 'canvasMenuBtn', 'toolsMenuBtn']) {
      await page.locator(`#${id}`).click();
      assert.equal(await page.locator('.menu-dropdown:visible').count(), 1);
      assert.equal(await page.locator('.menu-dropdown:visible').evaluate(node => {
        const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
      }), true, `${viewportWidth} 像素下拉菜单完整可见`);
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#fileMenuBtn').click(); await page.screenshot({ path: resolve(output, 'menus-mobile.png') });
  await page.keyboard.press('Escape');
  const touch = await browser.newContext({ locale: 'zh-CN', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const mobile = await touch.newPage(); mobile.on('pageerror', error => errors.push(error.message)); await mobile.goto(base);
  await mobile.locator('#fileMenuBtn').tap(); assert.equal(await mobile.locator('#fileMenu').isVisible(), true);
  await mobile.locator('#newProjectBtn').tap(); assert.equal(await mobile.locator('#engineeringDialog').isVisible(), true);
  assert.equal(await mobile.locator('.menu-dropdown:visible').count(), 0);
  assert.deepEqual(errors, []);
  console.log('通过：顶部菜单操作、键盘焦点、工程导入导出、桌面与移动端布局及触摸');
} finally { await close(); }
