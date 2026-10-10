import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_PROMPT, completionURL, normalizeAISettings, parseAIResponse, requestAI } from '../src/ai.js';
import { createVersions, validateWorkspace, mergeProjects } from '../src/versions.js';
import { validateProject } from '../src/model.js';

const clean = value => value.replace(/<script>.*?<\/script>/g, '');
const item = { id: 'button', name: '按钮', type: 'html', content: '<button>登录</button>', x: 20, y: 40, width: 100, height: 40, radius: 8, padding: '0', margin: '0' };
const base = () => validateProject({ version: 1, canvas: { width: 375, height: 667, preset: 'phone' }, items: [structuredClone(item)] }, clean);
const reply = changes => JSON.stringify({ version: 1, summary: '优化登录按钮', changes });

test('HTTPS 页面升级旧 HTTP 设置，保留路径、查询参数及鉴权，本地 HTTP 配置仍可使用', () => {
  const settings = { url: ' http://api.example.test/v1/chat/completions?api-version=1 ', key: 'test-key', model: 'test-model' };
  const secure = normalizeAISettings(settings, 'https:');
  assert.deepEqual(secure, { ...settings, url: 'https://api.example.test/v1/chat/completions?api-version=1' });
  assert.equal(completionURL(secure.url), secure.url);
  assert.equal(normalizeAISettings(settings, 'http:').url, settings.url.trim());
  assert.equal(normalizeAISettings({ url: 'https://api.example.test/v1' }, 'https:').url, 'https://api.example.test/v1');
  assert.equal(settings.url.startsWith(' http:'), true);
});

test('连接失败提示跨域要求且不泄露凭据，取消请求保留取消原因', async () => {
  const settings = { url: 'https://api.example.test/v1', key: 'secret-key', model: 'test' };
  await assert.rejects(requestAI(settings, '调整', base(), [], undefined, async () => { throw new TypeError('Failed to fetch'); }), error => {
    assert.match(error.message, /跨域配置（CORS）/);
    assert.match(error.message, /POST/);
    assert.equal(error.message.includes(settings.key), false);
    return true;
  });
  const controller = new AbortController(); controller.abort();
  const reason = new DOMException('请求已取消', 'AbortError');
  await assert.rejects(requestAI(settings, '调整', base(), [], controller.signal, async () => { throw reason; }), error => error === reason);
});

