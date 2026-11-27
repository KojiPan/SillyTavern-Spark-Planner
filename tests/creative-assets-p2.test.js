import test from 'node:test';
import assert from 'node:assert/strict';
import { Workflow } from '../workflow.js';
import { KEY, DEFAULT_PROMPTS } from '../core.js';
import { assembleInjection, injectionText } from '../injection.js';

function fixture(mode='auto') {
    let calls=0,model='base',raw='[reasoning skill:001][spark:001,002,003,004]GUIDANCE';
    const config={enabled:true,world:'book',runMode:mode,reasoningLimit:1,timeout:5,prompts:{...DEFAULT_PROMPTS},modelTags:[{id:'special',name:'专用',groups:[['special']]}]};
    const skills=[{id:'r',type:'reasoning',title:'方法',body:'R'},...Array.from({length:5},(_,i)=>({id:`s${i}`,type:'spark',title:`火花${i}`,body:`S${i}`}))].map(s=>({...s,enabled:true,packId:'default',recommendation:'条件'}));
    const entries=skills.map((s,i)=>({uid:i,comment:s.title,content:s.body,disable:true,world:'book',position:4,role:0,order:100,depth:2,[KEY]:{owner:KEY,kind:'skill',id:s.id,type:s.type,packId:'default',enabled:true}}));
    entries.push({uid:6,comment:'指导',content:'OLD_MIRROR',world:'book',position:4,role:0,depth:0,disable:true,[KEY]:{owner:KEY,kind:'discovery',id:'g'}});
    const c={chatId:'a',characterId:0,chat: [{is_user:true,mes:'input'}],chatMetadata:{},mainApi:'openai',getChatCompletionModel:()=>model,
        saveMetadataDebounced:()=>{},saveChat:async()=>{},stopGeneration:()=>{},deactivateSendButtons:()=>{},
        eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{makeLast:()=>{},removeListener:()=>{}},generateQuietPrompt:async()=>{calls++;return raw;}};
    const state={packs:[{id:'default',name:'包',categories:['未分类']}],defaultEnabledPackIds:['default']};
    const world={packState:async()=>structuredClone(state),skills:async()=>structuredClone(skills),entries:async()=>structuredClone(entries),ensureDiscovery:async()=>{},syncEcot:async()=>{},analysisModules:async()=>[]};
    const flow=new Workflow(()=>c,()=>config,world);
    const intercept=async(type='normal')=>{let aborted=false;await flow.intercept([],1,()=>{aborted=true;},type);return aborted;};
    const lore=()=>{const l={chatLore:[]};flow.lore(l);return l.chatLore;};
    return {flow,c,config,skills,entries,world,state,intercept,lore,calls:()=>calls,model:v=>{model=v;},raw:v=>{raw=v;}};
}

test('required/excluded are deterministic, frozen per request, and required materials do not consume autonomous caps',async()=>{
    const f=fixture();f.flow.setPolicy('s0','required');f.flow.setPolicy('s4','excluded');
    const material=await f.flow.plannerMaterial({modelId:'base'},f.config.modelTags);
    assert.deepEqual(material.catalog.spark.map(s=>s.id),['s1','s2','s3']);
    assert.ok(f.flow.requiredNote(material.required).includes('火花0'));assert.ok(!f.flow.requiredNote(material.required).includes('S0'));
    await f.intercept();assert.deepEqual(f.flow.current().selected.spark,['s1','s2','s3','s0']);
    assert.deepEqual(f.flow.current().original.selected.spark,['s1','s2','s3']);assert.ok(!f.flow.current().selected.spark.includes('s4'));
    assert.ok(f.skills.every(s=>s.enabled));f.flow.captureGeneration();f.flow.finishGeneration(false);
    assert.equal(f.flow.policies().s0,'required');await f.intercept('regenerate');assert.equal(f.calls(),1);
    f.flow.captureGeneration();f.flow.finishGeneration(true);assert.deepEqual(f.flow.policies(),{});
});

