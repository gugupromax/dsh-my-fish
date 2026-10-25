import { Store } from '../lib/store.js';
import { Engine } from '../lib/engine.js';
const store=new Store();
if(!process.argv.includes('--connect')){
  console.log(JSON.stringify({config:store.config(),...store.publicStatus(),note:'只读本地检查；加 --connect 才会连接 X。'},null,2));
}else{
  try{console.log(JSON.stringify(await new Engine(store).diagnose(),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
