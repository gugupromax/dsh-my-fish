// My Fish link installer. No global dependencies and no user-data migration.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

export const PACKAGE_NAME='dsh-my-fish',LEGACY_PACKAGE='dsh-x-whale';
const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function readOptions(argv) {
  const result={profile:'desktop',app:process.env.DSH_DESKTOP_EXE||'D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe',home:process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),dryRun:false,prepareOnly:false,migrateLegacy:false,help:false};
  const values={'--profile':'profile','--app':'app','--home':'home'},flags={'--dry-run':'dryRun','--prepare-only':'prepareOnly','--migrate-legacy':'migrateLegacy','--help':'help','-h':'help'};
  for(let i=0;i<argv.length;i++) {
    const key=argv[i];
    if(flags[key]){result[flags[key]]=true;continue;}
    if(!values[key]||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('未知参数或缺少参数值：'+key);
    result[values[key]]=argv[++i];
  }
  if(!/^[\w.-]+$/.test(result.profile))throw Error('profile 名称只能含字母、数字、下划线、点和连字符');
  result.home=path.resolve(result.home);result.app=path.resolve(result.app);
  return result;
}

export function installedDependencies(home,profile) {
  const manifest=path.join(home,'profiles',profile,'package.json');
  let value;
  try{value=JSON.parse(fs.readFileSync(manifest,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw Error('无法读取 profile 插件清单，请先修复 package.json');}
  return {...value.dependencies,...value.optionalDependencies,...value.devDependencies};
}

export function installPlan(options,dependencies={},root=projectRoot) {
  const oldSpec=dependencies[LEGACY_PACKAGE],hasNew=Object.hasOwn(dependencies,PACKAGE_NAME);
  if(oldSpec&&!options.migrateLegacy&&!options.prepareOnly)throw Error('检测到旧版插件。请先退出 DSH，使用 --dry-run --migrate-legacy 审阅迁移，再使用 --migrate-legacy 安装；不会同时加载两个插件。');
  const actions=[];
  if(!options.prepareOnly&&oldSpec)actions.push({kind:'remove',package:LEGACY_PACKAGE});
  if(!options.prepareOnly)actions.push({kind:'add',package:PACKAGE_NAME,spec:'link:'+root});
  return {package:PACKAGE_NAME,profile:options.profile,home:options.home,prepareDependencies:true,requiresHostStopped:!options.prepareOnly,legacyDetected:!!oldSpec,existingNewPackage:hasNew,actions,previousLegacySpec:oldSpec||null,userData:'keep-in-place'};
}

export function executeInstall(plan,{prepare,plugin}) {
  // Prepare before changing the profile, so a network failure cannot remove it.
  prepare();
  let removed=false;
  for(const action of plan.actions) {
    if(action.kind==='remove'){plugin(['remove',action.package]);removed=true;continue;}
    try{plugin(['add',action.spec]);}
    catch(error){
      if(removed)throw Error('旧插件依赖已移除，但 My Fish 安装失败。用户数据未移动；保持 DSH 退出，修复上方错误后重新运行安装器。旧 link 可能指向已改名源码，因此不承诺自动回滚。');
      throw error;
    }
  }
}

function run(program,args,env=process.env) {
  const result=spawnSync(program,args,{cwd:projectRoot,env,windowsHide:true,stdio:'inherit'});
  if(result.error||result.status!==0)throw Error('安装步骤未成功，请保留上面的错误信息');
}

export function main(argv=process.argv.slice(2)) {
  const options=readOptions(argv);
  if(options.help){console.log('My Fish 本地安装\nnode scripts/install-local.mjs [--profile desktop] [--app <DSH executable>] [--home <DSH home>] [--dry-run] [--migrate-legacy] [--prepare-only]\n升级旧版前退出 DSH。--dry-run 只输出计划；--migrate-legacy 明确允许替换旧插件依赖，数据原位保留。');return;}
  const dependencies=options.prepareOnly?{}:installedDependencies(options.home,options.profile);
  const plan=installPlan(options,dependencies);
  if(options.dryRun){console.log(JSON.stringify(plan,null,2));return;}
  if(!options.prepareOnly&&!fs.existsSync(options.app))throw Error('找不到 DSH，请用 --app 指定应用路径');
  const npm=path.join(path.dirname(process.execPath),'node_modules','npm','bin','npm-cli.js');
  if(!fs.existsSync(npm))throw Error('找不到当前 Node 自带的 npm，请确认 node 和 npm 来自同一安装目录');
  const entry=path.join(path.dirname(options.app),'resources','app.asar','dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js');
  executeInstall(plan,{
    prepare:()=>run(process.execPath,[npm,fs.existsSync(path.join(projectRoot,'package-lock.json'))?'ci':'install','--omit=dev','--ignore-scripts','--no-audit','--no-fund']),
    plugin:args=>run(options.app,['--expose-internals',entry,'plugin','--profile',options.profile,...args],{...process.env,DSH_HOME:options.home,ELECTRON_RUN_AS_NODE:'1'}),
  });
  console.log(options.prepareOnly?'项目依赖已准备；未修改 DSH profile。':'My Fish 安装完成。请重开 DSH，在设置中打开 My Fish；账号、主会话与记忆保持原位。');
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main();
