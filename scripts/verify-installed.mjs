// Verify installed host contracts without launching its GUI or changing user data.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=process.env.DSH_DESKTOP_EXE||'D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe';
for(const name of ['verify-host.mjs','verify-personal-context.mjs','verify-permissions.mjs','verify-workspace.mjs','verify-session-recovery.mjs']){
  const script=fileURLToPath(new URL(name,import.meta.url));
  const result=spawnSync(app,['--expose-internals',script],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},encoding:'utf8',windowsHide:true,timeout:30000});
  if(result.stdout)process.stdout.write(result.stdout);
  if(result.stderr)process.stderr.write(result.stderr);
  if(result.error||result.status!==0||!(result.stdout||'').includes('passed'))throw Error('Installed DSH verification failed: '+script);
}
