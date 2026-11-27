import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, DEFAULT_PROMPTS } from '../core.js';
import { Worldbook } from '../worldbook.js';
import { Workflow } from '../workflow.js';
import { migratePacks, enabledPackIds, preparePackImport } from '../packs.js';
import { exportPack, importPack, toMarkdown, fromMarkdown, validateSkill } from '../skill-pack.js';

const tags=[{id:'tag',name:'Flash',groups:[['flash']],priority:1}];
const skill={id:'stable',type:'reasoning',title:'同名标题',category:'同名分类',enabled:true,
    native:{position:7,role:2,depth:7,order:42,probability:35,useProbability:false,outletName:'Body',triggers:['normal','swipe'],characterFilter:{isExclude:true,names:['X']}},
    versions:[{id:'base',tagId:null,body:'BODY',recommendation:'REC',ecotEnabled:true,ecotText:'QUESTION',ecotOutlet:'EcoT'},
        {id:'flash',tagId:'tag',body:'BODY_FLASH',recommendation:'REC_FLASH',ecotEnabled:true,ecotText:'QUESTION_FLASH',ecotOutlet:'Flash'}]};
async function fixture(fn) {
    let data={entries:{99:{uid:99,content:'ordinary',comment:'手工条目',spark_planner:{id:'stable'}}}},fail=false;
    const config={world:'test',categories:['旧空分类'],enabled:true,reasoningLimit:5,timeout:5,modelTags:tags,prompts:{...DEFAULT_PROMPTS}};
    const c={chatId:'a',characterId:0,mainApi:'openai',getChatCompletionModel:()=> 'flash-model',chat:[{is_user:true,mes:'input'}],chatMetadata:{},
        loadWorldInfo:async()=>structuredClone(data),getRequestHeaders:()=>({}),saveChat:async()=>{},saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},
        stopGeneration:()=>{},deactivateSendButtons:()=>{},eventTypes:{WORLDINFO_UPDATED:'updated',CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{emit:async()=>{},makeLast:()=>{},removeListener:()=>{}},
        generateQuietPrompt:async()=> '[reasoning skill:001][spark:001,002,003,004]\n三、心理发现\nresult'};
    const world=new Worldbook(()=>c,()=>config);
    world.api=async()=>({worldInfoCache:{set:()=>{}},createWorldInfoEntry:(_name,d)=>{let uid=0;while(Object.hasOwn(d.entries,uid))uid++;return d.entries[uid]={uid};}});
    const flow=new Workflow(()=>c,()=>config,world);
    const oldFetch=globalThis.fetch;
    globalThis.fetch=async(url,options)=>url.endsWith('/get')?{ok:true,json:async()=>structuredClone(data)}:fail?{ok:false,status:503}:(data=structuredClone(JSON.parse(options.body).data),{ok:true});
    try{await fn({world,flow,c,config,data:()=>data,fail:v=>{fail=v;}});}finally{globalThis.fetch=oldFetch;}
}
const owned=data=>Object.values(data.entries).filter(e=>e[KEY]?.owner===KEY);
const scan=flow=>{const lore={chatLore:[],globalLore:[]};flow.lore(lore);return [...lore.chatLore,...lore.globalLore].filter(e=>e[KEY]?.kind!=='discovery');};

test('migration adopts the entire old library once, preserving IDs, versions, native attributes, companions and history',async()=>fixture(async({world,flow,c,data,config})=>{
    await world.upsert(skill);
    // Simulate an actual pre-pack world rather than an already normalized fixture.
    const raw=data();delete raw[KEY];for(const e of owned(raw))delete e[KEY].packId;
    const original=structuredClone(raw), history={id:'old',raw:'original',request:{messages:[{role:'user',content:'frozen'}]}};
    c.chatMetadata[KEY]={plans:{},history:[history]};const before=JSON.stringify(c.chatMetadata);
    const state=await world.packState();assert.equal(state.packs.length,1);assert.ok(state.packs[0].categories.includes('旧空分类'));
    const normalized=structuredClone(data());delete normalized[KEY];for(const e of owned(normalized))delete e[KEY].packId;
    assert.deepEqual(normalized,original);assert.equal(JSON.stringify(c.chatMetadata),before);
    const once=structuredClone(data());await world.packState();assert.deepEqual(data(),once);
    assert.deepEqual((await world.skills())[0].versions,validateSkill(skill).versions);assert.deepEqual(config.categories,['旧空分类']);
}));

