import fs from 'node:fs';
import path from 'node:path';
import { currentAccountUsername, normalizePost, normalizePosts, canonicalPost } from './browser-data.js';

const ALLOWED=new Set(['identity','search','read','timeline','bookmark','reply','mention']);
const MUTATIONS=new Set(['CreateTweet','CreateNoteTweet','DeleteTweet','CreateBookmark','DeleteBookmark','FavoriteTweet','UnfavoriteTweet','CreateRetweet','DeleteRetweet']);
const READ_POSTS=new Set(['HomeTimeline','HomeLatestTimeline']);
export function browserError(code,message){return Object.assign(Error(message),{code,kind:'BrowserBackend'});}
const content=value=>String(value??'').replace(/\r\n/g,'\n').normalize('NFC').trim();
export function launchOptions(config){
  const options={headless:config.browserHeadless===true,chromiumSandbox:true,timeout:30000};
  if(config.browserPath){if(!path.isAbsolute(config.browserPath)||!fs.existsSync(config.browserPath))throw browserError('dependency_missing','浏览器路径不存在，请填写 Chrome 可执行文件的完整路径');options.executablePath=config.browserPath;}
  else options.channel='chrome';
  if(config.proxy)options.proxy={server:config.proxy.replace(/^socks5h:/,'socks5:')};
  return options;
}
export function cookieObjects(cookies){
  return ['auth_token','ct0'].map(name=>({name,value:cookies[name],domain:'.x.com',path:'/',secure:true,httpOnly:name==='auth_token',sameSite:'Lax'}));
}
export function authorizeMutation(name,variables,expected,gate){
  if(!expected||gate.sent||!variables||typeof variables!=='object')return false;
  if(expected.operation==='bookmark'){
    if(name!=='CreateBookmark'||String(variables.tweet_id)!==expected.id)return false;
  }else{
    if(name!=='CreateTweet'||content(variables.tweet_text)!==content(expected.text))return false;
    const parent=variables.reply?.in_reply_to_tweet_id;
    if(expected.operation==='reply'?String(parent)!==expected.replyTo:parent!=null)return false;
    if(variables.edit_tweet_id||variables.community_id||variables.media?.media_entities?.length)return false;
  }
  gate.sent=true;return true;
}
export function authorizeGraphQL(method,name,variables,expected,gate){
  if(MUTATIONS.has(name))return authorizeMutation(name,variables,expected,gate);
  return method==='GET'||(method==='POST'&&READ_POSTS.has(name));
}
export function acknowledgePost(payload,expected,username,previousIds=[]){
  const result=payload?.data?.create_tweet?.tweet_results?.result;
  const raw=result?.tweet??result,legacy=raw?.legacy;
  const user=raw?.core?.user_results?.result;
  const author=user?.legacy?.screen_name??user?.core?.screen_name;
  let text=legacy?.full_text;
  for(const entity of legacy?.entities?.urls??[])if(typeof text==='string'&&entity.url&&entity.expanded_url)text=text.replaceAll(entity.url,entity.expanded_url);
  if(payload?.errors||!raw?.rest_id||previousIds.includes(String(raw.rest_id))||String(author).toLowerCase()!==username.toLowerCase()||content(text)!==content(expected.text))return null;
  if(expected.operation==='reply'&&String(legacy?.in_reply_to_status_id_str)!==expected.replyTo)return null;
  const post=normalizePost({permalink:`https://x.com/${author}/status/${raw.rest_id}`,text,author,datetime:legacy.created_at,links:legacy.entities?.urls?.map(e=>e.expanded_url)});
  return post;
}

