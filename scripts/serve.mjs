import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createMCPBridge } from './mcp-bridge.mjs';
const root = resolve(import.meta.dirname, '..');
const port = Number(process.env.PORT || 4173);
const bridge = createMCPBridge({ port, root });
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (await bridge.handle(request, response, pathname)) return;
    if (pathname.split('/').some(part => part.startsWith('.'))) throw new Error('禁止访问');
    let file = resolve(root, `.${pathname}`);
    if (!file.startsWith(root + sep) && file !== root) throw new Error('禁止访问');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('页面不存在'); }
}).listen(port, '127.0.0.1', () => console.log(`Protolab 已启动：http://127.0.0.1:${port}`));
server.on('close', () => bridge.close());
