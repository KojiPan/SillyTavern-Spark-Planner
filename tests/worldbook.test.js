import test from 'node:test';
import assert from 'node:assert/strict';
import { Worldbook } from '../worldbook.js';
import { KEY } from '../core.js';
test('owned writes preserve ordinary records; conflicts/errors abort; backups restore owned entries only',async()=>{
    let data={entries:{0:{uid:0,comment:'普通条目',content:'ordinary',nativeUnknown:'keep'}}};
    const memory=new Map(),config={world:'test'};
    const c={getRequestHeaders:()=>({}),accountStorage:{getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)},eventSource:{emit:async()=>{}},eventTypes:{WORLDINFO_UPDATED:'updated'},loadWorldInfo:async()=>structuredClone(data)};
    const world=new Worldbook(()=>c,()=>config);
    world.api=async()=>({worldInfoCache:{set:()=>{}},createWorldInfoEntry:(_name,target)=>{let uid=0;while(Object.hasOwn(target.entries,uid))uid++;return target.entries[uid]={uid};}});
    let fail=false, conflict=false, gets=0;
    const original=globalThis.fetch;
    globalThis.fetch=async(path,options)=>{
        if(path.endsWith('/get')) {gets++;if(conflict && gets%2===0)data.entries[0].content='concurrent';return {ok:true,json:async()=>structuredClone(data)};}
        if(fail)return {ok:false,status:503};
        data=JSON.parse(options.body).data;return {ok:true,status:200};
    };
    try {
        const id=await world.addSkill({title:'A',body:'body',type:'spark',id:'fixed'});
        assert.equal(id,'fixed');assert.equal(data.entries[0].nativeUnknown,'keep');
        const uid=Object.values(data.entries).find(e=>e[KEY]?.id==='fixed').uid;
        await world.upsert({title:'改名',body:'edited',type:'spark',id:'fixed',native:{position:7,depth:4,role:2,outletName:'koji_cot'}});
        assert.equal(Object.keys(data.entries).length,2);assert.equal(data.entries[uid].comment,'改名');assert.equal(data.entries[uid].disable,true);
        fail=true;await assert.rejects(world.remove('fixed'),/503/);assert.ok(data.entries[uid]);fail=false;
        conflict=true;gets=0;await assert.rejects(world.remove('fixed'),/并发/);assert.ok(data.entries[uid]);conflict=false;
        data.entries[0].content='ordinary-new';await world.remove('fixed');await world.restoreBackup(0);
        assert.equal(data.entries[0].content,'ordinary-new');assert.ok(Object.values(data.entries).some(e=>e[KEY]?.id==='fixed'));
    }finally{globalThis.fetch=original;}
});
