const IDENTIFIER = /^[a-z][a-z0-9_-]{0,63}$/;
const READS = ['search', 'read', 'timeline', 'comments'];
const CONNECTION_STATES = new Set(['verified', 'unchecked', 'failed', 'unavailable', 'unconfigured']);
const string = (value, fallback = '') => typeof value === 'string' ? value : fallback;

function identifier(value) {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw Error('渠道 ID 需要小写字母、数字、下划线或连字符');
  return value;
}

function connection(value, fallback = 'unchecked') {
  return {
    state: CONNECTION_STATES.has(value?.state) ? value.state : fallback,
    checkedAt: typeof value?.checkedAt === 'number' && Number.isFinite(value.checkedAt) ? value.checkedAt : null,
    scope: string(value?.scope),
  };
}

// Project nested fields too: a provider's config is never public catalog data.
function describe(record, adapter, exec) {
  const installed = !!adapter;
  const raw = installed ? adapter.capabilities(exec) : record;
  if (raw && typeof raw.then === 'function') throw Error('渠道能力声明必须同步返回');
  const value = raw && typeof raw === 'object' ? raw : {};
  const implemented = installed && value.implemented !== false;
  const available = implemented && value.available === true;
  const reads = implemented && Array.isArray(value.reads)
    ? [...new Set(value.reads.filter(name => READS.includes(name) && typeof adapter[name] === 'function'))] : [];
  const actions = Object.fromEntries(Object.entries(value.actions ?? {}).filter(([name]) => IDENTIFIER.test(name)).map(([name, action]) => {
    const supported = implemented && typeof adapter?.action === 'function' && action?.supported === true;
    return [name, { supported, enabled: supported && action?.enabled === true, liveVerified: supported && action?.liveVerified === true }];
  }));
  const result = {
    id: record.id,
    name: string(adapter?.name, string(value.name, record.id)),
    installed, implemented, available,
    configured: installed && value.configured === true,
    accountRequired: value.accountRequired === true,
    connection: installed ? connection(value.connection) : connection(null, 'unavailable'),
    currentSessionVisible: !installed || exec == null ? null : typeof value.currentSessionVisible === 'boolean' ? value.currentSessionVisible : null,
    diagnostics: {
      supported: implemented && typeof adapter?.check === 'function' && value.diagnostics?.supported === true,
      kind: string(value.diagnostics?.kind),
      scope: string(value.diagnostics?.scope),
    },
    reads, actions,
    scope: string(value.scope),
    description: string(value.description),
  };
  // Explicit compatibility fields from the original X status API.
  if (record.id === 'x' && installed) {
    result.account = typeof value.account === 'string' ? value.account : null;
    result.transport = string(value.transport);
    result.connected = value.connected === true;
    result.identityCheckedAt = typeof value.identityCheckedAt === 'number' && Number.isFinite(value.identityCheckedAt) ? value.identityCheckedAt : null;
    result.connectionNote = string(value.connectionNote);
  }
  if (value.readAvailability && typeof value.readAvailability === 'object') {
    result.readAvailability = Object.fromEntries(reads.filter(name => Object.hasOwn(value.readAvailability, name)).map(name => {
      const status = value.readAvailability[name];
      if (typeof status === 'boolean') return [name, status];
      const projected = {};
      if (typeof status?.available === 'boolean') projected.available = status.available;
      projected.currentSessionVisible = exec == null ? null : typeof status?.currentSessionVisible === 'boolean' ? status.currentSessionVisible : null;
      if (typeof status?.reason === 'string') projected.reason = status.reason;
      if (status?.connection) projected.connection = connection(status.connection);
      return [name, projected];
    }));
  }
  return result;
}

export class ChannelRegistry {
  constructor({ catalog = [] } = {}) {
    if (!Array.isArray(catalog)) throw Error('渠道目录必须是数组');
    this.adapters = new Map();
    this.catalog = new Map();
    for (const entry of catalog) {
      const id = identifier(entry?.id);
      if (this.catalog.has(id)) throw Error('渠道目录 ID 重复：' + id);
      this.catalog.set(id, { ...entry, id });
    }
  }

  register(adapter) {
    const id = identifier(adapter?.id);
    if (typeof adapter?.capabilities !== 'function') throw Error('渠道适配器需要同步 capabilities 方法');
    if (this.adapters.has(id)) throw Error('渠道适配器已经注册：' + id);
    const registration = { adapter };
    this.adapters.set(id, registration);
    return () => {
      if (this.adapters.get(id) === registration) this.adapters.delete(id);
    };
  }

  get(id) { return this.adapters.get(id)?.adapter; }

  capabilities(id, exec) {
    const adapter = this.get(id), record = this.catalog.get(id) ?? { id };
    return adapter || this.catalog.has(id) ? describe(record, adapter, exec) : null;
  }

  list(exec) {
    const ids = new Set([...this.adapters.keys(), ...this.catalog.keys()]);
    return [...ids].map(id => this.capabilities(id, exec));
  }
}
