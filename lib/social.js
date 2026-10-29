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

// Providers own their platform's login, evidence and receipts. The registry is
// only a dispatch boundary; a shared method name never grants an ability.
export class Social {
  constructor(engine, store, { adapters = [], catalog = [] } = {}) {
    this.engine = engine;
    this.store = store;
    this.registry = new ChannelRegistry({ catalog });
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
    return Promise.resolve(adapter[method](args, signal, exec)).then(result => normalize(result, capability));
  }

  search(args, signal, exec) { return this.dispatch('search', args, signal, exec); }
  read(args, signal, exec) { return this.dispatch('read', args, signal, exec); }
  timeline(args, signal, exec) { return this.dispatch('timeline', args, signal, exec); }
  comments(args, signal, exec) { return this.dispatch('comments', args, signal, exec); }
  action(args, signal, exec) { return this.dispatch('action', args, signal, exec); }
}
