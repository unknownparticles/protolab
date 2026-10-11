import { startBrowserTest } from './harness.mjs';
import { clickAction } from './browser-actions.mjs';
import assert from 'node:assert/strict';

const { base, browser, close } = await startBrowserTest({ port: 4188 });
try {
  const page = await browser.newPage({ locale: 'zh-CN' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('https://protolab.example.test/**', async route => {
    const url = new URL(route.request().url());
    await route.fulfill({ response: await page.request.get(`${base}${url.pathname}${url.search}`) });
  });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    if (!localStorage.getItem('protolab.ai.settings.v1')) localStorage.setItem('protolab.ai.settings.v1', JSON.stringify({ url: 'http://ai.example.test/v1', model: 'test', key: 'mock-secret' }));
  });
  let fail = false, sent;
  await page.route('https://ai.example.test/**', async route => {
    sent = route.request();
    if (fail) { await route.abort('failed'); return; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, summary: '已新增标题', changes: [{ op: 'add', item: { id: 'transport-title', name: '标题', type: 'html', content: '<h1>标题</h1>', x: 20, y: 20, width: 200, height: 50 } }] }) } }] }) });
  });
  await page.goto('https://protolab.example.test/');
  await clickAction(page, '#settingsBtn');
  assert.equal(await page.locator('#aiURL').inputValue(), 'https://ai.example.test/v1');
  await page.locator('[data-close="settingsDialog"]').first().click();
  await clickAction(page, '#aiToggleBtn');
  const send = async () => {
    await page.locator('#aiRequirement').fill('新增标题');
    await page.locator('#aiSendBtn').click();
    await page.waitForFunction(() => document.getElementById('aiCancelBtn').hidden);
  };
  await send();
  assert.equal(sent.url(), 'https://ai.example.test/v1/chat/completions');
  assert.equal(sent.headers().authorization, 'Bearer mock-secret');
  assert.equal(await page.locator('.editor-item').count(), 1);
  console.log('通过：HTTPS 页面读取旧 HTTP 设置，使用 HTTPS 携带鉴权请求并应用 AI 结果');
  await clickAction(page, '#settingsBtn');
  await page.locator('#aiURL').fill('http://ai.example.test/v1');
  await page.locator('#aiSettingsForm button[type=submit]').click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.ai.settings.v1')).url), 'https://ai.example.test/v1');
  assert.match(await page.locator('#toast').textContent(), /HTTPS/);
  console.log('通过：保存 HTTP 地址时自动升级，并告知用户');
  fail = true;
  await send();
  assert.match(await page.locator('#aiStatus').textContent(), /HTTPS.*跨域配置（CORS）/);
  assert.equal(await page.locator('.editor-item').count(), 1);
  assert.equal(await page.locator('#aiSendBtn').isEnabled(), true);
  assert.deepEqual(errors, []);
  console.log('通过：网络或跨域失败显示配置要求，保留设计并可重试');
  await page.route('https://api.deepseek.com/**', async route => {
    sent = route.request();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ version: 1, summary: '已更新标题', changes: [{ op: 'update', id: 'transport-title', fields: { name: 'DeepSeek 标题' } }] }) } }] }) });
  });
  await clickAction(page, '#settingsBtn');
  await page.locator('#aiRememberKey').check();
  await page.locator('#aiDeepSeekBtn').click();
  assert.equal(await page.locator('#aiURL').inputValue(), 'https://api.deepseek.com/v1');
  assert.equal(await page.locator('#aiModel').inputValue(), 'deepseek-chat');
  assert.equal(await page.locator('#aiKey').inputValue(), '');
  assert.equal(await page.locator('#aiRememberKey').isChecked(), false);
  await page.locator('[data-close="settingsDialog"]').first().click();
  await clickAction(page, '#settingsBtn');
  assert.equal(await page.locator('#aiURL').inputValue(), 'https://ai.example.test/v1');
  assert.equal(await page.locator('#aiKey').inputValue(), 'mock-secret');
  await page.locator('#aiDeepSeekBtn').click();
  await page.locator('#aiKey').fill('mock-deepseek-key');
  await page.locator('#aiSettingsForm button[type=submit]').click();
  await send();
  assert.equal(sent.url(), 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(sent.headers().authorization, 'Bearer mock-deepseek-key');
  assert.equal(sent.postDataJSON().model, 'deepseek-chat');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('protolab.ai.settings.v1')).key), '');
  assert.equal(await page.locator('[data-item-id="transport-title"] .item-label').textContent(), 'DeepSeek 标题');
  assert.deepEqual(errors, []);
  console.log('通过：DeepSeek 快捷配置、清空旧 Key、取消恢复及保存后正确请求和应用');
} finally { await close(); }
