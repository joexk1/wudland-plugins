import assert from 'node:assert/strict';
import {fork, spawn} from 'node:child_process';
import {existsSync, mkdtempSync, readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {readConfig, readState, updateState, withStateLock, writeConfig} from '../lib/config.mjs';
import {utcDay} from '../lib/throttle.mjs';
const CHILD=fileURLToPath(new URL('./helpers/state-contender.mjs',import.meta.url));
function child(mode,home) {
 const proc=fork(CHILD,[mode],{env:{...process.env,WUDLAND_HOME:home},stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';proc.stderr.on('data',d=>stderr+=d);
 const messages=[];const waiters=[];
 proc.on('message',m=>{messages.push(m);for(const w of [...waiters])if(w.match(m)){waiters.splice(waiters.indexOf(w),1);w.resolve(m);}});
 const wait=match=>{const found=messages.find(match);return found?Promise.resolve(found):new Promise((resolve,reject)=>{const timer=setTimeout(()=>{proc.kill('SIGKILL');reject(new Error('child timed out '+stderr));},15000);waiters.push({match,resolve:m=>{clearTimeout(timer);resolve(m);}});});};
 const exit=new Promise(resolve=>proc.on('close',(code,signal)=>resolve({code,signal,stderr})));
 return {proc,wait,exit,start:()=>proc.send('go')};
}

test('parallel hooks, letters and pending workers preserve sessions and enforce shared daily cap after a crashed lock',async t=>{
 const home=mkdtempSync(join(tmpdir(),'wudland-lock-'));process.env.WUDLAND_HOME=home;
 writeConfig({...readConfig(),links:[{id:'test',inbox:'test',key:Buffer.alloc(32).toString('base64'),relay:'http://127.0.0.1:1'}]});
 const now=Date.now();
 updateState(s=>Object.assign(s,{day:utcDay(now),count:220,sessions:{shared:{tools:0,seenAt:now,lastState:'busy',lastSentAt:now},deferred:{tools:0,seenAt:now,pending:{seq:1,evt:{state:'done'}},pendingSeq:1}}}));
 const holder=child('hold',home);t.after(()=>holder.proc.kill('SIGKILL'));await holder.wait(m=>m==='ready');holder.start();await holder.wait(m=>m==='locked');holder.proc.kill('SIGKILL');await holder.exit;
 const modes=[...Array(6).fill('hook'),...Array(6).fill('letter'),...Array(4).fill('pending')];
 const contenders=modes.map(m=>child(m,home));t.after(()=>contenders.forEach(c=>c.proc.kill('SIGKILL')));
 await Promise.all(contenders.map(c=>c.wait(m=>m==='ready')));contenders.forEach(c=>c.start());
 const results=await Promise.all(contenders.map(c=>c.exit));
 for(const result of results)assert.equal(result.code,0,result.stderr);
 const state=readState();assert.equal(state.count,240,'all send kinds share exactly one hard cap');
 assert.equal(state.sessions.shared.tools,120,'parallel read/modify/write preserves every tool increment');
 assert.equal(state.sessions.deferred.pending,null,'a pending event is consumed only once');
 assert.equal(readdirSync(home).some(n=>n==='state.lock'||n.startsWith('.state-lock-')),false,'locks cleaned up');
});

test('a live owner is not stolen and hook lock waits are bounded',async t=>{
 const home=mkdtempSync(join(tmpdir(),'wudland-live-lock-'));process.env.WUDLAND_HOME=home;
 writeConfig({...readConfig(),links:[{id:'test',inbox:'test',key:Buffer.alloc(32).toString('base64'),relay:'http://127.0.0.1:1'}]});
 const holder=child('hold',home);t.after(()=>holder.proc.kill('SIGKILL'));await holder.wait(m=>m==='ready');holder.start();await holder.wait(m=>m==='locked');
 const start=performance.now();assert.throws(()=>withStateLock(()=>assert.fail('stole live lock'),{maxWaitMs:25}),{code:'WUDLAND_STATE_BUSY'});
 assert.ok(performance.now()-start<200,'bounded wait, no indefinite hook blockage');
 const hookStart=performance.now();
 const hook=await new Promise(resolve=>{
   const proc=spawn(process.execPath,[fileURLToPath(new URL('../bin/wudland.mjs',import.meta.url)),'hook','claude'],{env:{...process.env,WUDLAND_HOME:home},stdio:['pipe','pipe','pipe']});
   let output='';proc.stdout.on('data',d=>output+=d);proc.stderr.on('data',d=>output+=d);
   proc.stdin.end(JSON.stringify({session_id:'blocked',hook_event_name:'UserPromptSubmit',prompt:'test'}));
   proc.on('close',code=>resolve({code,output}));
 });
 assert.equal(hook.code,0);assert.equal(hook.output,'','contention is silent for real hooks');
 assert.ok(performance.now()-hookStart<600,'real hook exits quickly under contention');
 assert.equal(existsSync(join(home,'state.json')),false,'a failed lock never writes stale state');
 holder.proc.kill('SIGKILL');await holder.exit;
 updateState(s=>{s.count=1;});assert.equal(readState().count,1,'the next process recovers a confirmed dead owner');
});