async function detectChallenge(page){
  if(/\/(?:account\/access|i\/flow\/(?:login|challenge))/.test(new URL(page.url()).pathname))throw browserError('auth_or_restriction','独立浏览器需要重新登录或身份验证；请在日常浏览器检查账号并更新 Cookie，不会自动处理验证');
  if(await page.locator('iframe[src*="arkoselabs"],iframe[src*="recaptcha"],iframe[src*="hcaptcha"]').count())throw browserError('auth_or_restriction','X 要求验证码或身份验证，已停止本次操作');
}
async function identityOnPage(page,expected){
  try{await page.locator('a[data-testid="AppTabBar_Profile_Link"]').waitFor({state:'visible',timeout:30000});}
  catch{await detectChallenge(page);throw browserError('auth_or_restriction','未看到本人资料导航，请检查 Cookie 登录态或完成浏览器验证');}
  await detectChallenge(page);
  const profileHref=await page.locator('a[data-testid="AppTabBar_Profile_Link"]').first().getAttribute('href');
  const switcher=page.locator('[data-testid="SideNav_AccountSwitcher_Button"]');
  const accountSwitcherText=await switcher.count()?await switcher.first().innerText():'';
  const username=currentAccountUsername({profileHref,accountSwitcherText});
  if(!username||username.toLowerCase()!==expected.toLowerCase())throw browserError('identity_mismatch','独立浏览器当前账号与 AI 用户名不一致，已拒绝操作');
  const name=accountSwitcherText.split('\n').map(v=>v.trim()).find(v=>v&&!v.startsWith('@'))||username;
  return {id:'handle:'+username.toLowerCase(),idKind:'handle',username,name};
}
async function navigate(page,url,expected){
  if(new URL(url).origin!=='https://x.com')throw browserError('request_failed','拒绝导航到 X 之外的页面');
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  if(response?.status()===429)throw browserError('rate_limit','X 返回限流，已停止');
  if(response&&response.status()>=400)throw browserError('request_failed','X 页面加载失败（HTTP '+response.status()+'）');
  return identityOnPage(page,expected);
}
// Page code only projects visible DOM. It never reads cookies, localStorage or hidden app state.
async function visibleDTOs(page){
  return page.locator('article[data-testid="tweet"]').evaluateAll(articles=>articles.map(article=>{
    const own=el=>!el.closest('div[role="link"]');
    const time=[...article.querySelectorAll('time')].find(own);
    const permalink=time?.closest('a')?.getAttribute('href');
    const textNode=[...article.querySelectorAll('[data-testid="tweetText"]')].find(own);
    const like=article.querySelector('[data-testid="like"],[data-testid="unlike"]');
    return {permalink,text:textNode?.innerText??'',datetime:time?.getAttribute('datetime')??'',likes:like?.innerText??null,
      links:[...(textNode?.querySelectorAll('a[href]')??[])].map(a=>a.getAttribute('title')?.startsWith('http')?a.getAttribute('title'):a.href),
      truncated:!!article.querySelector('[data-testid="tweet-text-show-more-link"]')};
  }));
}
async function waitPosts(page){
  try{await page.waitForFunction(()=>document.querySelector('article[data-testid="tweet"]')||/No results for|No results found|没有找到|未找到/.test(document.querySelector('main')?.innerText??''),null,{timeout:30000});}
  catch{await detectChallenge(page);throw browserError('request_failed','X 未显示帖子或明确的空结果，本次读取停止');}
  await detectChallenge(page);
}
async function collect(page,count){
  await waitPosts(page);let rows=[];
  for(let pass=0;pass<7;pass++){
    rows.push(...await visibleDTOs(page));
    const posts=normalizePosts(rows,{limit:count});if(posts.length>=count)return posts;
    if(!await page.locator('article[data-testid="tweet"]').count())return posts;
    const before=await page.locator('article[data-testid="tweet"] time').evaluateAll(nodes=>nodes.map(n=>n.closest('a')?.getAttribute('href')).join('|'));
    await page.mouse.wheel(0,700);
    try{await page.waitForFunction(previous=>[...document.querySelectorAll('article[data-testid="tweet"] time')].map(n=>n.closest('a')?.getAttribute('href')).join('|')!==previous,before,{timeout:3500});}
    catch{return posts;}
    await detectChallenge(page);
  }
  return normalizePosts(rows,{limit:count});
}
async function targetArticle(page,id){
  const articles=page.locator('article[data-testid="tweet"]');await waitPosts(page);
  for(let n=0;n<await articles.count();n++){
    const article=articles.nth(n);
    const matches=await article.locator('a[href]').evaluateAll((links,target)=>links.some(a=>new RegExp('^/[A-Za-z0-9_]+/status/'+target+'(?:[/?#]|$)').test(a.getAttribute('href')??'')&&!!a.querySelector('time')),id);
    if(matches)return article;
  }
  throw browserError('request_failed','未能在页面中核对目标原帖，已停止操作');
}
async function readPost(page,id,expected){
  await navigate(page,`https://x.com/i/status/${id}`,expected);
  const article=await targetArticle(page,id);
  const more=article.locator('[data-testid="tweet-text-show-more-link"]');
  if(await more.count())await more.first().click({timeout:5000});
  const rows=await visibleDTOs(page);
  const found=normalizePosts(rows,{limit:20}).find(post=>post.id===id);
  if(!found)throw browserError('request_failed','页面没有可确认的目标帖正文');
  const dto=rows.find(row=>canonicalPost(row.permalink)?.id===id);
  return {article,post:{...found,readScope:'页面可见正文',truncated:!!dto?.truncated}};
}
async function writePost(page,operation,args,username,gate){
  let editor,scope;
  if(operation==='reply'){
    const {article}=await readPost(page,args.id,username);
    const reply=article.locator('[data-testid="reply"]');if(await reply.count()!==1)throw browserError('request_failed','目标原帖的回复入口不唯一，拒绝操作');
    await reply.click();scope=page.getByRole('dialog');await scope.waitFor({state:'visible',timeout:10000});
    editor=scope.locator('[data-testid="tweetTextarea_0"]');
  }else{
    await navigate(page,'https://x.com/compose/post',username);
    scope=page.getByRole('dialog');if(!await scope.count())scope=page.locator('main');
    editor=scope.locator('[data-testid="tweetTextarea_0"]');
  }
  if(await editor.count()!==1)throw browserError('request_failed','编辑框不唯一，拒绝操作');
  const original=content(await editor.innerText());if(original&&original!=='\u200B')throw browserError('request_failed','检测到未知非空草稿，不覆盖、不发送');
  await editor.fill(args.text);if(content(await editor.innerText())!==content(args.text))throw browserError('request_failed','草稿内容校验未通过，未点击发送');
  await identityOnPage(page,username);
  const send=scope.locator('[data-testid="tweetButton"],[data-testid="tweetButtonInline"]');
  if(await send.count()!==1||!await send.isEnabled())throw browserError('request_failed','没有唯一且可用的发送按钮');
  const previous=normalizePosts(await visibleDTOs(page),{limit:20}).map(p=>p.id);
  const [response]=await Promise.all([page.waitForResponse(r=>/\/i\/api\/graphql\/[^/]+\/CreateTweet(?:\?|$)/.test(r.url())&&r.request().method()==='POST',{timeout:25000}),send.click()]);
  if(!gate.sent||!response.ok())throw browserError('network_uncertain','发送没有有效回执，不能确认结果');
  const ack=acknowledgePost(await response.json(),{operation,text:args.text,replyTo:args.replyTo},username,previous);
  if(!ack)throw browserError('network_uncertain','回执中的新帖、账号、正文或回复目标不一致，需人工核对');
  return ack;
}

