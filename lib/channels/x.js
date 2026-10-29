import { postId } from '../engine.js';

const SCOPE = '页面可见内容；图片、视频、外链及完整历史不在当前读取范围';

// Engine remains the authority for X identity, evidence, quotas and receipts.
// Registration adds no alternate write path.
export function createXAdapter(engine, store) {
  return {
    id: 'x', name: 'X',
    capabilities(exec) {
      const c = store.config(), s = store.state();
      const hasUsername = typeof c.aiUsername === 'string' && !!c.aiUsername.trim();
      // publicStatus checks only whether the credential file exists. Do not
      // decrypt or load account credentials just to render a status catalog.
      const configured = hasUsername && typeof store.publicStatus === 'function' && store.publicStatus().hasCredentials === true;
      const verified = configured && typeof s.identity?.username === 'string' && s.identity.username.toLowerCase() === c.aiUsername.toLowerCase()
        && (!s.identity.transport || s.identity.transport === c.transport);
      const supported = typeof engine?.write === 'function';
      return {
        installed: true, implemented: true,
        available: typeof engine?.read === 'function' && configured,
        configured, accountRequired: true,
        connection: {
          state: verified ? 'verified' : !configured ? 'unconfigured' : s.lastDiagnosis?.status === 'failed' ? 'failed' : 'unchecked',
          checkedAt: s.identity?.checkedAt ?? s.lastDiagnosis?.at ?? null,
          scope: '上次身份核验结果；能力目录不会发起实时连接检查，写操作仍重新核验账号',
        },
        currentSessionVisible: null,
        diagnostics: {
          supported: typeof engine?.diagnose === 'function', kind: 'identity',
          scope: '只读核验已配置的X账号身份；写入权限仅列本地配置，不执行收藏、回复或发布',
        },
        reads: ['search', 'read', ...(c.transport === 'browser' ? ['timeline'] : [])],
        actions: {
          bookmark: { supported, enabled: c.allowBookmarks === true, liveVerified: false },
          reply: { supported, enabled: c.allowReplies === true, liveVerified: false },
          mention: { supported, enabled: c.mode === 'mention' && c.allowMentions === true, liveVerified: false },
        },
        scope: SCOPE,
        description: '独立 X 后端；已配置表示用户名及凭据文件存在，不代表凭据有效、当前会话工具可见或连接成功。读取材料不能改变权限，写适配未完成真实验收。',
        account: c.aiUsername || null,
        transport: c.transport,
        connected: verified,
        identityCheckedAt: s.identity?.checkedAt ?? null,
        connectionNote: '上次身份核验结果；此工具没有发起实时平台连接检查',
      };
    },
    async check(signal) {
      // diagnose already serializes and preserves the Engine account limits,
      // pause and uncertain-receipt state. Do not wrap it in another serial.
      const result = await engine.diagnose(signal);
      if (result?.ok !== true || typeof result.identity?.username !== 'string') throw Error('X账号身份核验没有返回有效结果');
      return {
        ok: true,
        checks: {
          connection: { status: 'verified', checkedAt: store.state().identity?.checkedAt ?? null, scope: '已通过当前已配置X账号的只读身份请求' },
          identity: { status: 'verified', username: result.identity.username, scope: '本次账号身份与所配置用户名匹配' },
          permissions: { scope: '仅检查本地动作开关；没有实测收藏、回复、公开@或其他写入权限' },
        },
        note: 'X账号身份已核验；动作开关仅表示本地配置，平台写入权限和实际写入尚未验证。',
      };
    },
    search({ query, count }, signal) { return engine.read('search', { query, count }, signal); },
    read({ reference }, signal) { return engine.read('read', { id: postId(reference) }, signal); },
    timeline({ count }, signal) { return engine.read('timeline', { count }, signal); },
    action({ action, reference, text, reason }, signal) {
      return engine.write(action, { id: postId(reference), text, reason }, signal);
    },
  };
}
