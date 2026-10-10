import { createServer } from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMCPBridge } from './mcp-bridge.mjs';
import { startMCPStdio } from './mcp-server.mjs';
import { bridgeURL } from '../src/mcp-config.js';

/** 一个文件即可运行的外挂；打包版保留此入口，开发版复用相同模块。 */
const file = fileURLToPath(import.meta.url);
const arg = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; };
const url = new URL(bridgeURL(arg('--url') || 'http://127.0.0.1:4174'));
if (process.argv.includes('--stdio')) startMCPStdio(url.href);
else {
  const port = Number(url.port || 80);
  const origin = arg('--origin') || 'https://alunapp.cn';
  const bridge = createMCPBridge({ port, root: dirname(file), script: resolve(file), stdio: true, allowedOrigins: [origin] });
  const server = createServer(async (request, response) => {
    if (!await bridge.handle(request, response, new URL(request.url, url).pathname)) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('易设外挂只提供桥接接口');
    }
  });
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `外挂端口 ${port} 已占用，请使用正在运行的外挂，或通过 --url 指定其他端口。` : error.message); process.exitCode = 1; });
  server.on('close', () => bridge.close());
  server.listen(port, '127.0.0.1', () => {
    console.log(`易设外挂已启动：${url.origin}\n允许网页来源：${origin}\n打开易设「工具 → MCP 接入」，连接此外挂并复制客户端配置。保持此窗口运行，按 Ctrl+C 停止。`);
  });
  const stop = () => { bridge.close(); server.close(); server.closeAllConnections(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
