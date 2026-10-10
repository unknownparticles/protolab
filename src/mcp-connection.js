import { t } from './i18n.js';
import { MCP_CLIENTS, mcpConfig } from './mcp-config.js';

export function initializeMCPConnection({ editor, getMetadata, notify }) {
  const $ = id => document.getElementById(id);
  const local = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  const sessionId = crypto.randomUUID();
  let config = null, connected = false, polling = false, timer = null, controller = null;
  let status = '尚未连接';
  function render() {
    $('mcpStatus').textContent = t(status);
    $('mcpConnectBtn').textContent = t(connected ? '断开当前标签页' : '连接当前标签页');
    $('mcpConnectBtn').disabled = !local;
    $('mcpConfig').value = config ? mcpConfig($('mcpClient').value, config) : '';
    $('mcpConfigFile').textContent = MCP_CLIENTS[$('mcpClient').value].file;
    $('mcpCopyBtn').disabled = !config;
    $('mcpSessionId').textContent = connected ? sessionId : '';
  }
  async function request(path, body, signal = AbortSignal.timeout(5000)) {
    const response = await fetch(`/__protolab/${path}`, { method: body ? 'POST' : 'GET', signal, redirect: 'error', headers: { ...(config ? { 'X-Protolab-Token': config.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(t('本地服务未连接，请运行开发服务后重新连接'));
    const value = await response.json();
    if (value.error) throw new Error(value.error);
    return value;
  }
  async function loadConfig() {
    const value = await request('config');
    if (typeof value.token !== 'string' || typeof value.script !== 'string' || typeof value.command !== 'string') throw new Error(t('本地服务未连接，请运行开发服务后重新连接'));
    config = value; render();
  }
  async function poll() {
    if (!connected || polling) return;
    polling = true;
    controller = new AbortController();
    const timeout = setTimeout(() => controller?.abort(), 5000);
    try {
      const { command } = await request('poll', { sessionId, metadata: getMetadata() }, controller.signal);
      if (!connected) return;
      status = '已连接，AI 工具可调用当前标签页'; render();
      if (command) {
        let result, error;
        try {
          if (Date.now() >= command.expiresAt) throw new Error('请求已过期，请重新读取工程');
          if (command.args.sessionId !== sessionId) throw new Error('标签页不匹配');
          result = editor.execute(command.name, command.args);
        } catch (failure) { error = failure.message || '易设调用失败'; }
        // 结果投递失败时不重放操作，客户端须重新读取工程核对。
        await request('result', { sessionId, id: command.id, ...(error ? { error } : { result }) });
      }
    } catch {
      if (connected) { status = '连接中断，请重新连接并读取工程'; render(); }
    } finally {
      clearTimeout(timeout); controller = null; polling = false;
      if (connected) timer = setTimeout(poll, status === '连接中断，请重新连接并读取工程' ? 2000 : 750);
    }
  }
  async function disconnect() {
    connected = false; clearTimeout(timer); controller?.abort();
    status = '尚未连接'; render();
    try { await request('disconnect', { sessionId }); } catch { /* 服务停止时会自动过期。 */ }
  }
  $('mcpClient').addEventListener('change', render);
  $('mcpConnectBtn').addEventListener('click', async () => {
    if (connected) { await disconnect(); return; }
    $('mcpConnectBtn').disabled = true;
    try { await loadConfig(); connected = true; status = '正在连接…'; render(); await poll(); }
    catch (error) { status = error.message; render(); }
  });
  $('mcpCopyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('mcpConfig').value); notify(t('MCP 配置已复制')); }
    catch { $('mcpConfig').focus(); $('mcpConfig').select(); notify(t('请复制已选中的配置文本')); }
  });
  $('mcpSettingsBtn').addEventListener('click', async () => {
    if (!local) status = 'MCP 接入需要本地运行：npm run dev';
    $('mcpDialog').showModal(); render();
    if (local && !config) { try { await loadConfig(); } catch (error) { status = error.message; render(); } }
  });
  window.addEventListener('pagehide', () => {
    connected = false; clearTimeout(timer); controller?.abort();
    if (config) void fetch('/__protolab/disconnect', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Protolab-Token': config.token }, body: JSON.stringify({ sessionId }) }).catch(() => {});
  });
  return { refreshLocale: render };
}
