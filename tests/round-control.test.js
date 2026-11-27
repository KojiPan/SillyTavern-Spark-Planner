import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../workflow.js';
import { KEY, DEFAULT_PROMPTS, extractGuidance, parsePlanner, plannerPrompt } from '../core.js';
import { validateAnalysisModule } from '../analysis-modules.js';
import { exportPack, importPack } from '../skill-pack.js';

function fixture(mode='manual') {
    let calls=0,answer='[reasoning skill:001][spark:001]\n### 探索\n秘密分析<guidance>交付指导</guidance>标签外';
    const config={enabled:true,world:'book',runMode:mode,reasoningLimit:5,timeout:5,prompts:{...DEFAULT_PROMPTS}};
    const notices=[],listeners=new Map();
    const c={chatId:'a',characterId:0,chat:[],chatMetadata:{},mainApi:'openai',getChatCompletionModel:()=> 'fixture',
        saveChat:async()=>{},saveMetadataDebounced:()=>{},stopGeneration:()=>{},deactivateSendButtons:()=>{},
        eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{makeLast:(e,f)=>listeners.set(e,f),removeListener:e=>listeners.delete(e)},
        generateQuietPrompt:async()=>{calls++;return answer;}};
    const skills=[{id:'r',type:'reasoning',title:'方法',body:'R_BODY'},{id:'s',type:'spark',title:'素材',body:'S_BODY'}];
    const entries=skills.map((s,i)=>({uid:i,world:'book',comment:s.title,content:s.body,disable:true,position:4,depth:0,role:0,[KEY]:{owner:KEY,kind:'skill',id:s.id,type:s.type,enabled:true}}));
    entries.push({uid:2,world:'book',content:'',disable:true,[KEY]:{owner:KEY,kind:'discovery'}});
    const world={skills:async()=>structuredClone(skills),entries:async()=>structuredClone(entries),ensureDiscovery:async()=>{},analysisModules:async()=>[validateAnalysisModule({id:'m',name:'探索',packId:'default',injectionMode:'guidance',analysis:'任意分析',outputFormat:'### 探索'})]};
    const flow=new Workflow(()=>c,()=>config,world,(...args)=>notices.push(args));
    const lore=()=>{const lore={chatLore:[],globalLore:structuredClone(entries)};flow.lore(lore);return lore.chatLore;};
    const send=mes=>c.chat.push({is_user:true,mes});
    const intercept=(type='normal')=>{let aborted=false;const done=flow.intercept([],1,()=>{aborted=true;},type);return {done,aborted:()=>aborted};};
    return {flow,c,config,world,entries,notices,lore,send,intercept,calls:()=>calls,setAnswer:v=>{answer=v;}};
}
async function reviewing(f,type='normal') {
    const request=f.intercept(type);
    for(let i=0;!f.flow.pending && i<100;i++)await new Promise(r=>setImmediate(r));
    assert.ok(f.flow.pending);return request;
}

