import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { validateToolArguments } from '../src/mcp-tools.js';

const PREFIX = '/__protolab';
const MAX_BODY = 40 * 1024 * 1024;
const idValid = value => typeof value === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(value);
const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)); };
async function readJSON(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('请求数据过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 本地 HTTP 桥不存储工程，仅在客户端与浏览器之间转发请求。 */
export function createMCPBridge({ port, root, script = resolve(root, 'scripts/mcp-server.mjs'), stdio = false, allowedOrigins = [], timeout = 15000, sessionTTL = 45000 }) {
  const token = randomBytes(32).toString('hex');
  const sessions = new Map(), pending = new Map();
  const origins = new Set(allowedOrigins.map(value => {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.origin !== value || url.username || url.password) throw new Error('外挂允许来源必须是完整的站点来源');
    return url.origin;
  }));
  const config = { command: process.execPath, script, url: `http://127.0.0.1:${port}`, ...(stdio ? { stdio: true } : {}) };
  function finish(id, result) {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id); clearTimeout(task.timer);
    if (sessions.get(task.sessionId)?.inFlight === id) sessions.get(task.sessionId).inFlight = null;
    if (!task.response.destroyed) json(task.response, 200, result);
  }
  function removeSession(id) {
    sessions.delete(id);
    for (const [requestId, task] of pending) if (task.sessionId === id) finish(requestId, { error: '易设标签页已断开，请重新连接并读取工程' });
  }
  function prune() {
    for (const [id, session] of sessions) if (Date.now() - session.lastSeen > sessionTTL) removeSession(id);
  }
  async function handle(request, response, pathname) {
    if (!pathname.startsWith(`${PREFIX}/`)) return false;
    try {
      const host = request.headers.host;
      if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(host)) { json(response, 403, { error: '只允许本机访问' }); return true; }
      const origin = request.headers.origin;
      const sameOrigin = origin === `http://${host}`;
      const allowed = origins.has(origin);
      if (origin && !sameOrigin && !allowed || request.headers['sec-fetch-site'] === 'cross-site' && !allowed) { json(response, 403, { error: '此站点未获外挂允许，请在外挂启动参数中指定正确的站点来源' }); return true; }
      if (origin && (sameOrigin || allowed)) {
        response.setHeader('Access-Control-Allow-Origin', origin);
        response.setHeader('Vary', 'Origin');
      }
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = String(request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(value => value.trim()).filter(Boolean);
        if (!origin || !['GET', 'POST'].includes(method) || headers.some(name => !['content-type', 'x-protolab-token'].includes(name))) { json(response, 403, { error: '预检请求不受支持' }); return true; }
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Protolab-Token');
        if (request.headers['access-control-request-private-network'] === 'true') response.setHeader('Access-Control-Allow-Private-Network', 'true');
        response.writeHead(204); response.end(); return true;
      }
      // 页面卸载时使用简单 Beacon 请求，避免自定义请求头的跨域预检被浏览器取消。
      if (pathname === `${PREFIX}/disconnect` && request.method === 'POST' && request.headers['content-type']?.startsWith('text/plain')) {
        const body = await readJSON(request);
        if (body.token !== token || !idValid(body.sessionId)) { json(response, 403, { error: '本地连接已失效' }); return true; }
        removeSession(body.sessionId); json(response, 200, { ok: true }); return true;
      }
      if (pathname === `${PREFIX}/config` && request.method === 'GET') { json(response, 200, { ...config, token }); return true; }
      if (request.headers['x-protolab-token'] !== token) { json(response, 403, { error: '本地连接已失效，请重新连接' }); return true; }
      prune();
      if (pathname === `${PREFIX}/sessions` && request.method === 'GET') {
        json(response, 200, { sessions: [...sessions].map(([sessionId, session]) => ({ sessionId, ...session.metadata })) }); return true;
      }
      if (request.method !== 'POST' || !request.headers['content-type']?.startsWith('application/json')) { json(response, 405, { error: '须使用 JSON 请求' }); return true; }
      const body = await readJSON(request);
      if (pathname === `${PREFIX}/poll`) {
        if (!idValid(body.sessionId) || !body.metadata || typeof body.metadata.name !== 'string' || typeof body.metadata.projectId !== 'string') throw new Error('标签页信息不正确');
        if (!sessions.has(body.sessionId) && sessions.size >= 50) throw new Error('已连接的标签页过多');
        const session = sessions.get(body.sessionId) || { inFlight: null };
        session.lastSeen = Date.now();
        session.metadata = { name: body.metadata.name.slice(0, 40), projectId: body.metadata.projectId.slice(0, 100), activePageId: String(body.metadata.activePageId || '').slice(0, 100) };
        sessions.set(body.sessionId, session);
        const task = !session.inFlight && [...pending.values()].find(task => task.sessionId === body.sessionId && !task.delivered);
        if (task) { task.delivered = true; session.inFlight = task.id; }
        json(response, 200, { command: task ? { id: task.id, name: task.name, args: task.args, expiresAt: task.expiresAt } : null });
      } else if (pathname === `${PREFIX}/result`) {
        const task = pending.get(body.id);
        if (!task || task.sessionId !== body.sessionId || !task.delivered) throw new Error('请求已结束或标签页不匹配');
        if (!Object.hasOwn(body, 'result') && typeof body.error !== 'string') throw new Error('工具结果不正确');
        finish(body.id, typeof body.error === 'string' ? { error: body.error } : { result: body.result });
        json(response, 200, { ok: true });
      } else if (pathname === `${PREFIX}/disconnect`) {
        removeSession(body.sessionId); json(response, 200, { ok: true });
      } else if (pathname === `${PREFIX}/call`) {
        validateToolArguments(body.name, body.args);
        if (!sessions.has(body.args.sessionId)) throw new Error('请在易设的「工具 → MCP 接入」连接目标标签页，再列出标签页');
        if (pending.size >= 50) throw new Error('等待执行的请求过多，请稍后再试');
        const id = randomUUID();
        const task = { id, name: body.name, args: body.args, sessionId: body.args.sessionId, response, delivered: false, expiresAt: Date.now() + timeout };
        task.timer = setTimeout(() => finish(id, { error: '易设标签页未及时响应，请保持标签页打开并重新读取工程。修改可能已执行，请核对后再继续' }), timeout);
        pending.set(id, task);
        response.on('close', () => { if (pending.has(id)) finish(id, { error: '调用已取消' }); });
      } else json(response, 404, { error: '接口不存在' });
    } catch (error) { if (!response.headersSent && !response.destroyed) json(response, 400, { error: error.message || '本地桥请求失败' }); }
    return true;
  }
  return { handle, close() { for (const id of sessions.keys()) removeSession(id); } };
}