export async function browserBridge(store,operation,args={},signal){
  if(!ALLOWED.has(operation))throw browserError('request_failed','浏览器后端不支持此操作');
  const config=store.config();if(!config.aiUsername)throw browserError('configuration_required','请先填写 AI 账号用户名');
  if(['read','bookmark','reply','mention'].includes(operation)&&!/^\d{5,25}$/.test(String(args.id)))throw browserError('request_failed','目标帖子编号无效');
  const permission={bookmark:'allowBookmarks',reply:'allowReplies',mention:'allowMentions'}[operation];
  if(permission&&!config[permission])throw browserError('configuration_required','此写操作尚未获得插件设置授权');
  if(operation==='mention'&&(config.mode!=='mention'||!config.owner||!String(args.text).startsWith('@'+config.owner+' ')))throw browserError('configuration_required','公开分享只能 @ 已配置的接收方');
  let chromium;try{({chromium}=await import('playwright-core'));}catch{throw browserError('dependency_missing','缺少独立浏览器依赖，请运行 Node 安装器准备插件依赖');}
  const cookies=store.credentials(),gate={sent:false};
  const expected=['bookmark','reply','mention'].includes(operation)?{operation,...args}:null;
  let browser,context;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),115000);
  const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
  const cancel=()=>{context?.close().catch(()=>{});browser?.close().catch(()=>{});};combined.addEventListener('abort',cancel,{once:true});
  try{
    combined.throwIfAborted();browser=await chromium.launch(launchOptions(config));
    context=await browser.newContext({locale:'en-US',viewport:{width:1280,height:900},acceptDownloads:false,serviceWorkers:'block'});
    await context.addCookies(cookieObjects(cookies));
    await context.route('**/i/api/graphql/**',async route=>{
      const name=new URL(route.request().url()).pathname.split('/').at(-1);
      let variables;try{variables=route.request().postDataJSON()?.variables;}catch{}
      return authorizeGraphQL(route.request().method(),name,variables,expected,gate)?route.continue():route.abort();
    });
    const page=await context.newPage();page.setDefaultTimeout(20000);
    const identity=await navigate(page,'https://x.com/home',config.aiUsername);
    if(operation==='identity')return identity;
    if(operation==='search'){
      await navigate(page,'https://x.com/search?q='+encodeURIComponent(args.query)+'&src=typed_query&f=live',config.aiUsername);
      return await collect(page,Math.min(20,Math.max(1,Number(args.count)||config.maxCandidates)));
    }
    if(operation==='timeline')return await collect(page,Math.min(20,Math.max(1,Number(args.count)||config.maxCandidates)));
    if(operation==='read')return (await readPost(page,args.id,config.aiUsername)).post;
    if(operation==='bookmark'){
      const {article}=await readPost(page,args.id,config.aiUsername);
      if(await article.locator('[data-testid="removeBookmark"]').count())return {id:args.id,acknowledged:true,alreadyBookmarked:true};
      const button=article.locator('[data-testid="bookmark"]');if(await button.count()!==1)throw browserError('request_failed','没有唯一的收藏按钮，停止操作');
      await identityOnPage(page,config.aiUsername);
      await button.click();await article.locator('[data-testid="removeBookmark"]').waitFor({state:'visible',timeout:15000});
      if(!gate.sent)throw browserError('network_uncertain','收藏状态变化没有匹配的请求，需人工核对');
      return {id:args.id,acknowledged:true};
    }
    return await writePost(page,operation,args,config.aiUsername,gate);
  }catch(error){
    if(error.code)throw error;
    if(combined.aborted)throw browserError('network_uncertain','独立浏览器超时或已取消；不会自动重发操作');
    if(error.name==='TimeoutError')throw browserError('network_uncertain','独立浏览器等待页面或回执超时，请查看页面是否要求验证');
    throw browserError('request_failed','独立浏览器未完成操作，已停止；未自动切回旧接口');
  }finally{clearTimeout(timer);combined.removeEventListener('abort',cancel);await context?.close().catch(()=>{});await browser?.close().catch(()=>{});}
}
