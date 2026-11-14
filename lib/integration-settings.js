import {createHash} from 'node:crypto';
import {atomic,readJSON} from './store.js';
import {validateRssFeeds,publicRssUrl} from './channels/rss.js';

const DEFAULT={version:1,rssEnabled:false,videoEnabled:false,rssFeeds:[]};
function checked(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['version','rssEnabled','videoEnabled','rssFeeds'].includes(k))||value.version!==1||typeof value.rssEnabled!=='boolean'||typeof value.videoEnabled!=='boolean')throw Error('陪伴能力配置格式无效');
  return {...value,rssFeeds:validateRssFeeds(value.rssFeeds)};
}
export class IntegrationSettings{
  constructor(store){this.store=store;}
  file(){return this.store.file('assistant/integrations.json');}
  settings(){return checked(readJSON(this.file(),DEFAULT));}
  feeds(){const s=this.settings();return s.rssEnabled?s.rssFeeds:[];}
  snapshot(){const s=this.settings();return {rssEnabled:s.rssEnabled,videoEnabled:s.videoEnabled,rssFeedLines:s.rssFeeds.map(f=>f.name+' | '+f.url).join('\n'),feedCount:s.rssFeeds.length};}
  save(input){
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['rssEnabled','videoEnabled','rssFeedLines'].includes(k)))throw Error('陪伴能力只接受已列出的配置字段');
    const next=this.settings();
    for(const key of ['rssEnabled','videoEnabled'])if(Object.hasOwn(input,key)){if(typeof input[key]!=='boolean')throw Error('能力选项必须是开关');next[key]=input[key];}
    if(Object.hasOwn(input,'rssFeedLines')){
      if(typeof input.rssFeedLines!=='string'||input.rssFeedLines.length>30000)throw Error('RSS来源每行填写一个公开网址，可在前面加名称和竖线');
      const rows=input.rssFeedLines.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),seen=new Set();
      next.rssFeeds=validateRssFeeds(rows.map(line=>{const i=line.indexOf('|'),url=publicRssUrl(i<0?line:line.slice(i+1).trim()),name=i<0?new URL(url).hostname:line.slice(0,i).trim();if(seen.has(url))throw Error('RSS来源重复');seen.add(url);return {id:'rss-'+createHash('sha256').update(url).digest('hex').slice(0,20),name,url};}));
    }
    atomic(this.file(),checked(next));return this.snapshot();
  }
}
