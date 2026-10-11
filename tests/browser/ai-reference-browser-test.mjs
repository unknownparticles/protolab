import { startBrowserTest } from './harness.mjs';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { clickAction } from './browser-actions.mjs';

const { base, output, browser, close } = await startBrowserTest({ port: 4185 });
try {
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let sent, release;
  await page.route('https://reference.example.test/**', async route => {
    const body = route.request().postDataJSON();
    const content = body.messages.at(-1).content;
    sent = { body, task: JSON.parse(Array.isArray(content) ? content[0].text : content) };
    const { task } = sent;
    const changes = task.mode === 'modify' ? [{ op: 'update', id: task.project.items.find(item => !item.container).id, fields: { name: '优化后的标题' } }] : [{ op: 'add', item: {
      id: 'generated-title', name: '参考标题', type: 'html', content: '<h1 style="font-size:24px;color:#2563eb">确认操作</h1>', x: 0, y: 0, width: 280, height: 60,
    } }];
    if (['page', 'popup'].includes(task.mode)) {
      changes[0].item.parentId = 'generated-section';
      changes.unshift({ op: 'add', item: { id: 'generated-section', name: '内容容器', type: 'html', content: '<div></div>', x: 0, y: 0, width: 280, height: 60, container: { mode: 'vertical', gap: 0 }, appearance: { background: 'transparent' } } });
    }
    if (task.requirement === '等待优化') await new Promise(resolve => { release = resolve; });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, name: '自动名称', summary: '参考生成完成', changes }) } }] }) });
  });
  const saved = () => page.waitForFunction(() => document.getElementById('saveState').textContent === '已自动保存');
  const current = () => page.evaluate(() => {
    const catalog = JSON.parse(localStorage.getItem('protolab.projects.v1'));
    return catalog.entries.find(entry => entry.id === catalog.activeId);
  });
  await page.goto(base);
  await clickAction(page, '#settingsBtn');
  await page.locator('#aiURL').fill('https://reference.example.test/v1'); await page.locator('#aiModel').fill('vision');
  await page.locator('#aiSettingsForm button[type=submit]').click();
  await clickAction(page, '#aiToggleBtn');
  const png = Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 375; canvas.height = 667;
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, 375, 667);
    context.fillStyle = '#2563eb'; context.font = '24px sans-serif'; context.fillText('确认操作', 24, 50);
    return canvas.toDataURL().split(',')[1];
  }), 'base64');
  await page.locator('#aiImageFile').setInputFiles({ name: '参考.png', mimeType: 'image/png', buffer: png });
  await page.locator('#aiImagePreview').waitFor({ state: 'visible' });
  for (const [mode, width, height] of [['component', 80, 40], ['page', 480, 700], ['popup', 320, 240]]) {
    await page.locator('#aiMode').selectOption(mode);
    await page.locator('#aiRefName').fill(`参考${mode}`);
    await page.locator('#aiRefWidth').fill(String(width)); await page.locator('#aiRefHeight').fill(String(height));
    await page.locator('#aiRefColor').fill('#2563eb'); await page.locator('#aiRefFunction').fill('确认操作');
    await page.locator('#aiRefBodyFont').fill('20'); await page.locator('#aiRefTitleFont').fill('30');
    assert.match(await page.locator('#aiTypographySummary').textContent(), /1.5 倍/);
    await page.locator('#aiSendBtn').click(); await page.locator('#generationDialog').waitFor({ state: 'visible' });
    assert.equal(sent.task.mode, mode); assert.equal(sent.task.referenceSpec.width, width);
    assert.equal(sent.task.layoutReference.typography.titleRatio, 1.5);
    assert.equal(sent.body.messages.at(-1).content[1].image_url.url, 'data:image/png;base64,' + png.toString('base64'));
    assert.equal(await page.locator('#generationName').inputValue(), `参考${mode}`);
    assert.equal(await page.locator('#generationReferenceImage').isVisible(), true);
    assert.match(await page.locator('#generationLayoutRows').textContent(), /24 px/);
    await page.locator('#generationApplyBtn').click(); await saved();
    const record = await current();
    if (mode === 'component') {
      const component = record.library.find(item => item.name === `参考${mode}`);
      assert.equal(component.defaultWidth, width); assert.equal(component.defaultHeight, height);
    } else {
      const generated = record.project.pages.find(item => item.name === `参考${mode}`);
      assert.equal(generated.kind, mode); assert.equal(generated.canvas.width, width); assert.equal(generated.canvas.height, height);
      assert.equal(generated.items[0].container.mode, 'vertical');
      assert.equal(generated.items[1].parentId, generated.items[0].id);
      assert.equal(generated.items[0].appearance.background, 'transparent');
      assert.match(sent.body.messages[0].content, /必须先规划真实布局容器/);
      if (mode === 'popup') { assert.equal(generated.frame.style, 'none'); assert.equal(generated.safeArea.enabled, false); }
    }
  }
  await page.locator('#aiMode').selectOption('modify');
  const before = (await current()).project;
  const target = before.pages.find(item => item.name === '参考page');
  const popup = before.pages.find(item => item.name === '参考popup');
  for (const id of ['aiRefName', 'aiRefWidth', 'aiRefHeight', 'aiRefFunction']) await page.locator(`#${id}`).fill('');
  await page.locator('#aiTarget').selectOption(target.id);
  assert.match(await page.locator('#aiLayoutRows').textContent(), /参考标题/);
  assert.match(await page.locator('#aiLayoutSummary').textContent(), /480 × 700/);
  await page.locator('#aiRequirement').fill('优化标题'); await page.locator('#aiSendBtn').click();
  await page.waitForFunction(() => document.getElementById('aiStatus').textContent.includes('完成，可以继续提出修改需求。')); await saved();
  const optimized = (await current()).project;
  assert.equal(optimized.activePageId, before.activePageId);
  assert.equal(optimized.pages.find(item => item.id === target.id).items.find(item => !item.container).name, '优化后的标题');
  assert.deepEqual(optimized.pages.find(item => item.id === popup.id), popup);
  // 跨页优化等待期间修改正在编辑的弹窗，应保留两份修改。
  await page.locator('#aiRequirement').fill('等待优化'); await page.locator('#aiSendBtn').click();
  await page.waitForFunction(() => !document.getElementById('aiCancelBtn').hidden);
  await page.locator('#aiCloseBtn').click();
  await page.locator('#basicTab').click();
  await page.locator('[data-comp-id="lib-btn"]').click();
  const localCount = await page.locator('.editor-item').count();
  for (let attempt = 0; !release && attempt < 80; attempt++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.ok(release);
  release(); await page.locator('#aiPending').waitFor({ state: 'visible' });
  await page.locator('#mergeOpenBtn').click(); await page.locator('#mergeApplyBtn').click(); await saved();
  assert.equal((await current()).project.items.length, localCount);
  await page.locator('#aiRefBodyFont').fill('16'); await page.locator('#aiRefTitleFont').fill('24');
  await page.locator('#aiTypographySummary').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve(output, 'ai-reference-desktop.png') });
  await page.locator('#languageSelect').selectOption('en');
  assert.match(await page.locator('#aiTypographySummary').textContent(), /Text sizes/);
  assert.equal(await page.locator('#aiTarget option').filter({ hasText: '参考page' }).count(), 1);
  await page.locator('#languageSelect').selectOption('zh');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#aiSendBtn').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(output, 'ai-reference-mobile.png') });
  await page.reload(); await page.locator('.editor-item').first().waitFor(); await clickAction(page, '#aiToggleBtn');
  assert.equal(await page.locator('#aiImagePreview').isVisible(), false);
  assert.equal((await current()).project.pages.find(item => item.id === popup.id).kind, 'popup');
  assert.deepEqual(errors, []);
  console.log('通过：所有输出类型参考图、基础信息与字号比例、生成对照预览、指定尺寸、弹窗类型、跨页优化及并发合并、双语窄屏和刷新保护');
} finally { await close(); }
