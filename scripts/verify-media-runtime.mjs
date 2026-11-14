// Explicit opt-in media-engine verification. Never part of npm run check.
// Generates its own local testsrc; no user video, URL, ASR or model is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

function executable(name){
  const file=process.env[name];if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('Set '+name+' to the verified installed executable before running this explicit check');return file;
}
const ffmpeg=executable('DSH_FFMPEG_PATH'),ffprobe=executable('DSH_FFPROBE_PATH');
const installed=process.env.MY_FISH_VIDEO_PACKAGE_ROOT||path.join(os.homedir(),'.dsh','profiles','desktop','node_modules','dsh-video-storyboard');
const packageRoot=fs.realpathSync(installed),pkg=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
assert.equal(pkg.name,'dsh-video-storyboard');assert.equal(pkg.version,'0.7.4','This check targets the audited installed contract');
const relativeExport=pkg.exports?.['./pipeline'];assert.equal(typeof relativeExport,'string');
const pipelineFile=path.resolve(packageRoot,relativeExport),inside=path.relative(packageRoot,pipelineFile);assert.ok(inside&&!inside.startsWith('..')&&!path.isAbsolute(inside));
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-media-runtime-'))),previousFetch=globalThis.fetch;
const changes={DSH_HOME:temp,DSH_VIDEO_CACHE_DIR:path.join(temp,'cache'),DSH_VIDEO_MEDIA_DIR:path.join(temp,'media'),DSH_HWACCEL:'none',DSH_ASR_ENABLED:'0'};
const saved=new Map([...Object.keys(changes),'DSH_VIDEO_COOKIES'].map(key=>[key,process.env[key]]));
let networkCalls=0,passed=false;
try{
  for(const [key,value]of Object.entries(changes))process.env[key]=value;delete process.env.DSH_VIDEO_COOKIES;
  globalThis.fetch=()=>{networkCalls++;throw Error('No network call is permitted by the synthetic media check');};
  for(const dir of ['cache','media'])fs.mkdirSync(path.join(temp,dir));
  const fixture=path.join(temp,'synthetic-testsrc.mp4');
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc=size=320x180:rate=12','-t','3','-an','-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p','-threads','1','-y',fixture],{timeout:30000,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const info=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',fixture],{timeout:10000,windowsHide:true,encoding:'utf8'}));
  assert.equal(info.streams.filter(stream=>stream.codec_type==='video').length,1);assert.equal(info.streams.filter(stream=>stream.codec_type==='audio').length,0);assert.ok(Number(info.format.duration)>=2.9&&Number(info.format.duration)<=3.1);
  const {runStoryboard}=await import(pathToFileURL(pipelineFile).href);assert.equal(typeof runStoryboard,'function');
  const result=await runStoryboard({input:fixture,from:0,to:3,segment:3,maxFrames:3,minFrames:2,maxSheets:2,strategy:'compact',budget:360000,maxCanvasSide:800,integral:false,pick:'mid',burn:'none',transcript:'off',ocr:false,audioStrip:false,hostAsr:null,cache:false,sourceHash:false,ffmpegPath:ffmpeg,ffprobePath:ffprobe,frameConcurrency:1});
  assert.ok(Array.isArray(result.sheets)&&result.sheets.length>0&&result.sheets.length<=2);
  const sheets=result.sheets.map(sheet=>{
    assert.ok(sheet.png instanceof Uint8Array,'The public library returned encoded image bytes');const png=Buffer.from(sheet.png);
    assert.ok(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Image has a real PNG signature');
    const width=png.readUInt32BE(16),height=png.readUInt32BE(20);assert.equal(width,sheet.width);assert.equal(height,sheet.height);assert.ok(width>0&&height>0&&width<=1600&&height<=1600);
    const pixels=execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],{input:png,timeout:15000,windowsHide:true,maxBuffer:16*1024*1024});
    assert.equal(pixels.length,width*height*3,'Actual ffmpeg decoder produced a complete RGB frame');assert.ok(new Set(pixels).size>16,'Generated test pattern contains nontrivial image pixels');
    return {width,height,pngBytes:png.length,decodedRgbBytes:pixels.length,cellCount:sheet.cells?.length??0};
  });
  assert.ok(sheets.reduce((sum,s)=>sum+s.cellCount,0)>0);assert.equal(networkCalls,0);passed=true;
  console.log(JSON.stringify({mediaRuntime:'passed',packageVersion:pkg.version,fixtureDurationSeconds:Number(info.format.duration),imageCount:sheets.length,sheets,cpuDecode:true,networkCalls,modelCalls:0,asrCalls:0,scope:'Installed public runStoryboard library and real ffmpeg/ffprobe, self-generated local testsrc only; not a remote-video, cookie, DSH tool guard, model-image-admission or semantic-understanding test'}));
}finally{
  globalThis.fetch=previousFetch;for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
  // Delete only the exact temporary root minted above, never a supplied path.
  const actual=fs.realpathSync(temp),relative=path.relative(fs.realpathSync(os.tmpdir()),actual);assert.equal(actual,temp);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('my-fish-media-runtime-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
if(!passed)throw Error('Synthetic media verification did not complete');
