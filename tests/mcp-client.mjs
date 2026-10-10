import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

/** 验收使用真实标准输入输出，禁止开发日志混入 MCP 响应。 */
export function startMCPClient(url) {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, '../scripts/mcp-server.mjs'), '--url', url], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let sequence = 0, stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    let message;
    try { message = JSON.parse(line); } catch { for (const task of pending.values()) task.reject(new Error(`标准输出包含非协议内容：${line}`)); return; }
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id); clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
  });
  child.on('exit', () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error(`MCP 进程已退出：${stderr}`)); } pending.clear(); });
  function request(method, params) {
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 请求超时：${method}`)); }, 25000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`);
    });
  }
  return {
    child, request,
    async initialize(protocolVersion = '2025-06-18') {
      const result = await request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'protolab-test', version: '1.0.0' } });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
      return result;
    },
    call: (name, args = {}) => request('tools/call', { name, arguments: args }),
    close: () => new Promise(resolve => { if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; } child.once('exit', resolve); child.kill(); }),
  };
}
