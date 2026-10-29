import { ChannelRegistry } from './channels/registry.js';
import { createXAdapter } from './channels/x.js';

function normalize(result, capability) {
  const value = result && typeof result === 'object' && !Array.isArray(result) ? result : { data: result };
  const scope = typeof value.scope === 'string' ? value.scope : capability.scope;
  const source = Array.isArray(value.items) ? value.items : Array.isArray(value.data) ? value.data : value.data == null ? [] : [value.data];
  const items = source.map(item => item && typeof item === 'object'
    ? { ...item, platform: capability.id, scope: typeof item.scope === 'string' ? item.scope : scope }
    : { platform: capability.id, scope, text: String(item ?? '') });
  return { ...value, platform: capability.id, scope, items };
}

function receiptSummary(receipt, platform, operation) {
  if (!receipt || receipt.platform !== platform || receipt.operation !== operation || typeof receipt.id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(receipt.id)
    || typeof receipt.url !== 'string' || typeof receipt.title !== 'string' || typeof receipt.scope !== 'string'
    || !Number.isSafeInteger(receipt.readAt) || receipt.readAt < 0 || receipt.readAt > 8640000000000000) throw Error('读取记录返回格式无效');
  if (/(?:auth_token|ct0|cookie|authorization|api[_-]?key|access_token|refresh_token|password)\s*[:=]\s*\S+/i.test(receipt.title + ' ' + receipt.scope)) throw Error('读取记录包含敏感字段');
  const url = new URL(receipt.url);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error('读取记录链接无效');
  return { id: receipt.id, platform, operation, url: url.href, title: receipt.title.slice(0,300), scope: receipt.scope.slice(0,1200), readAt: receipt.readAt };
}

// A settings check reports only the declared read-only evidence. Provider
// payloads, credentials and configuration are never passed through this API.
function normalizeCheck(result, channel) {
  if (result?.ok !== true) throw Error('渠道检查没有返回可确认的成功结果');
  const text = value => typeof value === 'string' ? value : '';
  const source = result.checks ?? {}, identity = source.identity ?? {}, link = source.connection ?? {};
  const status = ['verified', 'not-applicable', 'not-tested'].includes(identity.status) ? identity.status : 'not-tested';
  return {
    ok: true, platform: channel.id, channel,
    checks: {
      connection: {
        status: link.status === 'verified' ? 'verified' : 'not-tested',
        checkedAt: Number.isFinite(link.checkedAt) ? link.checkedAt : null,
        scope: text(link.scope),
      },
      identity: {
        status, scope: text(identity.scope),
        ...(status === 'verified' && typeof identity.username === 'string' ? { username: identity.username } : {}),
      },
      permissions: {
        status: 'configuration-only', liveWritesChecked: false,
        actions: channel.actions, scope: text(source.permissions?.scope),
      },
    },
    note: text(result.note),
  };
}

// Providers own their platform's login, evidence and receipts. The registry is
// only a dispatch boundary; a shared method name never grants an ability.
export class Social {
  constructor(engine, store, { adapters = [], catalog = [], onRead } = {}) {
    if (onRead !== undefined && typeof onRead !== 'function') throw Error('读取记录回调必须是函数');
    this.engine = engine;
    this.store = store;
    this.onRead = onRead;
    this.registry = new ChannelRegistry({ catalog });
    this.checking = new Set();
    this.register(createXAdapter(engine, store));
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter) { return this.registry.register(adapter); }

  capabilities(exec) {
    return { platforms: this.registry.list(exec), browser: {
      builtin: 'X 专用独立浏览器', hostSkill: 'browser-skill', connectionVerified: false,
      note: '通用网页可复用另行安装的 DSH BrowserSkill；先按技能说明检查连接。注册渠道不代表当前会话可见或已经实测成功。',
    } };
  }

  provider(platform, exec) {
    const adapter = this.registry.get(platform);
    if (!adapter) throw Error('此平台尚未接入：' + String(platform) + '；请先查看 social_status');
    return { adapter, capability: this.registry.capabilities(platform, exec) };
  }

  // Trusted settings entry point only. It deliberately bypasses the initial
  // verified/configured gate; the provider owns runtime and account checks.
  async check({ platform }, signal, exec) {
    const { adapter, capability } = this.provider(platform, exec);
    if (!capability.installed || !capability.implemented || !capability.diagnostics.supported) throw Error('此平台尚未支持连接检查');
    signal?.throwIfAborted();
    if (this.checking.has(platform)) throw Error('此平台连接检查正在运行，请稍后再试');
    this.checking.add(platform);
    try {
      const result = await adapter.check(signal, exec);
      signal?.throwIfAborted();
      return normalizeCheck(result, this.registry.capabilities(platform, exec));
    } finally { this.checking.delete(platform); }
  }

  dispatch(method, { platform, ...args }, signal, exec) {
    const { adapter, capability } = this.provider(platform, exec);
    if (!capability.implemented || typeof adapter[method] !== 'function') throw Error('此平台尚未支持此操作：' + method);
    if (exec != null && capability.currentSessionVisible === false) throw Error('当前会话不可见此平台能力');
    if (method === 'action') {
      const action = Object.hasOwn(capability.actions, args.action) ? capability.actions[args.action] : null;
      if (!action?.supported) throw Error('此平台操作尚未支持：' + String(args.action));
      if (!action.enabled) throw Error('此操作开关尚未开启：' + String(args.action));
      if (!capability.available || (capability.accountRequired && !capability.configured) || capability.connection.state !== 'verified') {
        throw Error('此平台尚未就绪；请先配置账号并核验连接');
      }
    } else {
      if (!capability.reads.includes(method)) throw Error('此平台尚未支持此读取操作：' + method);
      const status = capability.readAvailability?.[method];
      if (!capability.available || status === false || status?.available === false) throw Error('此平台读取能力当前不可用：' + method);
      if (exec != null && status?.currentSessionVisible === false) throw Error('当前会话不可见此平台读取能力：' + method);
    }
    signal?.throwIfAborted();
    return Promise.resolve(adapter[method](args, signal, exec)).then(async result => {
      const normalized = normalize(result, capability);
      signal?.throwIfAborted();
      if (this.onRead) {
        delete normalized.companionReceipts;
        delete normalized.companionReceiptError;
      }
      if (!this.onRead || method === 'action' || normalized.ok === false || normalized.unsupported === true || !normalized.items.length) return normalized;
      try {
        const receipts = await this.onRead({ platform, operation: method, args, result: normalized, exec, signal });
        signal?.throwIfAborted();
        if (receipts == null) return normalized;
        if (!Array.isArray(receipts)) throw Error('读取记录回调返回格式无效');
        const summaries = receipts.slice(0,5).map(receipt => receiptSummary(receipt, platform, method));
        return summaries.length ? { ...normalized, companionReceipts: summaries } : normalized;
      } catch {
        signal?.throwIfAborted();
        // The platform read succeeded. A local storage failure must not invite
        // an automatic duplicate platform request or expose storage details.
        return { ...normalized, companionReceiptError: '本次读取成功，但陪伴读取记录未能保存；请勿把它当作已保存经历。' };
      }
    });
  }

  search(args, signal, exec) { return this.dispatch('search', args, signal, exec); }
  read(args, signal, exec) { return this.dispatch('read', args, signal, exec); }
  timeline(args, signal, exec) { return this.dispatch('timeline', args, signal, exec); }
  comments(args, signal, exec) { return this.dispatch('comments', args, signal, exec); }
  action(args, signal, exec) { return this.dispatch('action', args, signal, exec); }
}
