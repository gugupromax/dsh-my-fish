import fs from 'node:fs';
import path from 'node:path';
const root='D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai';
const files=process.argv.slice(2);
for(const file of files){
  console.log('\nFILE '+file);
  try {
    const [relative,range]=file.split('#');
    const p=path.join(root,relative);
    if(fs.statSync(p).isDirectory()){console.log(fs.readdirSync(p).filter(name=>!range||new RegExp(range.slice(1)).test(name)));continue;}
    const text=fs.readFileSync(p,'utf8');
    const lines=text.split('\n');
    if(range){
      if(range.startsWith('/')){
        const re=new RegExp(range.slice(1));
        const keep=new Set();for(let i=0;i<lines.length;i++)if(re.test(lines[i]))for(let n=Math.max(0,i-3);n<=Math.min(lines.length-1,i+7);n++)keep.add(n);
        console.log([...keep].map(i=>`${i+1}: ${lines[i]}`).join('\n'));
      }else{
        const [start,end]=range.split(':').map(Number);
        console.log(lines.slice(start-1,end).map((line,i)=>`${start+i}: ${line}`).join('\n'));
      }
    }else console.log(lines.map((line,i)=>`${i+1}: ${line}`).join('\n'));
  } catch(error) { console.log(error.code); }
}
