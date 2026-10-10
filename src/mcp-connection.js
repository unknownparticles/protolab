import { t } from './i18n.js';
import { MCP_CLIENTS, mcpConfig, bridgeURL } from './mcp-config.js';

export function initializeMCPConnection({ editor, getMetadata, notify }) {
  const $ = id => document.getElementById(id);
  const local = location.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(location.hostname);
  const sessionId = crypto.randomUUID();
  let config = null, connected = false, connecting = false, timer = null, controller = null;
  let address = local ? location.origin : 'http://127.0.0.1:4174';
  let generation = 0, pollingGeneration = null;
  let status = '尚未连接';
  $('mcpBridgeField').hidden = local; $('mcpSidecarHelp').hidden = local;
  $('mcpDescription').textContent = t(local ? '连接此本地编辑器，或通过外挂连接线上易设。设计修改支持撤销与版本回退。' : '启动小外挂，即可让 AI 编程工具操作当前线上工程，无需迁移设计数据。');
  function render() {
    $('mcpStatus').textContent = t(status);
    $('mcpConnectBtn').textContent = t(connected ? '断开当前标签页' : '连接当前标签页');
    $('mcpConnectBtn').disabled = connecting;
    $('mcpBridgeURL').disabled = connected || connecting;
    $('mcpDescription').textContent = t(local ? '连接此本地编辑器，或通过外挂连接线上易设。设计修改支持撤销与版本回退。' : '启动小外挂，即可让 AI 编程工具操作当前线上工程，无需迁移设计数据。');
    $('mcpConfig').value = config ? mcpConfig($('mcpClient').value, config) : '';
    $('mcpConfigFile').textContent = MCP_CLIENTS[$('mcpClient').value].file;
    $('mcpCopyBtn').disabled = !config;
    $('mcpSessionId').textContent = connected ? sessionId : '';
  }
  async function request(path, body, signal = AbortSignal.timeout(5000)) {
    let response;
    try { response = await fetch(`${address}/__protolab/${path}`, { method: body ? 'POST' : 'GET', signal, redirect: 'error', headers: { ...(path !== 'config' && config ? { 'X-Protolab-Token': config.token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch (error) {
      if (signal.aborted) throw error;
      throw new Error(t('未连接到外挂，请启动外挂，检查地址并允许浏览器访问本机，然后重新连接。'));
    }
    if (!response.ok) throw new Error(t('连接被拒绝，请检查外挂允许的站点来源并重新连接。'));
    const value = await response.json();
    if (value.error) throw new Error(value.error);
    return value;
  }
  async function loadConfig() {
    const value = await request('config');
    if (typeof value.token !== 'string' || typeof value.script !== 'string' || typeof value.command !== 'string' || new URL(bridgeURL(value.url)).port !== new URL(address).port) throw new Error(t('外挂返回配置无效，请检查地址后重新连接。'));
    config = value; render();
  }
  async function poll(epoch = generation) {
    if (!connected || epoch !== generation || pollingGeneration === epoch) return;
    pollingGeneration = epoch;
    const pollController = new AbortController(); controller = pollController;
    const timeout = setTimeout(() => pollController.abort(), 5000);
    try {
      const { command } = await request('poll', { sessionId, metadata: getMetadata() }, pollController.signal);
      if (!connected || epoch !== generation) return;
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
      if (connected && epoch === generation) { status = '连接中断，请重新连接并读取工程'; render(); }
    } finally {
      clearTimeout(timeout);
      if (epoch === generation) {
        controller = null; pollingGeneration = null;
        if (connected) timer = setTimeout(() => poll(epoch), status === '连接中断，请重新连接并读取工程' ? 2000 : 750);
      }
    }
  }
  async function disconnect() {
    connected = false; generation++; clearTimeout(timer); controller?.abort();
    status = '尚未连接'; render();
    try { await request('disconnect', { sessionId }); } catch { /* 服务停止时会自动过期。 */ }
  }
  $('mcpClient').addEventListener('change', render);
  $('mcpBridgeURL').addEventListener('input', () => { config = null; status = '尚未连接'; render(); });
  $('mcpConnectBtn').addEventListener('click', async () => {
    if (connecting) return;
    connecting = true; render();
    try {
      if (connected) { await disconnect(); return; }
      address = bridgeURL(local ? location.origin : $('mcpBridgeURL').value);
      config = null; await loadConfig(); connected = true; generation++; status = '正在连接…'; render(); await poll();
    }
    catch (error) { status = error.message; render(); }
    finally { connecting = false; render(); }
  });
  $('mcpCopyBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText($('mcpConfig').value); notify(t('MCP 配置已复制')); }
    catch { $('mcpConfig').focus(); $('mcpConfig').select(); notify(t('请复制已选中的配置文本')); }
  });
  $('mcpSettingsBtn').addEventListener('click', async () => {
    $('mcpDialog').showModal(); render();
    if (local && !config) { try { await loadConfig(); } catch (error) { status = error.message; render(); } }
  });
  window.addEventListener('pagehide', () => {
    connected = false; generation++; clearTimeout(timer); controller?.abort();
    if (config) navigator.sendBeacon(`${address}/__protolab/disconnect`, JSON.stringify({ sessionId, token: config.token }));
  });
  return { refreshLocale: render };
}