test('AI 协议保留未修改字段并安全处理内容', () => {
  const initial = base();
  const result = parseAIResponse(reply([{ op: 'update', id: item.id, fields: { content: '<button>立即登录</button><script>alert(1)</script>', width: 150 } }]), initial, clean);
  assert.equal(result.project.items[0].content, '<button>立即登录</button>');
  assert.equal(result.project.items[0].width, 150);
  assert.equal(result.project.items[0].y, 40);
  assert.deepEqual(initial, base());
});
test('错误协议、未知操作、非法字段、重复标识均被拒绝', () => {
  for (const text of ['```json\n{}\n```', '{}', reply([{ op: 'execute', code: 'alert(1)' }]), reply([{ op: 'update', id: 'missing', fields: { x: 20 } }]), reply([{ op: 'update', id: item.id, fields: { id: 'replacement' } }]), reply([{ op: 'add', item }]), reply([{ op: 'canvas', fields: { width: 'oops' } }])]) {
    assert.throws(() => parseAIResponse(text, base(), clean));
  }
});
test('AI 可调整自定义画布和设备外框，非法留白不能通过协议', () => {
  const result = parseAIResponse(reply([{ op: 'canvas', fields: { width: 800, height: 600 } }, { op: 'frame', fields: { device: 'pc', style: 'browser', insets: { top: 20 } } }]), base(), clean);
  assert.equal(result.project.canvas.preset, 'custom');
  assert.equal(result.project.frame.device, 'pc');
  assert.equal(result.project.frame.style, 'browser');
  assert.equal(result.project.frame.insets.top, 20);
  assert.throws(() => parseAIResponse(reply([{ op: 'frame', fields: { insets: 'invalid' } }]), base(), clean));
});
test('多轮请求带固定系统规范、客户需求、项目和历史，支持完整与基础地址', async () => {
  assert.equal(completionURL('https://example.com/v1/'), 'https://example.com/v1/chat/completions');
  assert.equal(completionURL('https://example.com/v1/chat/completions?api-version=1'), 'https://example.com/v1/chat/completions?api-version=1');
  assert.throws(() => normalizeAISettings({ url: 'file:///tmp/a' }));
  let sent;
  const controller = new AbortController();
  const content = await requestAI({ url: 'https://example.com/v1', key: 'test-key', model: 'test' }, '放大按钮', base(), [{ role: 'user', content: '做登录页' }, { role: 'assistant', content: '已完成' }, { role: 'system', content: '已回退' }], controller.signal, async (url, options) => {
    sent = { url, ...options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: reply([]) } }] }) };
  });
  assert.equal(sent.headers.Authorization, 'Bearer test-key');
  assert.equal(sent.redirect, 'error');
  assert.ok(sent.body.messages[0].content.startsWith(AI_PROMPT));
  assert.match(sent.body.messages[0].content, /内置设计规范/);
  assert.equal(sent.body.messages.length, 4);
  assert.equal(JSON.parse(sent.body.messages.at(-1).content).requirement, '放大按钮');
  assert.equal(content, reply([]));
});
test('接口错误不会泄露接口响应或 Key', async () => {
  await assert.rejects(requestAI({ url: 'https://example.com', key: 'secret', model: 'test' }, '调整', base(), [], new AbortController().signal, async () => ({ ok: false, status: 401 })), /401/);
});
test('不同字段、组件增删自动合并，本地修改保留', () => {
  const initial = base(), local = base(), remote = base();
  local.items[0].x = 100; remote.items[0].name = '立即登录';
  remote.items.push({ ...item, id: 'heading', name: '标题' });
  const result = mergeProjects(initial, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.project.items[0].x, 100);
  assert.equal(result.project.items[0].name, '立即登录');
  assert.equal(result.project.items.length, 2);
  const deletion = base(); deletion.items = [];
  assert.equal(mergeProjects(initial, initial, deletion).project.items.length, 0);
});
test('同字段冲突可选本地或 AI，删除与编辑冲突不丢组件', () => {
  const initial = base(), local = base(), remote = base();
  local.items[0].x = 80; remote.items[0].x = 120;
  const first = mergeProjects(initial, local, remote);
  assert.equal(first.conflicts.length, 1); assert.equal(first.project.items[0].x, 80);
  const key = first.conflicts[0].key;
  assert.equal(mergeProjects(initial, local, remote, { [key]: 'ai' }).project.items[0].x, 120);
  remote.items = [];
  const deleted = mergeProjects(initial, local, remote);
  assert.equal(deleted.conflicts.length, 1); assert.equal(deleted.project.items.length, 1);
  assert.equal(mergeProjects(initial, local, remote, { [deleted.conflicts[0].key]: 'ai' }).project.items.length, 0);
});
test('版本回退继续编辑保留分支，合并记录双亲且刷新可恢复', () => {
  const initial = base(), changed = base(); changed.items[0].x = 80;
  const versions = createVersions(initial), root = versions.head;
  const localId = versions.add(changed, '移动按钮');
  const ai = base(); ai.items[0].name = '登录';
  const aiId = versions.add(ai, '智能修改', { parent: root, branch: true });
  assert.equal(versions.head, localId);
  versions.add(mergeProjects(initial, changed, ai).project, '合并修改', { mergeParent: aiId });
  assert.equal(versions.entries.at(-1).mergeParent, aiId);
  versions.checkout(root); versions.add(ai, '新分支');
  assert.equal(versions.entries.length, 5);
  assert.equal(versions.entries.at(-1).parent, root);
  const saved = validateWorkspace({ version: 1, versions: versions.serialize(), messages: [], pending: { baseId: root, aiId, summary: '修改' } }, value => validateProject(value, clean));
  const restored = createVersions(initial, saved.versions);
  assert.deepEqual(restored.current, ai);
  assert.equal(restored.entries.length, 5);
  assert.throws(() => validateWorkspace({ ...saved, pending: { baseId: 'missing', aiId, summary: '修改' } }, value => value));
});

test('相同内容的每次主动保存仍形成版本，未保存草稿独立备份且兼容旧备份', () => {
  const versions = createVersions(base());
  versions.add(base(), '保存', { force: true }); versions.add(base(), '保存', { force: true });
  assert.equal(versions.entries.length, 3);
  const draft = base(); draft.items[0].name = '尚未生成版本的草稿';
  const workspace = { version: 1, project: draft, versions: versions.serialize(), messages: [], pending: null };
  const valid = value => validateProject(value, clean);
  assert.deepEqual(validateWorkspace(workspace, valid).project, draft);
  assert.equal(validateWorkspace(workspace, valid).versions.entries.length, 3);
  delete workspace.project;
  assert.equal(validateWorkspace(workspace, valid).project, undefined);
});
