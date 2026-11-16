// Explicit opt-in media-engine verification. Never part of npm run check.
// Generates its own local testsrc; no user video, URL, ASR or model is used.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {VideoBridge} from '../lib/video-bridge.js';

function executable(name){
  const file=process.env[name];if(typeof file!=='string'||!path.isAbsolute(file)||!fs.statSync(file).isFile())throw Error('Set '+name+' to the verified installed executable before running this explicit check');return file;
}
const ffmpeg=executable('DSH_FFMPEG_PATH'),ffprobe=executable('DSH_FFPROBE_PATH');
const installed=process.env.MY_FISH_VIDEO_PACKAGE_ROOT||path.join(os.homedir(),'.dsh','profiles','desktop','node_modules','dsh-video-storyboard');
const packageRoot=fs.realpathSync(installed),pkg=JSON.parse(fs.readFileSync(path.join(packageRoot,'package.json'),'utf8'));
assert.equal(pkg.name,'dsh-video-storyboard');assert.ok(['0.7.4','0.7.5'].includes(pkg.version),'This check targets the reviewed 0.7.4 and 0.7.5 contracts');
const relativeExport=pkg.exports?.['./pipeline'];assert.equal(typeof relativeExport,'string');
const pipelineFile=path.resolve(packageRoot,relativeExport),inside=path.relative(packageRoot,pipelineFile);assert.ok(inside&&!inside.startsWith('..')&&!path.isAbsolute(inside));
const temp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'my-fish-media-runtime-'))),previousFetch=globalThis.fetch;
const changes={DSH_HOME:temp,DSH_VIDEO_CACHE_DIR:path.join(temp,'cache'),DSH_VIDEO_MEDIA_DIR:path.join(temp,'media'),DSH_HWACCEL:'none',DSH_ASR_ENABLED:'0'};
const saved=new Map([...Object.keys(changes),'DSH_VIDEO_COOKIES'].map(key=>[key,process.env[key]]));
let networkCalls=0,passed=false;
try{
  for(const [key,value]of Object.entries(changes))process.env[key]=value;delete process.env.DSH_VIDEO_COOKIES;
  globalThis.fetch=()=>{networkCalls++;throw Error('No network call is permitted by the synthetic media check');};
  const {validateToolArgs}=await import(pathToFileURL(path.join(packageRoot,'src/storyboard/tool-spec.js')).href);
  const {boardOptions}=await import(pathToFileURL(path.join(packageRoot,'src/storyboard/board.js')).href);
  const agent={id:'synthetic-main',session:{id:'synthetic-main'}},exec={agent,token:{},callId:'synthetic-call',signal:new AbortController().signal};
  const bridge=new VideoBridge({store:{state:()=>({sessionId:'synthetic-main'})},getTools:()=>({get:()=>({})}),invokeTool:async input=>{
    if(input.name==='video_probe')return {isError:false,value:{text:'Synthetic probe'}};
    assert.deepEqual(validateToolArgs(input.arguments),[],'Actual installed tool accepts the bridge request');
    const options=boardOptions(input.arguments,{kind:'board'});assert.equal(options.from,10);assert.equal(options.to,input.arguments.to);assert.equal(Object.hasOwn(input.arguments,'segment'),false);
    return {isError:false,value:{text:'Synthetic storyboard',images:[]}};
  }});
  for(const seconds of [1,15,29,30,180]){const result=await bridge.read({reference:'BV1GJ411x7h7',from:10,seconds},exec.signal,exec);assert.equal(result.to,10+seconds);}
  for(const dir of ['cache','media'])fs.mkdirSync(path.join(temp,dir));
  const fixture=path.join(temp,'synthetic-testsrc.mp4');
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-f','lavfi','-i','testsrc=size=320x180:rate=12','-t','3','-an','-c:v','mpeg4','-q:v','4','-pix_fmt','yuv420p','-threads','1','-y',fixture],{timeout:30000,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const info=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-show_format','-of','json',fixture],{timeout:10000,windowsHide:true,encoding:'utf8'}));
  assert.equal(info.streams.filter(stream=>stream.codec_type==='video').length,1);assert.equal(info.streams.filter(stream=>stream.codec_type==='audio').length,0);assert.ok(Number(info.format.duration)>=2.9&&Number(info.format.duration)<=3.1);
  // Verify the already installed subtitle path, without an ASR model, account,
  // network access, or a real user file. Only the local synthetic track is used.
  const subFile=path.join(temp,'synthetic.srt'),subVideo=path.join(temp,'synthetic-caption.mkv');
  fs.writeFileSync(subFile,'1\n00:00:00,200 --> 00:00:02,000\nSynthetic subtitle example\n');
  execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',fixture,'-f','lavfi','-i','sine=frequency=440:duration=3','-i',subFile,'-map','0:v:0','-map','1:a:0','-map','2:s:0','-c:v','copy','-c:a','aac','-c:s','srt','-t','3','-y',subVideo],{timeout:30000,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const {resolveTranscript}=await import(pathToFileURL(path.join(packageRoot,'src/storyboard/transcript-pass.js')).href);
  const caption=await resolveTranscript({input:subVideo,info:{hasAudio:true,hasSubtitle:true},sourceInfo:null,transcript:'auto',winStart:0,winDur:3,ffmpegPath:ffmpeg,cache:false,hostAsr:null});
  assert.equal(caption.transcriptInfo?.source,'subtitle');assert.ok(caption.transcriptInfo.segments.some(row=>row.text.includes('Synthetic subtitle example')));
  const specFile=path.resolve(packageRoot,pkg.exports['./tool-spec']);assert.ok(!path.relative(packageRoot,specFile).startsWith('..'));
  const spec=await import(pathToFileURL(specFile).href),bridgeArgs={input:'https://www.bilibili.com/video/BV1GJ411x7h7/',from:0,to:90,segment:90,maxFrames:12,maxSheets:2,scanHeight:360,budget:360000,allowAnonymous:true,detail:'low',transcript:'auto',ocr:false,sourceHash:false};
  assert.equal(spec.TOOL_NAME,'video_storyboard');assert.equal(spec.PROBE_TOOL_NAME,'video_probe');assert.deepEqual(spec.validateToolArgs(bridgeArgs),[]);
  for(const key of Object.keys(bridgeArgs))assert.ok(Object.hasOwn(spec.storyboardToolSpec().parameters,key),'Missing storyboard argument '+key);
  for(const key of ['input','allowAnonymous'])assert.ok(Object.hasOwn(spec.probeToolSpec().parameters,key),'Missing probe argument '+key);
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
  console.log(JSON.stringify({mediaRuntime:'passed',packageVersion:pkg.version,bridgeToolArguments:'passed',embeddedSubtitle:'passed',fixtureDurationSeconds:Number(info.format.duration),imageCount:sheets.length,sheets,cpuDecode:true,networkCalls,modelCalls:0,asrCalls:0,scope:'Installed tool-spec/runStoryboard/subtitle extraction and real ffmpeg/ffprobe, self-generated local fixtures only; not remote subtitles, real ASR, DSH tool guard, model-image-admission or semantic-understanding test'}));
}finally{
  globalThis.fetch=previousFetch;for(const [key,value]of saved)if(value===undefined)delete process.env[key];else process.env[key]=value;
  // Delete only the exact temporary root minted above, never a supplied path.
  const actual=fs.realpathSync(temp),relative=path.relative(fs.realpathSync(os.tmpdir()),actual);assert.equal(actual,temp);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative)&&path.basename(actual).startsWith('my-fish-media-runtime-'));
  fs.rmSync(actual,{recursive:true,force:true});
}
if(!passed)throw Error('Synthetic media verification did not complete');
