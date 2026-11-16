const BV=/^BV1[1-9A-HJ-NP-Za-km-z]{9}$/;
const SESSION=/^[\w:.-]{1,200}$/;
const PRIVATE=/(?:auth[_-]?token|ct0|cookie|authorization|api[_-]?key|access[_-]?token|password|secret)\s*["']?\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----/i;
const DEFAULT_TTL=15*60*1000;

function text(value,max){
  if(typeof value!=='string')return '';
  const cleaned=value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
  return PRIVATE.test(cleaned)?'[内容含敏感信息，已隐藏]':cleaned;
}

/** Ephemeral candidates only; never issues read receipts or prompts. */
export class BilibiliCandidates{
  constructor({getMain,discover,now=Date.now,ttlMs=DEFAULT_TTL}={}){
    if(typeof getMain!=='function'||typeof discover!=='function'||typeof now!=='function'||!Number.isSafeInteger(ttlMs)||ttlMs<1||ttlMs>DEFAULT_TTL)throw Error('候选来源或有效期无效');
    Object.assign(this,{getMain,discover,now,ttlMs});this.cache=null;this.epoch=0;this.busy=false;
  }
  main(){const main=this.getMain();if(typeof main!=='string'||!SESSION.test(main))throw Error('请先绑定 My Fish 主会话');return main;}
  invalidate(){this.epoch++;this.cache=null;}
  snapshot(){
    const main=this.getMain(),now=this.now(),cache=this.cache;
    if(!SESSION.test(typeof main==='string'?main:'')||!cache||cache.main!==main||!Number.isSafeInteger(now)||now<cache.fetchedAt||now-cache.fetchedAt>=this.ttlMs)return {ok:true,items:[],state:'empty',note:'暂无有效候选，可手动发现公开热门；候选不代表已阅读或观看。'};
    return {ok:true,items:cache.items.map(item=>({...item})),state:'available',fetchedAt:cache.fetchedAt,expiresAt:cache.fetchedAt+this.ttlMs,source:'public-popular',personalized:false,note:'B站公开热门候选，不是账号推荐，也不代表已阅读或观看。'};
  }
  async refresh(signal){
    const main=this.main();if(signal?.aborted)throw Error('发现已取消');if(this.busy)throw Error('正在发现候选，请稍后再试');
    const epoch=this.epoch;this.busy=true;
    try{
      const result=await this.discover({platform:'bilibili',count:5},signal);
      if(signal?.aborted)throw Error('发现已取消');
      if(epoch!==this.epoch||this.getMain()!==main)throw Error('主会话或工作区已变化，候选未保存');
      if(!result||result.ok!==true||result.platform!=='bilibili'||result.source!=='public-popular'||result.candidatesOnly!==true||result.personalized!==false||!Array.isArray(result.items)||result.items.length>5)throw Error('公开候选返回格式无效');
      const seen=new Set(),items=[];
      for(const item of result.items){
        if(!item||typeof item!=='object'||typeof item.bvid!=='string'||!BV.test(item.bvid)||seen.has(item.bvid))continue;
        const title=text(item.title,300);if(!title)continue;
        seen.add(item.bvid);items.push({bvid:item.bvid,url:'https://www.bilibili.com/video/'+item.bvid+'/',title,author:text(item.author,100),snippet:text(item.snippet,600),publishedAt:Number.isSafeInteger(item.publishedAt)&&item.publishedAt>=0?item.publishedAt:null});
      }
      if(result.items.length&&!items.length)throw Error('公开候选没有可核验的视频标识');
      const fetchedAt=this.now();if(!Number.isSafeInteger(fetchedAt)||fetchedAt<0||fetchedAt>8640000000000000-this.ttlMs)throw Error('候选时间无效');
      this.cache={main,items,fetchedAt};return this.snapshot();
    }finally{this.busy=false;}
  }
  select(bvid){
    this.main();if(typeof bvid!=='string'||!BV.test(bvid))throw Error('请选择有效的 B站候选');
    const snapshot=this.snapshot(),candidate=snapshot.items.find(item=>item.bvid===bvid);
    if(!candidate)throw Error('候选已失效或不属于当前主会话，请重新发现');
    return {ok:true,reference:candidate.bvid,note:'仅选择了候选；是否读取以主会话实际结果为准。'};
  }
}
