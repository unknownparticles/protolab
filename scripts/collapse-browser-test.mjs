import { clickAction } from './browser-actions.mjs';
/** 验证收起后的编辑状态、原生校验和窄屏入口。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleName = process.env.PROTOLAB_PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4183';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4183' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
let browser;
try {
  await mkdir(output, { recursive: true });
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(base)).ok) break; } catch { /* 等待服务器。 */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const toggle = key => page.locator(`[data-collapsible="${key}"] > :is(.section-label,legend,strong) > .section-toggle`);
  const roundTrip = async key => {
    const expanded = await toggle(key).getAttribute('aria-expanded') === 'true';
    await toggle(key).click();
    assert.equal(await toggle(key).getAttribute('aria-expanded'), String(!expanded));
    assert.equal(await page.locator(`#collapse-${key}`).isVisible(), !expanded);
    await toggle(key).press('Enter');
    assert.equal(await toggle(key).getAttribute('aria-expanded'), String(expanded));
    assert.equal(await page.locator(`#collapse-${key}`).isVisible(), expanded);
  };
  await page.locator('[data-comp-id="lib-btn"]').click();
  await page.locator('#propName').fill('收起后保留草稿');
  await page.locator('#propPaddingTop').fill('12');
  for (const key of ['padding', 'margin', 'appearance', 'text', 'component-properties', 'alignment', 'canvas-settings', 'safe-area', 'device-frame', 'layers', 'basicPanel', 'creation', 'library-management', 'pages']) await roundTrip(key);
  assert.equal(await page.locator('#propName').inputValue(), '收起后保留草稿');
  assert.equal(await page.locator('#propPaddingTop').inputValue(), '12');
  await toggle('padding').click();
  await toggle('text').click();
  await page.locator('#selectionProps button[type=submit]').click();
  assert.equal(await page.locator('#propName').inputValue(), '收起后保留草稿');
  assert.equal(await page.locator('#propPaddingTop').inputValue(), '12');
  assert.equal(await toggle('padding').getAttribute('aria-expanded'), 'false');
  console.log('通过：全部属性板块、键盘展开、未提交表单值保留及收起后应用属性');

  // 收起的必填字段出错时，应自动展开并允许浏览器定位错误。
  await toggle('padding').click();
  await page.locator('#propPaddingTop').fill('');
  await toggle('padding').click();
  await page.locator('#selectionProps button[type=submit]').click();
  assert.equal(await toggle('padding').getAttribute('aria-expanded'), 'true');
  assert.ok(await page.locator('#propPaddingTop').isVisible());
  await page.locator('#propPaddingTop').fill('12');

  await page.locator('[data-comp-id="lib-image"]').click();
  await roundTrip('image');
  await page.locator('#vectorTab').click(); await roundTrip('vectorPanel');
  await page.locator('#customTab').click(); await roundTrip('customPanel');
  await page.locator('#basicTab').click();
  await clickAction(page, '#aiToggleBtn');
  await roundTrip('ai-history'); await roundTrip('ai-task');
  await page.locator('#aiRequirement').fill('保留需求草稿');
  await toggle('ai-task').click(); await toggle('ai-task').click();
  assert.equal(await page.locator('#aiRequirement').inputValue(), '保留需求草稿');
  await page.locator('#aiCloseBtn').click();

  for (const id of ['libraryPanel', 'propertiesPanel', 'aiPanel']) {
    if (id === 'aiPanel') await clickAction(page, '#aiToggleBtn');
    const panel = page.locator(`#${id}`), button = panel.locator('.panel-toggle');
    await button.click(); assert.equal(await button.getAttribute('aria-expanded'), 'false');
    assert.equal(await panel.evaluate(node => node.getBoundingClientRect().width), 44);
    await button.press('Space'); assert.equal(await button.getAttribute('aria-expanded'), 'true');
    if (id === 'aiPanel') await page.locator('#aiCloseBtn').click();
  }
  console.log('通过：图片、组件分类、页面管理、AI 板块与三个侧面板独立收起');

  await toggle('canvas-settings').click();
  await page.locator('#libraryPanel .panel-toggle').click();
  await page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await page.reload();
  assert.equal(await toggle('canvas-settings').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#libraryPanel .panel-toggle').getAttribute('aria-expanded'), 'false');
  await page.locator('#layerList button').first().click();
  assert.equal(await toggle('text').getAttribute('aria-expanded'), 'false');
  for (const key of ['component-properties', 'alignment', 'safe-area', 'device-frame', 'layers']) await toggle(key).click();
  await page.screenshot({ path: resolve(output, 'collapse-desktop.png') });
  const ids = await page.locator('[id]').evaluateAll(nodes => nodes.map(node => node.id));
  assert.equal(new Set(ids).size, ids.length);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-panel=library]').click();
  await page.locator('#libraryPanel .panel-toggle').click();
  assert.ok(await page.locator('#componentSearch').isVisible());
  await roundTrip('basicPanel');
  await page.locator('[data-panel=properties]').click();
  await roundTrip('canvas-settings');
  await page.locator('#propertiesPanel .panel-toggle').click();
  await page.locator('#propertiesPanel .panel-toggle').click();
  assert.ok(await toggle('canvas-settings').isVisible());
  await page.screenshot({ path: resolve(output, 'collapse-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('通过：刷新恢复、切换组件保留收起状态、窄屏展开和唯一标识；无脚本错误');
} finally { await browser?.close(); server?.kill(); }
