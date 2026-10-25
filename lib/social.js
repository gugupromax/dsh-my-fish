import { postId } from './engine.js';

// Adapters own their platform's login, evidence and receipts. A shared name never
// implies that an unimplemented platform or action is available.
export class Social {
  constructor(engine, store) { this.engine=engine; this.store=store; }
  capabilities() {
    const c=this.store.config(),s=this.store.state();
    return {platforms:[{id:'x',name:'X',account:c.aiUsername||null,
      connected:!!(s.identity&&s.identity.username?.toLowerCase()===c.aiUsername.toLowerCase()),
      identityCheckedAt:s.identity?.checkedAt??null,connectionNote:'上次身份核验结果；此工具没有发起实时平台连接检查',
      transport:c.transport,reads:['search','read',...(c.transport==='browser'?['timeline']:[])],
      actions:{bookmark:{enabled:c.allowBookmarks,liveVerified:false},reply:{enabled:c.allowReplies,liveVerified:false},mention:{enabled:c.mode==='mention'&&c.allowMentions,liveVerified:false}},
      scope:'页面可见内容；图片、视频、外链及完整历史不在当前读取范围'}],
      browser:{builtin:'X 专用独立浏览器',hostSkill:'browser-skill',connectionVerified:false,
        note:'通用网页可复用另行安装的 DSH BrowserSkill；先加载技能，再按技能说明检查连接。未检查不代表已连接，也未接入其他社交平台适配器'}};
  }
  requirePlatform(platform) { if(platform!=='x')throw Error('此平台尚未接入；当前只支持 x，请先查看 social_status'); }
  search({platform,query,count},signal) { this.requirePlatform(platform);return this.engine.read('search',{query,count},signal); }
  read({platform,reference},signal) { this.requirePlatform(platform);return this.engine.read('read',{id:postId(reference)},signal); }
  action({platform,action,reference,text,reason},signal) {
    this.requirePlatform(platform);
    if(!['bookmark','reply','mention'].includes(action))throw Error('此平台操作尚未支持');
    return this.engine.write(action,{id:postId(reference),text,reason},signal);
  }
}
