// Pure normalization of observed page DTOs. No browser, network, Cookie, or API access.
const HANDLE=/^[A-Za-z0-9_]{1,15}$/;
const RESERVED=new Set(['i','home','search','explore','notifications','messages','settings','compose','intent','hashtag','tos','privacy','login','logout']);
const POST_PATH=/^\/([A-Za-z0-9_]{1,15})\/status\/([1-9][0-9]{4,24})\/?$/;

function handle(value){
  if(typeof value!=='string')return null;
  const text=value.trim().replace(/^@/,'');
  return HANDLE.test(text)&&!RESERVED.has(text.toLowerCase())?text:null;
}

function xURL(value){
  if(typeof value!=='string')return null;
  const text=value.trim();
  if(!text||/[\\\u0000-\u0020]/.test(text)||text.startsWith('//'))return null;
  if(!text.startsWith('/')&&!/^https:\/\/x\.com\//i.test(text))return null;
  // Reject dot-segment/encoded path ambiguity before URL's normalization.
  const rawPath=text.replace(/^https:\/\/x\.com/i,'').split(/[?#]/,1)[0];
  if(rawPath.split('/').some(segment=>segment==='.'||segment==='..'||/%(?:2e|2f|5c)/i.test(segment)))return null;
  try{
    const url=new URL(text,'https://x.com');
    if(url.origin!=='https://x.com'||url.username||url.password)return null;
    return url;
  }catch{return null;}
}

export function canonicalPost(value){
  const url=xURL(value);
  if(!url)return null;
  const match=POST_PATH.exec(url.pathname);
  if(!match||!handle(match[1]))return null;
  return {id:match[2],author:match[1],url:`https://x.com/${match[1]}/status/${match[2]}`};
}

export function normalizedCount(value){
  if(typeof value==='number')return Number.isSafeInteger(value)&&value>=0?value:null;
  if(typeof value!=='string')return null;
  let text=value.trim();
  if(/^\d{1,3}(?:,\d{3})+(?:\s*(?:likes?|喜欢(?:次数)?))?$/i.test(text))text=text.replaceAll(',','');
  const match=/^(\d+(?:\.\d+)?)\s*(K|M|B|万|亿)?(?:\s*(?:likes?|喜欢(?:次数)?))?$/i.exec(text);
  if(!match||(!match[2]&&match[1].includes('.')))return null;
  const multiplier=match[2]?{k:1000,m:1000000,b:1000000000,'万':10000,'亿':100000000}[match[2].toLowerCase()]:1;
  const count=Math.round(Number(match[1])*multiplier);
  return Number.isSafeInteger(count)&&count>=0?count:null;
}

function publicLink(value){
  if(typeof value!=='string'||/[\\\u0000-\u0020]/.test(value.trim()))return null;
  try{
    const url=new URL(value.trim());
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)return null;
    const host=url.hostname.toLowerCase();
    if(host==='localhost'||host.endsWith('.localhost')||host==='0.0.0.0'||host==='[::]'||host==='[::1]'||/^127\.|^10\.|^192\.168\.|^169\.254\./.test(host)||/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)||/^\[(?:fc|fd|fe80|::ffff:)/.test(host))return null;
    return url.href;
  }catch{return null;}
}

export function normalizePost(dto){
  if(!dto||typeof dto!=='object'||Array.isArray(dto))return null;
  const post=canonicalPost(dto.permalink);
  if(!post||typeof dto.text!=='string')return null;
  const text=dto.text.trim();
  if(!text||/^[\s\u200B-\u200D\uFEFF]*$/.test(text)||text.length>20000||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text))return null;
  if(dto.author!==undefined&&dto.author!==null){
    const claimed=handle(dto.author);
    if(!claimed||claimed.toLowerCase()!==post.author.toLowerCase())return null;
  }
  let createdAt='';
  const parts=typeof dto.datetime==='string'?/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.exec(dto.datetime):null;
  if(parts&&Number(parts[2])>=1&&Number(parts[2])<=12&&Number(parts[3])>=1&&Number(parts[3])<=new Date(Date.UTC(Number(parts[1]),Number(parts[2]),0)).getUTCDate()&&Number(parts[4])<24&&Number(parts[5])<60&&Number(parts[6])<60){
    const date=new Date(dto.datetime);
    if(Number.isFinite(date.getTime()))createdAt=date.toISOString();
  }
  const links=[];
  if(Array.isArray(dto.links))for(const value of dto.links.slice(0,100)){
    const url=publicLink(value);
    if(url&&url!==post.url&&!links.includes(url))links.push(url);
    if(links.length>=20)break;
  }
  return {id:post.id,text,author:post.author,url:post.url,createdAt,links,likes:normalizedCount(dto.likes)};
}

export function normalizePosts(rows,{limit=10}={}){
  if(!Array.isArray(rows))return [];
  limit=Number.isFinite(limit)?Math.max(0,Math.min(20,Math.trunc(limit))):10;
  if(!limit)return [];
  const result=[],seen=new Set();
  for(const dto of rows.slice(0,200)){
    const post=normalizePost(dto);
    if(!post||seen.has(post.id))continue;
    seen.add(post.id);result.push(post);
    if(result.length>=limit)break;
  }
  return result;
}

export function currentAccountUsername({accountSwitcherText,profileHref}={}){
  // Callers must supply only the account-switcher and the user's own nav link.
  // A tweet's author or an @mention in post text is never identity evidence.
  let profile=null;
  if(profileHref!==undefined&&profileHref!==null&&profileHref!==''){
    const url=xURL(profileHref);
    const match=url?.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    profile=match?handle(match[1]):null;
    if(!profile)return null;
  }
  const handles=typeof accountSwitcherText==='string'?[...accountSwitcherText.matchAll(/(?:^|\s)@([A-Za-z0-9_]{1,15})(?=$|[\s)\]·])/g)].map(match=>handle(match[1])).filter(Boolean):[];
  const unique=[...new Map(handles.map(name=>[name.toLowerCase(),name])).values()];
  if(unique.length>1)return null;
  const account=unique[0]??null;
  if(profile&&account&&profile.toLowerCase()!==account.toLowerCase())return null;
  return profile??account;
}
