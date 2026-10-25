import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const PUBLIC_ENTRIES=['lib','scripts','tests','docs','.github','AGENTS.md','HANDOFF.md','bridge/x_client.py','bridge/transaction_compat.py','bridge/operation_compat.py','bridge/post_data.py','package.json','package-lock.json','cordis.patch.yml','requirements.txt','requirements-lock.txt','README.md','VALIDATION.md','LICENSE','.gitignore'];
const excluded=new Set(['node_modules','.venv','__pycache__','recovery','releases','dist','.npm-cache','.pack-cache','.git','user-data','browser-profiles','credentials.json','config.json','state.json','my-fish-location.json','my-fish-migration.json','.operation.lock','.env']);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

export function packageFiles(projectRoot) {
  projectRoot=path.resolve(projectRoot);
  const files=[];
  function walk(relative) {
    if(relative.split(path.sep).some(part=>excluded.has(part)||part.startsWith('.env.')||part.startsWith('.my-fish-migration-')||/^tmp/.test(part)))return;
    const file=path.join(projectRoot,relative),stat=fs.lstatSync(file);
    if(stat.isSymbolicLink())throw Error('发行包不接受符号链接：'+relative);
    if(stat.isDirectory()){for(const name of fs.readdirSync(file).sort())walk(path.join(relative,name));return;}
    if(!stat.isFile()||/\.(?:pyc|tgz|log|png|zip)$/i.test(relative))return;
    files.push(relative);
  }
  for(const entry of PUBLIC_ENTRIES)if(fs.existsSync(path.join(projectRoot,entry)))walk(entry);
  return files;
}

export function stagePackage(projectRoot=root) {
  projectRoot=fs.realpathSync(projectRoot);
  const parent=path.join(projectRoot,'dist'),target=path.resolve(parent,'dsh-my-fish');
  // Verify the exact output and parent before replacing a prior staging tree.
  if(path.dirname(target)!==parent||path.basename(target)!=='dsh-my-fish')throw Error('发行目录超出项目范围');
  for(const directory of [parent,target])if(fs.existsSync(directory)&&fs.lstatSync(directory).isSymbolicLink())throw Error('发行目录不能为符号链接');
  const files=packageFiles(projectRoot);
  if(fs.existsSync(target))fs.rmSync(target,{recursive:true,force:true});
  fs.mkdirSync(target,{recursive:true});
  for(const entry of files){const dest=path.join(target,entry);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(path.join(projectRoot,entry),dest);}
  fs.writeFileSync(path.join(target,'PUBLIC_FILES.json'),JSON.stringify({package:'dsh-my-fish',files:files.map(file=>file.split(path.sep).join('/'))},null,2)+'\n');
  return target;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(stagePackage());
