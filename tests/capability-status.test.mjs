import test from 'node:test';import assert from 'node:assert/strict';import {capabilityStatus} from '../lib/capability-status.js';
test('status distinguishes configured, registered and unverified capabilities without leaking configuration',()=>{
 const value=capabilityStatus({mainBound:true,mainLive:false,settings:{videoEnabled:true,rssEnabled:false,feedCount:1,rssFeedLines:'private feed'},presentation:{settings:{enabled:true,mode:'pet'},connection:'accepted'},video:{probe:true,storyboard:true,busy:false}});
 assert.equal(value.session.bound,true);assert.equal(value.session.live,false);assert.equal(value.video.probeRegistered,true);assert.equal(value.video.enabled,true);assert.equal(value.pet.connection,'accepted');assert.match(value.video.note,/不代表/);assert.doesNotMatch(JSON.stringify(value),/private feed/);
 assert.equal(value.video.hostSpeechInterface,null);
 const both=capabilityStatus({mainBound:true,mainLive:true,settings:{videoEnabled:false,rssEnabled:false,feedCount:0},presentation:{settings:{enabled:true,mode:'both'}},video:{}});assert.equal(both.pet.enabled,true);assert.equal(both.speech.enabled,true);
 assert.equal(capabilityStatus({mainBound:false,mainLive:false,settings:{videoEnabled:false,rssEnabled:false,feedCount:0},presentation:{settings:{enabled:false,mode:'pet'}},video:{},hostSpeechInterface:true}).video.hostSpeechInterface,true);
});