test('exact guidance protocol: complete blocks only, strict empty/malformed/nested handling',()=>{
    assert.equal(extractGuidance('outside<guidance> one </guidance>middle<guidance>two</guidance>tail'),'one\n\ntwo');
    for(const text of ['plain','<guidance> </guidance>','<guidance>open','</guidance>stray','<guidance bad>bad</guidance>','<guidance>a<guidance>b</guidance>c</guidance>'])assert.equal(extractGuidance(text),'');
});
test('all legacy modes use the same whole-output guidance protocol; raw analysis stays separate',()=>{
    const modules=[{id:'a',name:'全文',injectionMode:'full'},{id:'b',name:'选择',injectionMode:'guidance'},{id:'c',name:'查看',injectionMode:'view'},{id:'d',name:'缺失',injectionMode:'guidance'}];
    const raw='[reasoning skill:][spark:]\n### 全文\n旧指导\n### 选择\n分析<guidance>一</guidance>外部<guidance>二</guidance>\n### 查看\n<guidance>不可交付</guidance>\n### 缺失\n<guidance>未闭合';
    const p=parsePlanner(raw,{reasoning:[],spark:[]},5,modules);
    assert.equal(p.discovery,'一\n\n二\n\n不可交付');assert.equal(p.moduleOutputs.length,0);assert.equal(p.warnings.length,0);
    assert.ok(raw.includes('未闭合'));assert.ok(!p.discovery.includes('分析'));
    const broken=parsePlanner('### 选择\n<guidance>前\n### 查看\n后</guidance>',{reasoning:[],spark:[]},5,modules);
    assert.equal(broken.discovery,'前\n### 查看\n后');
});
test('same-name modules and legacy view fields do not alter tag appearance order',()=>{
    const p=parsePlanner('### 1. 探索\n<guidance>交付</guidance>\n### 2. 探索\n<guidance>私有</guidance>',{reasoning:[],spark:[]},5,[{id:'a',name:'探索',injectionMode:'guidance'},{id:'b',name:'探索',injectionMode:'view'}]);
    assert.equal(p.discovery,'交付\n\n私有');assert.deepEqual(p.moduleOutputs,[]);
});
test('legacy config defaults to full; injected protocol and ZIP preserve custom prompt and mode',()=>{
    const old=validateAnalysisModule({id:'a',name:'旧',packId:'default',analysis:'自定义分析',outputFormat:'自定义格式'});
    assert.equal(old.injectionMode,'full');
    const module={...old,injectionMode:'guidance'};
    const prompt=plannerPrompt({reasoning:[],spark:[]},DEFAULT_PROMPTS,5,[{...module,...module.versions[0]}]);
    assert.ok(prompt.includes('自定义分析'));assert.ok(prompt.includes('自定义格式'));assert.ok(prompt.includes('<guidance>'));
    assert.deepEqual(importPack(exportPack([],[],[],{id:'default',name:'包'},[module])).analysisModules,[module]);
});
test('manual new chat: selection/guidance/empty plans use no Planner; no duplicate or stale injection',async()=>{
    const f=fixture();
    f.flow.editDraft({selected:{reasoning:['r'],spark:['s']},discovery:'人工指导'});await f.flow.apply();
    f.send('首次玩家消息');await f.intercept().done;
    assert.equal(f.calls(),0);assert.deepEqual(f.lore().map(e=>e.content),['R_BODY','S_BODY','人工指导']);
    assert.equal(f.lore().length,3);assert.ok(f.entries.every(e=>e.disable));
    f.flow.finishGeneration(true);assert.equal(f.lore().length,0);
    f.flow.editDraft({selected:{reasoning:[],spark:['s']},discovery:''});await f.flow.apply();
    f.send('第二轮');await f.intercept().done;assert.deepEqual(f.lore().map(e=>e.content),['S_BODY']);
    f.flow.finishGeneration(true);f.flow.clearDraft();await f.flow.apply();
    f.send('第三轮');await f.intercept().done;assert.equal(f.lore().length,0);assert.equal(f.calls(),0);
});
test('manual guidance only and no scheme on subsequent round never call Planner',async()=>{
    const f=fixture();f.flow.editDraft({discovery:'唯一指导'});await f.flow.apply();f.send('one');await f.intercept().done;
    assert.deepEqual(f.lore().map(e=>e.content),['唯一指导']);f.flow.finishGeneration(true);
    f.send('two');await f.intercept().done;assert.equal(f.lore().length,0);assert.equal(f.calls(),0);
});
test('manual native generate works even without a player message or planning history',async()=>{
    const f=fixture();f.flow.editDraft({discovery:'greeting guidance'});await f.flow.apply();
    await f.intercept().done;assert.deepEqual(f.lore().map(e=>e.content),['greeting guidance']);
    f.c.chat.push({is_user:false,mes:'greeting'});f.flow.finishGeneration(false);
    assert.equal(f.flow.current().generationFailed,true);await f.intercept('regenerate').done;assert.equal(f.calls(),0);
    f.flow.finishGeneration(true);await f.intercept().done;assert.equal(f.lore().length,0);
});
test('unapplied changes block native send rather than silently using the applied copy',async()=>{
    const f=fixture();f.flow.editDraft({discovery:'old'});await f.flow.apply();f.flow.editDraft({discovery:'new'});f.send('input');
    const request=f.intercept();await request.done;assert.ok(request.aborted());assert.equal(f.lore().length,0);
    await f.flow.apply();await f.intercept().done;assert.equal(f.lore()[0].content,'new');
});
test('review resumes original normal/swipe/regenerate/continue operation with latest confirmed assets',async()=>{
    for(const type of ['normal','swipe','regenerate','continue']) {
        const f=fixture('review');f.send('input');
        const request=await reviewing(f,type);assert.equal(f.calls(),1);assert.equal(f.flow.active,null);assert.equal(f.flow.pending.type,type);
        const original=f.flow.current().raw;
        f.flow.editDraft({selected:{reasoning:['r'],spark:[]},discovery:'确认内容'});f.entries[0].content='LATEST_BODY';
        await f.flow.resume();await request.done;
        assert.equal(f.calls(),1);assert.ok(!request.aborted());assert.equal(f.c.chat.length,1);
        assert.deepEqual(f.lore().map(e=>e.content),['LATEST_BODY','确认内容']);assert.equal(f.flow.current().raw,original);
    }
});
test('cancel and invalid review targets never activate, including late Planner completion',async()=>{
    for(const change of ['cancel','input','reply','chat','world','persona']) {
        const f=fixture('review');f.send('input');const request=await reviewing(f);
        if(change==='cancel')f.flow.cancel();
        else {
            if(change==='input')f.c.chat[0].mes='edited';
            if(change==='reply')f.c.chat.push({mes:'changed target'});
            if(change==='chat'){f.c.chatId='b';f.c.chatMetadata={};}
            if(change==='world')f.config.world='other';
            if(change==='persona')f.c.powerUserSettings={persona_description:'changed persona'};
            await assert.rejects(f.flow.resume(),/变化/);
        }
        await request.done;assert.ok(request.aborted());assert.equal(f.lore().length,0);
    }
});
test('deleted, disabled or model-inapplicable selection during review requires reconfirmation',async()=>{
    for(const change of ['deleted','disabled','version']) {
        const f=fixture('review');f.send('input');const request=await reviewing(f);
        if(change==='deleted')f.entries.splice(0,1);
        if(change==='disabled')f.entries[0][KEY].enabled=false;
        if(change==='version')f.entries[0][KEY].versions=[{id:'only',tagId:'missing',body:'wrong'}];
        await assert.rejects(f.flow.resume(),/不可用/);assert.ok(f.flow.pending);assert.deepEqual(f.flow.current().selected.reasoning,[]);
        await f.flow.resume();await request.done;assert.ok(!request.aborted());assert.ok(!f.lore().some(e=>e.content==='R_BODY'));
    }
});
test('Generation failure cleans active scan but retains confirmed plan for native retry',async()=>{
    const f=fixture('auto');f.send('input');await f.intercept().done;const plan=f.flow.current();
    f.flow.finishGeneration(false);assert.equal(f.lore().length,0);assert.equal(plan.generationFailed,true);
    await f.intercept('regenerate').done;assert.equal(f.calls(),1);assert.ok(f.lore().length);
    f.flow.finishGeneration(true);f.send('new input');await f.intercept().done;assert.equal(f.calls(),2);
});
test('in-flight scans stay frozen through edits and finishing does not consume a newer manual draft',async()=>{
    const f=fixture();f.flow.editDraft({selected:{reasoning:['r'],spark:[]},discovery:'old'});await f.flow.apply();f.send('input');await f.intercept().done;
    f.entries[0].content='edited';f.flow.editDraft({discovery:'next'});
    assert.deepEqual(f.lore().map(e=>e.content),['R_BODY','old']);
    f.flow.finishGeneration(true);assert.equal(f.flow.current().consumed,false);assert.equal(f.flow.current().discovery,'next');
});
test('Planner failure preserves manual draft and Planner response cannot overwrite concurrent manual editing',async()=>{
    const f=fixture('auto');f.send('input');f.flow.editDraft({discovery:'keep'});
    f.c.generateQuietPrompt=async()=>{throw new Error('network');};await assert.rejects(f.flow.plan(),/network/);assert.equal(f.flow.current().discovery,'keep');
    let finish;f.c.generateQuietPrompt=()=>new Promise(r=>{finish=r;});
    const planning=f.flow.plan();while(!finish)await new Promise(r=>setImmediate(r));
    f.flow.editDraft({discovery:'edited during planning'});finish('[spark:][reasoning skill:]result');
    await assert.rejects(planning,/草稿已修改/);assert.equal(f.flow.current().discovery,'edited during planning');
});
test('cancel during async apply never registers a late applied plan',async()=>{
    const f=fixture();f.flow.editDraft({discovery:'pending'});let finish;
    f.world.ensureDiscovery=()=>new Promise(r=>{finish=r;});const applying=f.flow.apply();
    while(!finish)await new Promise(r=>setImmediate(r));f.flow.cancel();finish();
    await assert.rejects(applying,/取消/);assert.equal(f.flow.current(),null);assert.equal(f.lore().length,0);
});
test('late apply cannot modify a new chat draft even when old selections are invalid',async()=>{
    const f=fixture();f.flow.editDraft({selected:{reasoning:['missing'],spark:[]}});let finish;
    f.world.entries=()=>new Promise(r=>{finish=r;});const applying=f.flow.apply();
    while(!finish)await new Promise(r=>setImmediate(r));
    f.c.chatId='b';f.c.chatMetadata={};f.flow.editDraft({discovery:'new chat draft'});
    finish(structuredClone(f.entries));await assert.rejects(applying,/切换/);assert.equal(f.flow.current().discovery,'new chat draft');
});
test('a second native submission invalidates the old review and does not launch another Planner',async()=>{
    const f=fixture('review');f.send('original');const original=await reviewing(f);
    f.send('changed target');const second=f.intercept();await second.done;await original.done;
    assert.ok(second.aborted());assert.ok(original.aborted());assert.equal(f.calls(),1);assert.equal(f.flow.active,null);
});
test('Planner timeout stops the native request while preserving an existing manual draft',async()=>{
    const f=fixture('auto');f.send('input');f.flow.editDraft({discovery:'manual draft'});f.config.timeout=.001;
    f.c.generateQuietPrompt=()=>new Promise((_resolve,reject)=>{f.c.stopGeneration=()=>{f.flow.stopped();reject(new Error('timeout'));};});
    await assert.rejects(f.flow.plan(),/timeout/);assert.equal(f.flow.current().discovery,'manual draft');assert.equal(f.flow.store().history[0].status,'failed');
});
