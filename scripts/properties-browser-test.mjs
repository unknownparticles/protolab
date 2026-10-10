import { clickAction } from './browser-actions.mjs';
/** 组件分类、文本、图片、样式和持久化的浏览器验收。 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PROTOLAB_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PROTOLAB_PLAYWRIGHT_MODULE).href : 'playwright');
const base = process.env.PROTOLAB_TEST_URL || 'http://127.0.0.1:4182';
const server = process.env.PROTOLAB_TEST_URL ? null : spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: '4182' }, stdio: 'pipe' });
const output = resolve(process.env.PROTOLAB_TEST_OUTPUT || 'test-results');
await mkdir(output, { recursive: true });
let browser;
try {
  for (let i = 0; i < 40; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  browser = await chromium.launch({ headless: true, ...(process.env.PROTOLAB_BROWSER_EXECUTABLE ? { executablePath: process.env.PROTOLAB_BROWSER_EXECUTABLE } : {}) });
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  const apply = async () => { await page.evaluate(() => { document.getElementById('statusMessage').textContent = ''; }); await page.locator('#selectionProps button[type=submit]').click(); await page.waitForFunction(() => document.getElementById('statusMessage').textContent === '组件属性已更新'); };
  const saved = () => page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  const selected = () => page.locator('.editor-item.selected > .prototype-item');
  const add = async id => { await page.locator('#basicTab').click(); await page.locator(`[data-comp-id="${id}"]`).click(); };
  const custom = async (name, content, type = 'html') => {
    await page.locator('#customTab').click();
    await page.locator(type === 'svg' ? '#addSvgCompBtn' : '#addHtmlCompBtn').click();
    await page.locator('#customName').fill(name); await page.locator('#customCode').fill(content);
    await page.locator('#componentForm button[type=submit]').click();
    await page.locator('#customList .component-item').filter({ hasText: name }).click();
  };
  assert.ok(await page.locator('#basicPanel').isVisible()); assert.ok(await page.locator('#vectorPanel').isHidden());
  await page.locator('#vectorTab').click(); assert.ok(await page.locator('#basicPanel').isHidden());
  await page.locator('#vectorTab').press('ArrowRight'); assert.equal(await page.locator('#customTab').getAttribute('aria-selected'), 'true');
  await page.locator('#basicTab').click(); await page.locator('#componentSearch').fill('圆形'); assert.ok(await page.locator('#libraryEmpty').isVisible());
  await page.locator('#vectorTab').click(); assert.equal(await page.locator('#vectorList button').count(), 1);
  await page.locator('#componentSearch').fill('');
  console.log('通过：分类独立展示、分类内搜索、空状态及键盘切换');

  await add('lib-btn'); await page.locator('#propW').fill('180'); await page.locator('#propH').fill('70');
  for (const [key, values] of [['Padding', [1, 2, 3, 4]], ['Margin', [5, 6, 7, 8]]]) {
    for (const [i, side] of ['Top', 'Right', 'Bottom', 'Left'].entries()) await page.locator(`#prop${key}${side}`).fill(String(values[i]));
  }
  await page.locator('[data-text-index="0"]').fill('确认 <安全文本>');
  await page.locator('#propBackground').fill('#123456'); await page.locator('#propFontFamily').fill('serif');
  await page.locator('#propFontSize').fill('22'); await page.locator('#propFontWeight').selectOption('700');
  await page.locator('#propTextColor').fill('#abcdef'); await page.locator('#propOpacity').fill('55');
  await apply();
  assert.equal(await selected().locator('button').textContent(), '确认 <安全文本>');
  assert.deepEqual(await selected().evaluate(node => { const style = getComputedStyle(node), text = getComputedStyle(node.querySelector('button')); return [style.width, style.height, style.padding, getComputedStyle(node.firstElementChild).margin, style.opacity, text.fontSize, text.fontWeight, text.color, text.backgroundColor, text.fontFamily]; }), ['180px', '70px', '1px 2px 3px 4px', '5px 6px 7px 8px', '0.55', '22px', '700', 'rgb(171, 205, 239)', 'rgb(18, 52, 86)', 'serif']);
  await page.screenshot({ path: resolve(output, 'properties-text.png') });
  await clickAction(page, '#undoBtn'); assert.equal(await selected().locator('button').textContent(), '按钮');
  await clickAction(page, '#redoBtn'); assert.equal(await selected().locator('button').textContent(), '确认 <安全文本>');
  await saved(); await page.reload(); await page.locator('#layerList button').first().click();
  assert.equal(await page.locator('#propFontSize').inputValue(), '22');
  console.log('通过：宽高、四边间距、颜色、字体、字号、字重、透明度及撤销刷新');

  await add('lib-card'); assert.equal(await page.locator('[data-text-index]').count(), 2);
  await page.locator('[data-text-index="0"]').fill(''); await page.locator('[data-text-index="1"]').fill('保留正文'); await apply();
  assert.equal(await selected().locator('strong').textContent(), ''); assert.equal(await selected().locator('p').textContent(), '保留正文');
  assert.equal(await page.locator('[data-text-index]').count(), 2);
  await page.locator('[data-text-index="0"]').fill('重新写标题'); await apply();
  await add('lib-input'); await page.locator('[data-text-index="0"]').fill('新的输入提示'); await page.locator('[data-text-index="1"]').fill('初始值'); await apply();
  assert.equal(await selected().locator('input').getAttribute('placeholder'), '新的输入提示'); assert.equal(await selected().locator('input').inputValue(), '初始值');
  await add('lib-select'); assert.equal(await page.locator('[data-text-index]').count(), 3);
  await page.locator('[data-text-index="1"]').fill('自定义选项'); await apply(); assert.equal(await selected().locator('option').nth(1).textContent(), '自定义选项');
  await add('lib-textarea'); await page.locator('[data-text-index="1"]').fill('第一行\n第二行'); await apply(); assert.equal(await selected().locator('textarea').inputValue(), '第一行\n第二行');
  await add('lib-checkbox'); await page.locator('[data-text-index="0"]').fill('同意条款'); await apply(); assert.ok(await selected().locator('input').isChecked());
  await custom('矢量文字', '<svg viewBox="0 0 200 100" width="100%" height="100%"><text x="10" y="50">旧文字</text></svg>', 'svg');
  await page.locator('[data-text-index="0"]').fill('新矢量文字'); await page.locator('#propTextColor').fill('#ee1122'); await apply();
  assert.equal(await selected().locator('text').textContent(), '新矢量文字'); assert.equal(await selected().locator('text').evaluate(node => getComputedStyle(node).fill), 'rgb(238, 17, 34)');
  await page.locator('#vectorTab').click(); await page.locator('[data-comp-id="lib-svg-arrow"]').click();
  await page.locator('#propColor').fill('#dd2233'); await apply();
  assert.equal(await selected().locator('path').evaluate(node => getComputedStyle(node).fill), 'none'); assert.equal(await selected().locator('path').evaluate(node => getComputedStyle(node).stroke), 'rgb(221, 34, 51)');
  console.log('通过：多段文本独立编辑、空文本恢复、表单内容和矢量文字及描边');

  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const context = canvas.getContext('2d'), image = context.createImageData(256, 128);
    let value = 42;
    for (let i = 0; i < image.data.length; i += 4) { for (let j = 0; j < 3; j++) { value = (value * 1664525 + 1013904223) >>> 0; image.data[i + j] = value >>> 24; } image.data[i + 3] = 255; }
    context.putImageData(image, 0, 0); return canvas.toDataURL('image/png');
  });
  assert.ok(source.length > 100000);
  const upload = { name: 'noise.png', mimeType: 'image/png', buffer: Buffer.from(source.split(',')[1], 'base64') };
  // 大图上传与保存使用独立工程，避免填充模式遍历产生的大量历史耗尽浏览器配额。
  const large = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1100 } }); await large.goto(base);
  await large.locator('[data-comp-id="lib-image"]').click(); await large.locator('#propImageFile').setInputFiles(upload);
  await large.waitForFunction(() => document.getElementById('propImageSource').value.length > 100000);
  await large.locator('#selectionProps button[type=submit]').click();
  await large.waitForFunction(() => document.querySelector('.editor-item img')?.getAttribute('src')?.length > 100000);
  await large.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  await large.reload(); assert.equal(await large.locator('.editor-item img').getAttribute('src'), source);
  await large.locator('#customTab').click(); await large.locator('#addHtmlCompBtn').click(); await large.locator('#customName').fill('含大图片的组件');
  await large.locator('#customCode').fill(`<div><img src="${source}"><img src="${source}"></div>`);
  await large.locator('#componentForm button[type=submit]').click(); await large.locator('#customList .component-item').click();
  assert.equal(await large.locator('.editor-item.selected img').count(), 2); await large.close();
  const smallSource = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG4cAAAAASUVORK5CYII=';
  const smallUpload = { name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(smallSource.split(',')[1], 'base64') };
  await add('lib-image'); await page.locator('#propImageFile').setInputFiles(smallUpload);
  await page.waitForFunction(() => document.getElementById('propImageSource').value.startsWith('data:image/'));
  await page.locator('#propImageFit').selectOption('cover'); await page.locator('#propBlendMode').selectOption('multiply'); await apply();
  assert.equal(await selected().locator('img').getAttribute('src'), smallSource);
  assert.equal(await selected().locator('img').evaluate(node => getComputedStyle(node).objectFit), 'cover');
  assert.equal(await selected().evaluate(node => getComputedStyle(node).mixBlendMode), 'multiply');
  for (const fit of ['fill', 'contain', 'none', 'scale-down']) { await page.locator('#propImageFit').selectOption(fit); await apply(); assert.equal(await selected().locator('img').evaluate(node => getComputedStyle(node).objectFit), fit); }
  await page.screenshot({ path: resolve(output, 'properties-image.png') });
  await clickAction(page, '#undoBtn'); await clickAction(page, '#redoBtn');
  await custom('多图片卡片', `<div style="width:100%;height:100%"><span>图片说明</span><img alt="首图" src="${smallSource}" style="width:40%;height:60px"><img alt="次图" src="${smallSource}" style="width:40%;height:60px"></div>`);
  assert.equal(await page.locator('#propImageTarget option').count(), 2);
  const replacement = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2; return canvas.toDataURL('image/png'); });
  await page.locator('#propImageTarget').selectOption('1'); await page.locator('#propImageSource').fill(replacement); await apply();
  assert.equal(await selected().locator('img').nth(0).getAttribute('src'), smallSource); assert.equal(await selected().locator('img').nth(1).getAttribute('src'), replacement);
  assert.equal(await selected().locator('span').textContent(), '图片说明');
  await custom('矢量内嵌图片', `<svg width="100%" height="100%" viewBox="0 0 200 100"><image x="0" y="0" width="200" height="100" href="${smallSource}"/></svg>`, 'svg');
  await page.locator('#propImageSource').fill(replacement); await page.locator('#propImageFit').selectOption('cover'); await apply();
  assert.equal(await selected().locator('image').getAttribute('href'), replacement);
  assert.equal(await selected().locator('image').getAttribute('preserveAspectRatio'), 'xMidYMid slice');
  console.log('通过：大于标记长度限制的图片上传、全部填充模式、混合模式和多图独立替换');

  await saved();
  const downloadEvent = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const json = await readFile(await (await downloadEvent).path(), 'utf8');
  const exported = JSON.parse(json); assert.ok(exported.project.items.some(item => item.appearance?.blendMode === 'multiply'));
  await page.reload();
  await clickAction(page, '#importProjectBtn'); await page.locator('#projectFileInput').setInputFiles({ name: 'properties.json', mimeType: 'application/json', buffer: Buffer.from(json) });
  await page.locator('#applyProjectImportBtn').click(); await page.locator('#projectDialog').waitFor({ state: 'hidden' });
  await page.locator('#previewBtn').click();
  const preview = page.frameLocator('#previewFrame');
  assert.equal(await preview.locator('button').filter({ hasText: '确认 <安全文本>' }).evaluate(node => getComputedStyle(node).fontSize), '22px');
  assert.equal(await preview.locator('[data-name="图片占位"] img').getAttribute('src'), smallSource);
  assert.equal(await preview.locator('[data-name="图片占位"]').evaluate(node => getComputedStyle(node).mixBlendMode), 'multiply');
  await page.locator('[data-close="previewDialog"]').click();
  const htmlEvent = page.waitForEvent('download'); await clickAction(page, '#exportHtmlBtn');
  const html = await readFile(await (await htmlEvent).path(), 'utf8');
  const exportedPage = await browser.newPage({ locale: 'zh-CN' }); await exportedPage.setContent(html);
  assert.equal(await exportedPage.locator('[data-name="图片占位"] img').evaluate(node => getComputedStyle(node).objectFit), 'scale-down');
  assert.equal(await exportedPage.locator('button').filter({ hasText: '确认 <安全文本>' }).evaluate(node => getComputedStyle(node).color), 'rgb(171, 205, 239)');
  console.log('通过：工程导入导出、刷新恢复、预览和独立导出样式一致');

  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('[data-panel="library"]').click();
  assert.ok(await page.locator('#basicTab').isVisible()); await page.locator('#vectorTab').click(); assert.ok(await page.locator('#vectorPanel').isVisible());
  await page.locator('[data-comp-id="lib-svg-star"]').click(); await page.locator('[data-panel="properties"]').click();
  await page.locator('#propOpacity').fill('0'); await apply(); assert.equal(await selected().evaluate(node => getComputedStyle(node).opacity), '0');
  await page.screenshot({ path: resolve(output, 'properties-mobile.png') });
  assert.deepEqual(errors, []);
  console.log('通过：窄屏标签和属性面板、零透明度；无页面脚本错误');
} finally { await browser?.close(); server?.kill(); }
