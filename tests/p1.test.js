import test from 'node:test';
import assert from 'node:assert/strict';
import { Worldbook } from '../worldbook.js';
import { validateSkill } from '../skill-pack.js';
import { KEY } from '../core.js';

test('P1 create/update/merge retain stable IDs, mixed types, raw text and native parameters',async()=>{
    let data={entries:{0:{uid:0,content:'ordinary',comment:'同名'}}};
    const config={world:'p1'}, context={getRequestHeaders:()=>({}),loadWorldInfo:async()=>structuredClone(data),eventSource:{emit:async()=>{}},eventTypes:{WORLDINFO_UPDATED:'updated'}};
    const world=new Worldbook(()=>context,()=>config);
    world.api=async()=>({worldInfoCache:{set:()=>{}},createWorldInfoEntry:(_name,target)=>{let uid=0;while(Object.hasOwn(target.entries,uid))uid++;return target.entries[uid]={uid,scanDepth:9};}});
    const original=globalThis.fetch;
    globalThis.fetch=async(path,options)=>{if(path.endsWith('/get'))return {ok:true,json:async()=>structuredClone(data)};data=JSON.parse(options.body).data;return {ok:true};};
    try {
        const raw='\n# Markdown\n{{user}}\n  缩进\n\n正文结尾\n';
        await world.addSkill({id:'reasoning-fixed',title:'同名',type:'reasoning',category:'来源',body:raw});
        await world.addSkill({id:'spark-fixed',title:'同名',type:'spark',category:'来源',body:'火花正文',native:{position:7,outletName:'specific',order:211,probability:42,sticky:3}});
        const initial=await world.skills();assert.equal(initial[0].native.order,100);assert.equal(initial[0].native.probability,100);assert.equal(initial[0].native.position,4);assert.equal(initial[0].native.role,0);assert.equal(initial[0].native.depth,0);
        await world.upsert({...initial[0],title:'改标题',native:{...initial[0].native,role:2,depth:6,order:123,probability:65}});
        const before=await world.skills();await world.category('来源','目标');const after=await world.skills();
        assert.equal(after.length,2);assert.equal(Object.keys(data.entries).length,3);assert.equal(data.entries[0].content,'ordinary');
        assert.deepEqual(after.map(({category,entry,...s})=>s),before.map(({category,entry,...s})=>s));
        assert.ok(after.every(s=>s.category==='目标'));assert.equal(after[0].id,'reasoning-fixed');assert.equal(after[0].body,raw);assert.equal(after[0].native.role,2);assert.equal(after[0].native.depth,6);assert.equal(after[0].native.order,123);assert.equal(after[0].native.probability,65);assert.equal(after[1].native.sticky,3);
        await world.category('目标','未分类');assert.equal((await world.skills()).length,2);
    }finally{globalThis.fetch=original;}
});

test('P1 invalid native values are rejected before persistence',()=>{
    const skill={id:'fixed',type:'spark',title:'title',body:'body'};
    for(const native of [{probability:-1},{probability:101},{order:'NaN'}])assert.throws(()=>validateSkill({...skill,native}));
    assert.equal(validateSkill({...skill,native:{order:-10}}).native.order,-10);
    assert.equal(validateSkill({...skill,native:{probability:42.5}}).native.probability,42.5);
});
