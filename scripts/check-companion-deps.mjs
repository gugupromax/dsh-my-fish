// Read-only setup report. No installs, downloads, account/config reads or model calls.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
export function inspectCompanionDependencies(home,profile='desktop'){
  if(typeof profile!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(profile))throw Error('需要有效的DSH profile名称');
  const base=path.join(home,'profiles',profile);let manifest={};try{manifest=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw Error('所选profile元数据不可读');}
  return {profile,plugins:['dsh-pet','dsh-video-storyboard'].map(name=>{let pkg=null;try{pkg=JSON.parse(fs.readFileSync(path.join(base,'node_modules',name,'package.json'),'utf8'));}catch{}return {name,declared:Object.hasOwn(manifest.dependencies??{},name),packagePresent:pkg?.name===name,version:typeof pkg?.version==='string'&&/^[0-9][0-9A-Za-z.+-]{0,80}$/.test(pkg.version)?pkg.version:null};}),note:'依赖声明与缓存存在不证明客户端已启用、工具可见或实际显示/读图成功。RSS和浏览器本地朗读不需要这两项插件。'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--profile'))throw Error('仅支持 --profile <名称>');
  const report=inspectCompanionDependencies(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),args[1]||'desktop');
  report.pathTools=Object.fromEntries(['ffmpeg','ffprobe','yt-dlp'].map(name=>{if(process.platform!=='win32')return [name,'not-checked'];const command=path.join(process.env.SystemRoot||'C:/Windows','System32','where.exe'),result=spawnSync(command,[name],{encoding:'utf8',windowsHide:true,timeout:3000});return [name,result.status===0?'found-on-PATH':'not-detected-on-PATH'];}));
  console.log(JSON.stringify(report,null,2));
}
