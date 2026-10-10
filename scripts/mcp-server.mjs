import { StringDecoder } from 'node:string_decoder';
import { pathToFileURL } from 'node:url';
import { MCP_TOOLS, MCP_INSTRUCTIONS, validateToolArguments } from '../src/mcp-tools.js';

export function startMCPStdio(address) {
  const url = new URL(address);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('易设 MCP 只支持本机 HTTP 桥接地址');
  let initialized = false;
  const requests = new Map();
  const write = value => process.stdout.write(`${JSON.stringify(value)}\n`);
  const fail = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  async function bridge(path, { signal, token, body } = {}) {
    const response = await fetch(new URL(`/__protolab/${path}`, url), { method: body ? 'POST' : 'GET', redirect: 'error', signal: signal || AbortSignal.timeout(20000), headers: { ...(token ? { 'X-Protolab-Token': token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const value = await response.json();
    if (!response.ok || value.error) throw new Error(value.error || `本地服务返回 ${response.status}`);
    return value;
  }
  async function receive(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string' || Object.hasOwn(message, 'id') && typeof message.id !== 'string' && typeof message.id !== 'number') { fail(null, -32600, '无效的 JSON-RPC 请求'); return; }
    if (!Object.hasOwn(message, 'id')) {
      if (message.method === 'notifications/cancelled') requests.get(message.params?.requestId)?.abort();
      return;
    }
    const { id, method, params } = message;
    if (method === 'initialize') {
      if (!params || typeof params.protocolVersion !== 'string') { fail(id, -32602, '缺少协议版本'); return; }
      initialized = true;
      const versions = ['2024-11-05', '2025-03-26', '2025-06-18'];
      write({ jsonrpc: '2.0', id, result: { protocolVersion: versions.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'protolab', version: '1.0.0' }, instructions: MCP_INSTRUCTIONS } });
    } else if (method === 'ping') write({ jsonrpc: '2.0', id, result: {} });
    else if (!initialized) fail(id, -32000, '请先初始化 MCP 连接');
    else if (method === 'tools/list') write({ jsonrpc: '2.0', id, result: { tools: MCP_TOOLS } });
    else if (method === 'tools/call') {
      const controller = new AbortController();
      requests.set(id, controller);
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        const args = params?.arguments ?? {};
        validateToolArguments(params?.name, args);
        let config;
        try { config = await bridge('config', { signal: controller.signal }); }
        catch (error) { throw new Error(`无法连接易设桥接，请先启动外挂（npm run bridge）或本地编辑器（npm run dev），桥接地址为 ${url.href}。${error.message}`); }
        const data = params.name === 'protolab_list_sessions' ? await bridge('sessions', { token: config.token, signal: controller.signal }) : (await bridge('call', { token: config.token, signal: controller.signal, body: { name: params.name, args } })).result;
        write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } });
      } catch (error) {
        write({ jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: error.message || '易设调用失败' }] } });
      } finally { clearTimeout(timer); requests.delete(id); }
    } else fail(id, -32601, '不支持的 MCP 方法');
  }
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += decoder.write(chunk);
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > 4 * 1024 * 1024) { fail(null, -32600, 'MCP 请求过大'); continue; }
      try { void receive(JSON.parse(line)).catch(() => fail(null, -32603, 'MCP 内部错误')); }
      catch { fail(null, -32700, '无法解析 JSON'); }
    }
    if (Buffer.byteLength(buffer) > 4 * 1024 * 1024) { fail(null, -32600, 'MCP 请求过大'); process.stdin.destroy(); }
  });
  process.stdin.on('end', () => { for (const controller of requests.values()) controller.abort(); });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const index = process.argv.indexOf('--url');
  startMCPStdio(index < 0 ? process.env.PROTOLAB_URL || 'http://127.0.0.1:4173' : process.argv[index + 1]);
}
