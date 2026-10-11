import { startBrowserTest } from './harness.mjs';
import { clickAction } from './browser-actions.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const { base, output, browser, close } = await startBrowserTest({ port: 4175 });
const source = `<!DOCTYPE html><html><head><style>
:root{--brand:#2563eb}*{box-sizing:border-box}body{margin:0;padding:24px;background:#f0f4fa;font-family:Arial,sans-serif}.card{width:540px;padding:24px;background:white;border:1px solid #dde3ef;border-radius:16px;box-shadow:0 8px 20px #1232}.card h1{font-size:24px;margin:0 0 16px;color:#123}.row{display:flex;gap:12px;align-items:center}.action{width:120px;height:40px;background:var(--brand);color:white;border:0;border-radius:8px;font-size:16px}input{width:180px;height:40px;padding:8px;border:1px solid #ccd;border-radius:6px}.tiles{display:grid;grid-template-columns:100px 100px;gap:12px;margin-top:16px}.tile{height:60px;background:#e9efff;padding:10px;color:#234}.hidden{display:none}@media(max-width:500px){.card{width:340px}.row{flex-direction:column}}
</style></head><body><section class="card"><h1>工程导入示例</h1><div class="row"><button class="action">开始设计</button><input placeholder="请输入名称"><svg width="32" height="32" viewBox="0 0 32 32"><circle cx="16" cy="16" r="12" fill="#f59e0b"/></svg></div><div class="tiles"><div class="tile">组件甲</div><div class="tile">组件乙</div></div><p>欢迎使用 <span style="color:#e11;font-weight:bold">原型</span> 编辑器</p><div class="hidden">隐藏内容</div></section></body></html>`;
try {
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base); await page.locator('[data-comp-id="lib-btn"]').click();
  const savedProject = () => page.evaluate(() => { const { savedAt, ...value } = JSON.parse(localStorage.getItem('protolab.project.v1')); return value; });
  const importFile = async (name, text, width = '600', height = '400') => {
    await clickAction(page, '#importProjectBtn');
    await page.locator('#projectFileInput').setInputFiles({ name, mimeType: name.endsWith('.json') ? 'application/json' : 'text/html', buffer: Buffer.from(text) });
    await page.locator('#importWidth').fill(width); await page.locator('#importHeight').fill(height);
    await page.locator('#applyProjectImportBtn').click();
  };
  await importFile('design.html', source);
  await page.waitForFunction(() => !document.getElementById('projectDialog').open);
  assert.equal(await page.locator('#canvasWidthInput').inputValue(), '600');
  assert.equal(await page.locator('#canvasHeightInput').inputValue(), '400');
  assert.equal(await page.locator('.editor-item button').count(), 1);
  assert.equal(await page.locator('.editor-item input').count(), 1);
  assert.equal(await page.locator('.editor-item svg').count(), 1);
  assert.equal(await page.locator('.editor-item').filter({ hasText: '隐藏内容' }).count(), 0);
  const reference = await context.newPage(); await reference.setViewportSize({ width: 600, height: 400 }); await reference.setContent(source);
  for (const selector of ['h1', 'button', 'input', 'svg', '.tile']) {
    const refSelector = selector === '.tile' ? '.tile' : selector;
    const editorSelector = selector === '.tile' ? '.prototype-content>div' : `.prototype-content ${selector}`;
    const ref = await reference.locator(refSelector).first().evaluate(element => {
      const box = element.getBoundingClientRect(), css = getComputedStyle(element);
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height), color: css.color, background: css.backgroundColor, fontSize: css.fontSize, padding: css.padding, borderRadius: css.borderRadius };
    });
    const name = selector === '.tile' ? '组件甲' : null;
    const target = name ? page.locator('.prototype-content>div').filter({ hasText: name }).last() : page.locator(editorSelector).first();
    const actual = await target.evaluate(element => {
      const canvas = document.getElementById('canvas').getBoundingClientRect(), box = element.getBoundingClientRect(), css = getComputedStyle(element), zoom = canvas.width / document.getElementById('canvas').clientWidth;
      return { x: Math.round((box.x - canvas.x) / zoom), y: Math.round((box.y - canvas.y) / zoom), width: Math.round(box.width / zoom), height: Math.round(box.height / zoom), color: css.color, background: css.backgroundColor, fontSize: css.fontSize, padding: css.padding, borderRadius: css.borderRadius };
    });
    assert.deepEqual(actual, ref, selector);
  }
  await reference.screenshot({ path: resolve(output, 'project-source.png') });
  await page.screenshot({ path: resolve(output, 'project-imported.png') });
  const count = await page.locator('.editor-item').count();
  await clickAction(page, '#undoBtn'); assert.equal(await page.locator('.editor-item').count(), 1);
  await clickAction(page, '#redoBtn'); assert.equal(await page.locator('.editor-item').count(), count);
  await page.locator('.editor-item').filter({ has: page.locator('button') }).click();
  const x = Number(await page.locator('#propX').inputValue());
  await page.locator('#canvas').focus(); await page.keyboard.press('ArrowRight');
  assert.equal(Number(await page.locator('#propX').inputValue()), x + 1);
  console.log('通过：HTML 的组件识别、页面 CSS、变量、Flex/Grid、位置尺寸与独立编辑、撤销重做');

  // 工程包含自定义组件及设备设置，导出的 HTML 也可恢复精确模型。
  await page.locator('#customTab').click(); await page.locator('#addHtmlCompBtn').click(); await page.locator('#customName').fill('工程自定义组件');
  await page.locator('#customCode').fill('<div>工程片段</div>'); await page.locator('#componentForm button[type="submit"]').click();
  const jsonDownload = page.waitForEvent('download'); await clickAction(page, '#exportProjectBtn');
  const jsonFile = await jsonDownload; const json = await readFile(await jsonFile.path(), 'utf8');
  const bundle = JSON.parse(json); assert.equal(bundle.components.length, 1);
  const htmlDownload = page.waitForEvent('download'); await clickAction(page, '#exportHtmlBtn');
  const htmlFile = await htmlDownload; const html = await readFile(await htmlFile.path(), 'utf8');
  await importFile('project.json', json); await page.waitForFunction(() => !document.getElementById('projectDialog').open);
  let saved = await savedProject();
  assert.deepEqual(saved, bundle.project);
  assert.equal(await page.locator('#customList .component-item').count(), 1);
  await importFile('prototype.html', html); await page.waitForFunction(() => !document.getElementById('projectDialog').open);
  saved = await savedProject();
  assert.deepEqual(saved, bundle.project);
  await page.reload(); assert.equal(await page.locator('.editor-item').count(), count);
  console.log('通过：工程 JSON、HTML 往返及自定义组件库、草稿恢复');

  const baseline = saved;
  for (const [name, text, pattern] of [['broken.json', '{bad', /JSON|property/i], ['invalid.json', '{"version":2}', /格式/], ['empty.html', '<html><body></body></html>', /没有可识别/], ['large.html', '<div style="width:2500px;height:80px">越界</div>', /超过 2000/], ['many.html', '<body style="margin:0">' + '<span style="display:inline-block;width:1px;height:1px">点</span>'.repeat(201) + '</body>', /超过 200/]]) {
    await importFile(name, text);
    await page.waitForFunction(() => !document.getElementById('applyProjectImportBtn').disabled);
    assert.match(await page.locator('#projectError').textContent(), pattern);
    assert.deepEqual(await savedProject(), baseline);
    await page.locator('#projectDialog [data-close]').first().click();
  }
  const requests = []; page.on('request', request => { if (request.url().includes('evil.example')) requests.push(request.url()); });
  await importFile('unsafe.html', '<script>parent.hacked=true</script><style>@import "https://evil.example/a.css";button{background:url(https://evil.example/a.png)}</style><button onclick="parent.hacked=true">安全按钮</button><img src="https://evil.example/x.png" onerror="parent.hacked=true" style="width:40px;height:40px">');
  await page.waitForFunction(() => !document.getElementById('projectDialog').open);
  assert.equal(await page.evaluate(() => window.hacked), undefined); assert.deepEqual(requests, []);
  assert.equal(await page.locator('.prototype-content [onclick],.prototype-content [onerror],.prototype-content script').count(), 0);
  console.log('通过：非法文件、空页面、布局与数量超限均保留当前设计，脚本及外链隔离');
  assert.deepEqual(errors, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  console.log('通过：窄屏工程操作及无页面异常');
} finally { await close(); }