test('invalid required material fails before Planner, while policies survive review/replanning and stay per chat/world',async()=>{
    const f=fixture();f.flow.setPolicy('missing','required');await assert.rejects(f.flow.plan(),/必选条目不可用/);assert.equal(f.calls(),0);
    f.flow.clearPolicies();f.flow.setPolicy('s0','excluded');await f.flow.plan({apply:false});await f.flow.plan({apply:false});assert.equal(f.flow.policies().s0,'excluded');
    f.c.chatId='b';assert.deepEqual(f.flow.policies(),{});f.c.chatId='a';f.config.world='other';assert.deepEqual(f.flow.policies(),{});
});

test('only request boundary records actual bodies; later edits/deletion cannot alter history, and native retries create independent records',async()=>{
    const f=fixture();await f.intercept();assert.equal(f.flow.store().history[0].generation,undefined);
    const preview=await f.flow.previewInjection(), provided=f.lore();
    f.flow.captureGeneration({model:'actual-model'});const record=f.flow.store().history[0],before=structuredClone(record.generation);
    assert.deepEqual(before.items.map(i=>i.content),provided.map(e=>e.content));assert.deepEqual(preview.items.map(i=>i.content),provided.map(e=>e.content));
    assert.equal(before.model.modelId,'actual-model');assert.equal(before.items[0].entry.depth,2);
    f.entries[0].content='EDITED';f.entries.splice(1,1);f.flow.editDraft({discovery:'NEW_GUIDANCE'});
    assert.deepEqual(record.generation,before);f.flow.finishGeneration(true);assert.equal(record.generation.status,'succeeded');
    assert.equal(f.flow.current().consumed,false);await assert.rejects(f.flow.apply(),/不可用/);await f.flow.apply();await f.intercept('regenerate');f.flow.captureGeneration();f.flow.finishGeneration(false);
    assert.equal(f.flow.store().history.length,2);assert.equal(record.generation.items[0].content,'R');
});

test('snapshot reuse survives deleted assets, preserves insertion/version/body, and never writes to material storage',async()=>{
    const f=fixture();await f.intercept();f.flow.captureGeneration();f.flow.finishGeneration(true);const source=f.flow.store().history[0],before=structuredClone(source);
    f.entries.splice(0);let writes=0;f.world.ensureDiscovery=async()=>{writes++;};f.world.syncEcot=async()=>{writes++;};
    await f.flow.reuse(source.id,'snapshot');await f.flow.apply();await f.intercept('regenerate');
    assert.deepEqual(f.lore().map(e=>e.content),source.generation.items.map(i=>i.content));assert.equal(writes,0);assert.deepEqual(source,before);
    assert.equal(f.calls(),1);assert.equal(f.lore()[0].depth,2);
    f.flow.finishGeneration(true);f.flow.editDraft({discovery:'EDITED_GUIDANCE'});await f.flow.apply();await f.intercept('regenerate');assert.ok(f.lore().some(e=>e.content==='EDITED_GUIDANCE'));
});

test('latest reuse resolves current body/model version and reports deleted IDs without replacing selection',async()=>{
    const f=fixture();await f.intercept();f.flow.captureGeneration();f.flow.finishGeneration(true);const source=f.flow.store().history[0];
    f.entries[0][KEY].versions=[{id:'default',tagId:null,body:'R'},{id:'special-v',tagId:'special',body:'SPECIAL'}];f.model('special');
    await f.flow.reuse(source.id);await f.flow.apply();await f.intercept('regenerate');assert.equal(f.lore()[0].content,'SPECIAL');f.flow.finishGeneration(true);
    f.entries.splice(0,1);const plan=await f.flow.reuse(source.id);assert.ok(plan.selected.reasoning.includes('r'));assert.ok(plan.reuseWarnings.some(s=>s.id==='r'));
    assert.equal(f.calls(),1);
});

test('preview excludes tag-external text and uses frozen snapshot after live assets change',async()=>{
    const f=fixture('manual');f.flow.editDraft({selected:{reasoning:['r'],spark:[]},discovery:'DELIVERED'});
    const a=await f.flow.previewInjection();assert.ok(injectionText(a).includes('DELIVERED'));assert.ok(!injectionText(a).includes('OLD_MIRROR'));
    f.flow.editDraft({discovery:'UPDATED'});const b=await f.flow.previewInjection();assert.ok(injectionText(b).includes('UPDATED'));assert.ok(!injectionText(b).includes('DELIVERED'));
    assert.equal(b.tokens.total,b.tokens.reasoning+b.tokens.spark+b.tokens.guidance);assert.ok(b.tokens.estimated);
    assert.deepEqual(assembleInjection({...f.flow.current(),entries:f.entries},f.state).items.map(i=>i.content),b.items.map(i=>i.content));
});