test('three enabled packs form one numbered catalog, with one combined three-spark cap and no package internals in prompt',async()=>fixture(async({world,flow,c})=>{
    await world.upsert(skill);for(const id of ['shangzhou','nr'])await world.savePack({id,name:id,categories:['同名分类']});
    for(const [i,packId] of ['default','shangzhou','nr','nr'].entries())await world.upsert({id:'spark-'+i,title:'火花'+i,type:'spark',body:'BODY_'+i,packId});
    await world.defaultPacks(['default','shangzhou','nr']);const plan=await flow.plan();
    assert.deepEqual(plan.selected.spark,['spark-0','spark-1','spark-2']);assert.equal(plan.modelResolution.skills.length,5);
    flow.setEnabledPacks(['default','nr']);const candidates=await flow.candidateSkills();assert.ok(!candidates.some(s=>s.packId==='shangzhou'));
    assert.equal((await world.skills()).find(s=>s.id==='spark-1').enabled,true);
    assert.equal(c.chatMetadata[KEY].enabledPackIds.length,2);
}));

test('chat overrides and global inheritance are independent; none enabled and master off preserve stored choices',async()=>fixture(async({world,flow,c,config})=>{
    await world.upsert(skill);await world.savePack({id:'other',name:'其他'});await world.defaultPacks(['default','other']);await flow.loadPackState();
    const chatA=c.chatMetadata;flow.setEnabledPacks(['default']);assert.deepEqual([...enabledPackIds(flow.packState,flow.store())],['default']);
    c.chatId='b';c.chatMetadata={};assert.deepEqual([...enabledPackIds(flow.packState,flow.store())],['default','other']);flow.setEnabledPacks([]);assert.equal((await flow.candidateSkills()).length,0);
    c.chatId='a';c.chatMetadata=chatA;assert.deepEqual([...enabledPackIds(flow.packState,flow.store())],['default']);
    config.enabled=false;const before=JSON.stringify(flow.store().enabledPackIds);flow.cancel();assert.equal(JSON.stringify(flow.store().enabledPackIds),before);
    flow.setEnabledPacks(null);assert.deepEqual([...enabledPackIds(flow.packState,flow.store())],['default','other']);
}));

test('moving after a plan preserves parent/companion UID, all versions, insertion settings and original request/history; live affiliation revokes injection',async()=>fixture(async({world,flow,data})=>{
    await world.upsert(skill);await world.savePack({id:'off',name:'尚州包',categories:['目标分类']});
    const plan=await flow.plan(), history=structuredClone(flow.store().history);plan.request={sent:'immutable'};
    const original=structuredClone((await world.skills())[0]), native=structuredClone(owned(data()));
    await world.upsert({...original,packId:'off',category:'目标分类'});
    const moved=(await world.skills())[0];assert.equal(moved.id,original.id);assert.deepEqual(moved.native,original.native);assert.deepEqual(moved.versions,original.versions);
    for(const old of native.filter(e=>['skill','ecot'].includes(e[KEY].kind)))assert.equal(owned(data()).find(e=>e[KEY].id===old[KEY].id).uid,old.uid);
    assert.equal(owned(data()).filter(e=>e[KEY].kind==='ecot').length,1);assert.deepEqual(flow.store().history,history);
    await flow.intercept([],1,assert.fail,'swipe');assert.equal(scan(flow).length,0);assert.match(plan.lastGeneration.skills[0].reason,/尚州包.*未启用/);
    assert.deepEqual(plan.request,{sent:'immutable'});assert.deepEqual(plan.original.selected.reasoning,['stable']);
    flow.setEnabledPacks(['default','off']);await flow.intercept([],1,assert.fail,'regenerate');assert.equal(scan(flow).length,2);
    flow.setEnabledPacks(['default']);assert.equal(scan(flow).length,2,'current request keeps its activation');
    await flow.intercept([],1,assert.fail,'regenerate');assert.equal(scan(flow).length,0,'next request reads the changed pack selection');
    assert.equal(data().entries[99].content,'ordinary');
}));

