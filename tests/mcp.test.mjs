import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPEditor } from '../src/mcp-editor.js';
import { emptyProject } from '../src/projects.js';
import { addPage, switchPage } from '../src/pages.js';
import { designAssets } from '../src/project-design.js';
import { COMPONENTS } from '../src/presets.js';
import { MCP_CLIENTS, mcpConfig } from '../src/mcp-config.js';

const item = { id: 'mcp-title', name: '标题', type: 'html', content: '<h1>欢迎</h1><script>bad()</script>', x: 20, y: 80, width: 240, height: 60 };
const sessionId = 'test-tab';
function fixture() {
  let current = { projectId: 'one', name: '工程一', rules: '保持简洁', project: emptyProject(), library: structuredClone(COMPONENTS) };
  let busy = false;
  const applied = [];
  const editor = createMCPEditor({ getState: () => current, getAssets: project => designAssets(current.design, project, current.library), sanitize: value => value.replace(/<script>.*?<\/script>/g, ''),
    isBusy: () => busy, apply: (project, label) => { current.project = project; applied.push(label); }, exportFile: format => ({ content: JSON.stringify(current.project), format }),
  });
  const read = args => editor.execute('protolab_get_project', { sessionId, ...args });
  const change = (changes, args = {}) => editor.execute('protolab_apply_changes', { sessionId, expectedRevision: read().revision, summary: '修改标题', changes, ...args });
  return { editor, read, change, applied, get current() { return current; }, set current(value) { current = value; }, set busy(value) { busy = value; } };
}
test('五种客户端配置支持绝对路径、空格和自定义端口', () => {
  const config = { command: '/opt/node', script: '/test folder/易设/mcp-server.mjs', url: 'http://127.0.0.1:4188' };
  for (const client of Object.keys(MCP_CLIENTS)) {
    const text = mcpConfig(client, config);
    if (client === 'codex') { assert.match(text, /\[mcp_servers.protolab\]/); assert.ok(text.includes(JSON.stringify(config.script))); }
    else {
      const value = JSON.parse(text);
      if (client === 'opencode') assert.deepEqual(value.mcp.protolab.command, [config.command, config.script, '--url', config.url]);
      else assert.deepEqual(value.mcpServers.protolab, { command: config.command, args: [config.script, '--url', config.url] });
    }
  }
});
test('工程读取提供规范与关联清单，变更清理内容并一次应用', () => {
  const f = fixture(); const before = f.read();
  assert.equal(before.rules, '保持简洁'); assert.equal(before.library, undefined);
  assert.equal(before.designContext.library.components.length, COMPONENTS.length);
  assert.match(before.changeProtocol, /libraryId/);
  const result = f.change([{ op: 'add', item }]);
  assert.ok(result.revision > before.revision); assert.equal(f.applied.length, 1);
  assert.equal(f.current.project.items[0].content, '<h1>欢迎</h1>');
  assert.equal(f.read().revision, result.revision);
});
test('拒绝旧版本、工程切换和等待期间组件库或规范变化，不覆盖人工修改', () => {
  for (const mutate of [f => { f.current.project.canvas.width = 400; }, f => { f.current.rules = '新版规范'; }, f => { f.current.library[0].name = '新名称'; }, f => { f.current.projectId = 'two'; }]) {
    const f = fixture(), revision = f.read().revision; mutate(f);
    assert.throws(() => f.change([{ op: 'add', item }], { expectedRevision: revision }), /工程已改变/);
    assert.equal(f.applied.length, 0);
  }
});
test('整批变更校验失败、非法字段与忙碌状态保留原设计', () => {
  const f = fixture(), before = structuredClone(f.current.project);
  assert.throws(() => f.change([{ op: 'add', item }, { op: 'remove', id: 'absent' }]), /不存在/);
  assert.throws(() => f.change([{ op: 'canvas', fields: { unsafe: true } }]), /不支持/);
  assert.throws(() => f.change([{ op: 'add', item }], { expectedRevision: '1' }), /格式/);
  assert.throws(() => f.change([{ op: 'add', item }], { force: true }), /未知字段/);
  f.busy = true; assert.throws(() => f.change([{ op: 'add', item }]), /正在/);
  assert.equal(f.applied.length, 0); assert.deepEqual(f.current.project, before);
});
test('修改指定页保留当前编辑页，新建页面失败时不留下空页', () => {
  const f = fixture(); const home = f.current.project.activePageId;
  f.current.project = addPage(f.current.project); const second = f.current.project.activePageId;
  f.current.project = switchPage(f.current.project, home);
  f.change([{ op: 'add', item }], { pageId: second });
  assert.equal(f.current.project.activePageId, home); assert.equal(f.current.project.items.length, 0);
  assert.equal(f.current.project.pages.find(page => page.id === second).items.length, 1);
  const before = structuredClone(f.current.project);
  assert.throws(() => f.editor.execute('protolab_create_page', { sessionId, expectedRevision: f.read().revision, name: '失败页面', changes: [{ op: 'remove', id: item.id }] }), /只能/);
  assert.deepEqual(f.current.project, before);
  const result = f.editor.execute('protolab_create_page', { sessionId, expectedRevision: f.read().revision, kind: 'popup', name: '登录弹窗', changes: [{ op: 'add', item: { ...item, id: 'popup-heading' } }] });
  assert.equal(f.current.project.activePageId, result.pageId); assert.equal(f.current.project.pages.at(-1).name, '登录弹窗');
});