test('native body regenerate bypasses Planner; explicit replan executes it in the original native operation',async()=>{
    const f=fixture();await f.intercept();f.flow.captureGeneration();f.flow.finishGeneration(true);
    f.c.generate=async type=>{assert.equal(type,'regenerate');return f.intercept(type);};
    await f.flow.generateWithPlan();assert.equal(f.calls(),1);f.flow.captureGeneration();f.flow.finishGeneration(true);
    await f.flow.generateWithPlan({replan:true});assert.equal(f.calls(),2);assert.equal(f.c.chat.length,1);
});

test('retention only trims on insertion; cancellation is recorded and newer in-flight policies survive earlier success',async()=>{
    const f=fixture();f.config.historyLimit=2;f.flow.setPolicy('r','required');await f.intercept();f.flow.captureGeneration();f.flow.setPolicy('s0','excluded');f.flow.finishGeneration(true);
    assert.equal(f.flow.policies().s0,'excluded');await f.intercept('regenerate');f.flow.captureGeneration();f.flow.cancel({stop:false});assert.equal(f.flow.store().history[0].generation.status,'cancelled');
    await f.flow.plan();assert.equal(f.flow.store().history.length,2);
});

test('cost and injection previews do not create a draft or suppress the first automatic Planner call',async()=>{
    const f=fixture();await f.flow.previewInjection();await f.flow.plannerPreview();assert.equal(f.flow.current(),null);assert.equal(f.flow.store().draft,undefined);
    await f.intercept();assert.equal(f.calls(),1);
});

test('required and excluded policy also guards manual edits to an AI scheme before its first successful generation',async()=>{
    const f=fixture();f.flow.setPolicy('r','required');f.flow.setPolicy('s4','excluded');await f.flow.plan({apply:false});
    f.flow.editDraft({selected:{reasoning:[],spark:['s4']}});await f.flow.apply();assert.deepEqual(f.flow.current().selected,{reasoning:['r'],spark:[]});
    await f.intercept('regenerate');f.flow.captureGeneration();f.flow.finishGeneration(true);
    f.flow.editDraft({selected:{reasoning:[],spark:[]}});await f.flow.apply();assert.deepEqual(f.flow.current().selected,{reasoning:[],spark:[]});
});

test('historically empty guidance retains its insertion template for later editing and snapshot selection cannot introduce absent materials',async()=>{
    const f=fixture('manual');f.flow.editDraft({selected:{reasoning:['r'],spark:[]},discovery:''});await f.flow.apply();await f.intercept();f.flow.captureGeneration();f.flow.finishGeneration(true);
    const source=f.flow.store().history[0];assert.ok(!source.generation.items.some(i=>i.kind==='discovery'));
    await f.flow.reuse(source.id,'snapshot');f.flow.editDraft({discovery:'ADDED'});await f.flow.apply();await f.intercept('regenerate');assert.ok(f.lore().some(e=>e.content==='ADDED'));f.flow.finishGeneration(true);
    f.flow.editDraft({selected:{reasoning:['r'],spark:['s1']}});await assert.rejects(f.flow.apply(),/历史快照不包含新增选择/);
});

test('late historical restore cannot overwrite a draft in another chat',async()=>{
    const f=fixture();await f.intercept();f.flow.captureGeneration();f.flow.finishGeneration(true);const id=f.flow.store().history[0].id;
    let finish;f.world.entries=()=>new Promise(r=>{finish=r;});const reuse=f.flow.reuse(id);
    while(!finish)await new Promise(r=>setImmediate(r));f.c.chatId='b';f.c.chatMetadata={};f.flow.editDraft({discovery:'B'});finish([]);
    await assert.rejects(reuse,/聊天、绑定或草稿已变化/);assert.equal(f.flow.current().discovery,'B');
});
