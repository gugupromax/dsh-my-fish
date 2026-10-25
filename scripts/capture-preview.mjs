// Local UI rendering only: no account data, network, or platform operations.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {previewHTML} from './render-preview.mjs';
const output=new URL('../recovery/',import.meta.url);fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,chromiumSandbox:true});
try{
  for(const [name,width,height] of [['desktop',1000,950],['mobile',390,844]]){
    const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    await page.route('**/*',route=>route.abort());
    await page.setContent(previewHTML());
    const metrics=await page.evaluate(()=>({contentWidth:document.documentElement.scrollWidth,viewport:innerWidth}));
    if(metrics.contentWidth>metrics.viewport)throw Error(name+' preview has horizontal overflow');
    await page.screenshot({path:fileURLToPath(new URL('personal-preview-'+name+'.png',output)),fullPage:true});
    console.log(JSON.stringify({preview:name,overflow:false}));await page.close();
  }
}finally{await browser.close();}
