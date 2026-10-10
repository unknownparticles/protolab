import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { createMCPBridge } from '../scripts/mcp-bridge.mjs';
import { startMCPClient } from './mcp-client.mjs';

async function fixture(t, options = {}) {
  let bridge;
  const server = createServer(async (request, response) => {
    if (!await bridge.handle(request, response, new URL(request.url, 'http://localhost').pathname)) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port, url = `http://127.0.0.1:${port}`;
  bridge = createMCPBridge({ port, root: resolve(import.meta.dirname, '..'), ...options });
  t.after(async () => { bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { token } = await (await fetch(`${url}/__protolab/config`)).json();
  const request = (path, body, extra = {}) => fetch(`${url}/__protolab/${path}`, { method: body ? 'POST' : 'GET', headers: { 'X-Protolab-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}), ...extra }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const poll = (sessionId = 'tab-one') => request('poll', { sessionId, metadata: { projectId: 'project-one', name: '测试工程' } }).then(response => response.json());
  return { url, request, poll };
}
test('标准 MCP 握手、工具发现、工具错误和真实标准输入输出调用', async t => {
  const f = await fixture(t), client = startMCPClient(f.url); t.after(() => client.close());
  const initialized = await client.initialize('2024-11-05');
  assert.equal(initialized.protocolVersion, '2024-11-05'); assert.match(initialized.instructions, /expectedRevision/);
  const { tools } = await client.request('tools/list'); assert.equal(tools.length, 5);
  assert.equal(tools.find(tool => tool.name === 'protolab_get_project').annotations.readOnlyHint, true);
  assert.equal((await client.call('unknown')).isError, true);
  assert.equal((await client.call('protolab_get_project', {})).isError, true);
  assert.deepEqual((await client.call('protolab_list_sessions')).structuredContent.sessions, []);
  await f.poll();
  assert.equal((await client.call('protolab_list_sessions')).structuredContent.sessions[0].sessionId, 'tab-one');
  const reading = client.call('protolab_get_project', { sessionId: 'tab-one' });
  let command;
  for (let i = 0; i < 50; i++) { command = (await f.poll()).command; if (command) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(command.name, 'protolab_get_project');
  await f.request('result', { id: command.id, sessionId: 'tab-one', result: { revision: 1, name: '中文工程' } });
  assert.equal((await reading).structuredContent.name, '中文工程');
});
test('本地桥拒绝跨站与伪造来源，结果必须对应标签页且操作不重放', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('config', null, { Origin: 'https://evil.example' })).status, 403);
  const badHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${f.url}/__protolab/config`, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(badHostStatus, 403);
  assert.equal((await f.request('sessions', null, { 'X-Protolab-Token': 'wrong' })).status, 403);
  await f.poll(); await f.poll('tab-two');
  const calling = f.request('call', { name: 'protolab_get_project', args: { sessionId: 'tab-one' } });
  let command;
  for (let i = 0; i < 50; i++) { command = (await f.poll()).command; if (command) break; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal((await f.poll()).command, null); assert.equal((await f.poll('tab-two')).command, null);
  assert.equal((await f.request('result', { sessionId: 'tab-two', id: command.id, result: {} })).status, 400);
  await f.request('result', { sessionId: 'tab-one', id: command.id, result: { ok: true } });
  assert.deepEqual(await (await calling).json(), { result: { ok: true } });
  await f.request('disconnect', { sessionId: 'tab-one' });
  assert.equal((await (await f.request('call', { name: 'protolab_get_project', args: { sessionId: 'tab-one' } })).json()).error.includes('连接目标标签页'), true);
});
test('未执行请求超时后移除，恢复轮询不会应用过期操作', async t => {
  const f = await fixture(t, { timeout: 80 }); await f.poll();
  const response = await f.request('call', { name: 'protolab_apply_changes', args: { sessionId: 'tab-one', expectedRevision: 1, summary: '过期修改', changes: [{ op: 'remove', id: 'item' }] } });
  assert.match((await response.json()).error, /未及时响应/);
  assert.equal((await f.poll()).command, null);
});
test('外挂仅允许指定站点跨域连接，预检与本机网络请求可用，不允许通配来源', async t => {
  const origin = 'https://alunapp.cn';
  const f = await fixture(t, { allowedOrigins: [origin], stdio: true });
  const response = await f.request('config', null, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(response.status, 200); assert.equal(response.headers.get('access-control-allow-origin'), origin);
  const config = await response.json(); assert.equal(config.stdio, true);
  assert.equal((await f.request('config', null, { Origin: 'https://alunapp.cn.evil.example', 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal((await f.request('config', null, { Origin: 'null' })).status, 403);
  const preflight = headers => fetch(`${f.url}/__protolab/poll`, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-protolab-token', 'Access-Control-Request-Private-Network': 'true', ...headers } });
  const valid = await preflight({}); assert.equal(valid.status, 204);
  assert.equal(valid.headers.get('access-control-allow-origin'), origin);
  assert.equal(valid.headers.get('access-control-allow-private-network'), 'true');
  assert.equal((await preflight({ Origin: 'https://evil.example' })).status, 403);
  assert.equal((await preflight({ 'Access-Control-Request-Method': 'DELETE' })).status, 403);
  assert.equal((await preflight({ 'Access-Control-Request-Headers': 'authorization' })).status, 403);
  const poll = await f.request('poll', { sessionId: 'online-tab', metadata: { projectId: 'online-project', name: '线上工程' } }, { Origin: origin, 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(poll.status, 200);
  assert.equal((await (await f.request('sessions')).json()).sessions[0].sessionId, 'online-tab');
  assert.equal((await f.request('sessions', null, { Origin: origin, 'X-Protolab-Token': 'wrong' })).status, 403);
  const beacon = token => fetch(`${f.url}/__protolab/disconnect`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ sessionId: 'online-tab', token }) });
  assert.equal((await beacon('wrong')).status, 403);
  assert.equal((await beacon(config.token)).status, 200);
  assert.equal((await (await f.request('sessions')).json()).sessions.length, 0);
});
