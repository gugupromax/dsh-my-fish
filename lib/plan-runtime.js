/** Dedicated composition for scheduled reads; it never changes the host default. */
export const PLAN_PRESET_ID = 'dsh-my-fish-plan-native';
export const HIDDEN_PLAN_GLOBAL_TOOLS=Object.freeze(['assistant_context','assistant_memory','assistant_goal','assistant_companion','assistant_plan','assistant_wake','assistant_finish','social_action','x_whale_bookmark','x_whale_reply','x_whale_share','x_whale_diary','task_board_list','task_board_get','task_board_create','task_board_update','task_board_archive','task_board_run','ask_user_question','decompress','pwsh','bash','write','edit','subagent','send_message','bsk_interact','bsk_assist']);

export default {
  name:'my-fish-plan-read-surface',inject:['tools'],
  apply(ctx){
    // restrict() validates names against global registrations. A deny mask
    // leaves preset-local read/web registrations intact, unlike a global allow
    // list that the host may apply across their composition scope chain.
    ctx.tools.restrict({deny:HIDDEN_PLAN_GLOBAL_TOOLS.filter(name=>ctx.tools.get(name)!==undefined)});
  },
};

export function planPresetDefinition() {
  return {
    id: PLAN_PRESET_ID,
    name: 'My Fish 只读计划',
    description: '原生工具展示的独立只读计划，不继承个人角色、命令或委派配置。',
    plugins: [
      { id: 'native-presentation', name: '@deepseek-ai/dsh-agent-tool-presentation', config: { mode: 'native' } },
      { id: 'time-context', name: '@deepseek-ai/dsh-time-context' },
      { id: 'read-files', name: '@deepseek-ai/dsh-tool-fs', config: { read: true, readImage: true, write: false, edit: false } },
      { id: 'read-web', name: '@deepseek-ai/dsh-tool-web', config: { search: true, fetch: true, searchTimeoutMs: 60000 } },
      { id: 'read-surface', name: new URL('./plan-runtime.js',import.meta.url).href },
    ],
  };
}

/**
 * Own one preset registration, including service unload during async mounting.
 * Registration and readiness are separate: resolving while the host is still
 * activating can wait on its Loader, so callers check readiness before use.
 */
export function registerPlanPreset(registry) {
  if (typeof registry?.register !== 'function' || typeof registry?.resolve !== 'function') throw Error('宿主原生计划预设服务不可用，尚未保存或修复计划。');
  let disposed = false, unregister = null, disposal = null;
  const ready = Promise.resolve().then(async () => {
    const release = await registry.register(planPresetDefinition());
    if (typeof release !== 'function') throw Error('宿主未确认 My Fish 原生计划预设的注册。');
    unregister = release;
  });
  // Optional services can fail before any caller asks for a plan. Keep the
  // failure observable through ready/ensureReady without an unhandled rejection.
  void ready.catch(() => {});
  return {
    id: PLAN_PRESET_ID,
    ready,
    async ensureReady() {
      if (disposed) throw Error('My Fish 原生计划预设已卸载，请等待服务重新连接。');
      await ready;
      if (disposed) throw Error('My Fish 原生计划预设已卸载，请等待服务重新连接。');
      const resolved = await registry.resolve(PLAN_PRESET_ID);
      if (disposed) throw Error('My Fish 原生计划预设已卸载，请等待服务重新连接。');
      if (resolved?.id !== PLAN_PRESET_ID || resolved.broken !== undefined) throw Error('My Fish 原生只读计划预设未就绪，请检查宿主预设服务；未改用脚本执行。');
      return PLAN_PRESET_ID;
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      disposal = (async () => {
        try { await ready; } catch { return; }
        const release = unregister;
        unregister = null;
        if (release) await release();
      })();
      return disposal;
    },
  };
}