test('categories with equal names are scoped per pack and empty categories survive export',async()=>fixture(async({world})=>{
    await world.upsert(skill);await world.savePack({id:'b',name:'B',categories:['同名分类','空分类']});
    await world.upsert({...skill,id:'b-skill',packId:'b'});await world.category('同名分类','更名','default');
    const skills=await world.skills();assert.equal(skills.find(s=>s.id==='stable').category,'更名');assert.equal(skills.find(s=>s.id==='b-skill').category,'同名分类');
    const state=await world.packState();assert.ok(state.packs.find(p=>p.id==='b').categories.includes('同名分类'));
    await world.category('更名','未分类','default');assert.equal((await world.skills()).find(s=>s.id==='b-skill').category,'同名分类');
}));

test('package v3 ZIP and Markdown roundtrip metadata, tags and all Skill fields; conflicting imports explicitly remap without overwrites',async()=>fixture(async({world,flow})=>{
    await world.upsert(skill);const state=await world.packState(), pack=state.packs[0], current=await world.skills();
    const exported=importPack(exportPack(current,pack.categories,tags,pack));assert.deepEqual(exported.pack,pack);assert.deepEqual(exported[0],validateSkill(current[0]));assert.deepEqual(exported.modelTags,tags);
    const md=fromMarkdown(toMarkdown(current[0],tags,pack));assert.deepEqual(md.pack,pack);assert.equal(md.packId,pack.id);
    let serial=0;const prepared=preparePackImport(exported.pack,exported,state,current,()=>`new-${++serial}`);assert.equal(prepared.changes.length,2);
    await world.importSkills(prepared.skills,undefined,false,prepared.pack);const after=await world.skills();assert.equal(after.length,2);assert.equal(after.find(s=>s.packId==='default').id,'stable');
    assert.deepEqual(after.find(s=>s.packId===prepared.pack.id).versions,current[0].versions);assert.equal((await flow.candidateSkills()).length,1);
    const empty={id:'empty',name:'空包',description:'保留空分类',categories:['空分类']};assert.deepEqual(importPack(exportPack([],empty.categories,[],empty)).pack.categories,['未分类','空分类']);
}));

test('failed import/move is atomic; deleting a pack removes only its owned parents and companions, retains histories and one valid pack',async()=>fixture(async({world,flow,data,fail})=>{
    await world.upsert(skill);await world.savePack({id:'b',name:'B'});const before=structuredClone(data());fail(true);
    await assert.rejects(world.upsert({...skill,packId:'b'}),/503/);assert.deepEqual(data(),before);
    await assert.rejects(world.importSkills([{...skill,id:'new',packId:'c'}],undefined,false,{id:'c',name:'C'}),/503/);assert.deepEqual(data(),before);fail(false);
    const plan=await flow.plan(), history=structuredClone(flow.store().history);await world.removePack('default');
    assert.equal((await world.skills()).length,0);assert.equal(data().entries[99].content,'ordinary');assert.deepEqual(flow.store().history,history);
    await flow.intercept([],1,assert.fail,'regenerate');assert.equal(scan(flow).length,0);assert.match(plan.lastGeneration.skills[0].reason,/已删除/);
    await assert.rejects(world.removePack('b'),/至少保留/);
}));

test('unknown registry versions fail explicitly rather than replacing existing data',()=>{
    const data={entries:{},[KEY]:{packVersion:99,packs:[{id:'keep',name:'Keep'}]}};const before=structuredClone(data);
    assert.throws(()=>migratePacks(data),/不受支持/);assert.deepEqual(data,before);
});

test('reimporting a deleted pack cannot reactivate a stale chat override',()=>{
    const state={packVersion:1,packs:[{id:'keep',name:'保留包'}],defaultEnabledPackIds:['keep'],retiredPackIds:['deleted']};
    const prepared=preparePackImport({id:'deleted',name:'旧包'},[],state,[],()=> 'fresh');
    assert.equal(prepared.pack.id,'fresh');state.packs.push(prepared.pack);
    assert.deepEqual([...enabledPackIds(state,{enabledPackIds:['deleted']})],[]);
});
