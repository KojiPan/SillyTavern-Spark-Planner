import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, DEFAULT_PROMPTS, freezeCatalog, plannerPrompt } from '../core.js';
import { Worldbook } from '../worldbook.js';
import { Workflow } from '../workflow.js';
import { validateSkill, exportPack, importPack, fromMarkdown, toMarkdown } from '../skill-pack.js';

const tags=[{id:'flash',name:'Flash',groups:[['flash']],priority:0}];
const skill={id:'reasoning-stable',title:'专项判断',type:'reasoning',category:'来源',enabled:true,
    native:{position:4,role:0,depth:2,order:123,probability:87},versions:[
        {id:'default',tagId:null,body:'BODY_DEFAULT',recommendation:'REC_DEFAULT',ecotEnabled:true,ecotText:'QUESTION_DEFAULT\n第二行',ecotOutlet:'EcoT'},
        {id:'flash-v',tagId:'flash',body:'BODY_FLASH',recommendation:'REC_FLASH',ecotEnabled:true,ecotText:'QUESTION_FLASH',ecotOutlet:'FlashThought'},
    ]};

async function fixture(run) {
    const ordinary={uid:9,content:'ordinary',position:7,outletName:'EcoT',[KEY]:{kind:'ecot',id:'ecot:reasoning-stable',skillId:skill.id}};
    const books={a:{entries:{9:ordinary}},b:{entries:{9:structuredClone(ordinary)}}};
    const config={world:'a',enabled:true,autoContinue:true,reasoningLimit:1,timeout:5,prompts:{...DEFAULT_PROMPTS},modelTags:tags};
    let calls=0,model='default-model',fail=false,creationFail=false,writes=0;
    const notices=[];
    const c={mainApi:'openai',getChatCompletionModel:()=>model,chatId:'one',chat:[{is_user:true,mes:'测试输入'}],chatMetadata:{},
        chatCompletionSettings:{prompts:[{content:'<ecot>{{outlet::EcoT}}</ecot>'}]},
        getRequestHeaders:()=>({}),loadWorldInfo:async name=>structuredClone(books[name]),
        saveChat:async()=>{},saveMetadataDebounced:()=>{},saveSettingsDebounced:()=>{},stopGeneration:()=>{},deactivateSendButtons:()=>{},
        eventTypes:{WORLDINFO_UPDATED:'updated',CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{emit:async()=>{},makeLast:()=>{},removeListener:()=>{}},
        generateQuietPrompt:async()=>{calls++;return '[reasoning skill:001]\n[spark:]\n三、心理发现\n发现';}};
    const world=new Worldbook(()=>c,()=>config);
    world.api=async()=>({worldInfoCache:{set:()=>{}},createWorldInfoEntry:(_name,data)=>{
        if(creationFail===true || creationFail==='ecot' && Object.values(data.entries).some(e=>e[KEY]?.kind==='skill'))return undefined;
        let uid=0;while(Object.hasOwn(data.entries,uid))uid++;
        return data.entries[uid]={uid,constant:false,position:0,key:[],disable:false};
    }});
    const flow=new Workflow(()=>c,()=>config,world,(...args)=>notices.push(args));
    const fetchBefore=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
        const body=JSON.parse(options.body);
        if(url.endsWith('/get'))return {ok:true,json:async()=>structuredClone(books[body.name])};
        if(fail)return {ok:false,status:503};
        writes++;books[body.name]=structuredClone(body.data);return {ok:true};
    };
    try { await run({world,flow,c,config,books,ordinary,notices,calls:()=>calls,writes:()=>writes,
        model:value=>{model=value;},fail:value=>{fail=value;},creationFail:value=>{creationFail=value;}}); }
    finally {globalThis.fetch=fetchBefore;}
}
const owned=(books,name='a')=>Object.values(books[name].entries).filter(e=>e[KEY]?.owner===KEY);
const loreOf=flow=>{const lore={chatLore:[],globalLore:[]};flow.lore(lore);return lore.chatLore.filter(e=>e[KEY].kind!=='discovery');};

test('ECoT is optional version content; legacy/spark behavior and versioned Markdown/ZIP round trips survive',()=>{
    const old=validateSkill({id:'old',type:'reasoning',title:'旧 Skill',body:'原文',native:{position:7,outletName:'original'}});
    assert.equal(old.versions[0].ecotEnabled,false);assert.equal(old.versions[0].ecotOutlet,'EcoT');assert.equal(old.native.outletName,'original');
    const spark=validateSkill({...skill,type:'spark'});assert.ok(spark.versions.every(v=>!('ecotEnabled' in v)));
    for(const s of [skill,{...skill,versions:skill.versions.slice(1)},old,spark]){
        const result=importPack(exportPack([s],['来源'],tags))[0];assert.deepEqual(result,validateSkill(s));
        const md=fromMarkdown(toMarkdown(s,tags));delete md.modelTags;assert.deepEqual(md,validateSkill(s));
    }
    const catalog=freezeCatalog([validateSkill(skill)]), prompt=plannerPrompt(catalog,DEFAULT_PROMPTS,1);
    assert.equal(catalog.reasoning.length,1);assert.ok(!prompt.includes('QUESTION_'));assert.ok(!prompt.includes('BODY_'));
});

test('owned companion is created/updated atomically, linked by stable ID, deduplicated, disabled and deleted with parent',async()=>fixture(async({world,books,ordinary})=>{
    await world.upsert(skill);
    let records=owned(books),parent=records.find(e=>e[KEY].kind==='skill'),child=records.find(e=>e[KEY].kind==='ecot');
    assert.equal(records.length,2);assert.equal(child[KEY].skillId,skill.id);assert.equal(child.position,7);assert.equal(child.order,100);assert.equal(child.probability,100);assert.equal(child.disable,true);
    assert.equal(parent.position,4);assert.equal(parent.depth,2);assert.equal(parent.order,123);assert.equal(child.content,skill.versions[0].ecotText);
    const uid=child.uid, update=structuredClone(skill);update.versions[0].ecotText='UPDATED';update.versions[0].ecotOutlet='NewOutlet';
    await world.upsert(update);await world.upsert(update);await world.category('来源','目标');
    child=owned(books).find(e=>e[KEY].kind==='ecot');assert.equal(child.uid,uid);assert.equal(child.content,'UPDATED');assert.equal(child.outletName,'NewOutlet');
    books.a.entries[20]={...structuredClone(child),uid:20};await world.syncEcot();assert.equal(owned(books).length,2);
    update.versions.forEach(v=>{v.ecotEnabled=false;});await world.upsert(update);
    child=owned(books).find(e=>e[KEY].kind==='ecot');assert.equal(child.disable,true);assert.deepEqual(child[KEY].enabledVersionIds,[]);
    await world.remove(skill.id);assert.equal(owned(books).length,0);assert.deepEqual(books.a.entries[9],ordinary);
}));

test('legacy Reasoning keeps its snapshot without ECoT writes; deleted Skills are unavailable for subsequent Swipe',async()=>fixture(async({world,flow,books,writes})=>{
    await world.upsert({id:skill.id,title:'旧方法',type:'reasoning',body:'LEGACY_BODY'});await flow.plan();
    const before=writes();await flow.intercept([],1,assert.fail,'swipe');assert.equal(writes(),before);assert.equal(loreOf(flow).length,1);assert.equal(loreOf(flow)[0].content,'LEGACY_BODY');
    assert.ok(!owned(books).some(e=>e[KEY].kind==='ecot'));
    await world.remove(skill.id);await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);assert.match(flow.current().lastGeneration.skills[0].reason,/已删除/);
}));

test('Planner, manual selection, restore and history reuse share one choice and activate both scan copies',async()=>fixture(async({world,flow,books})=>{
    await world.upsert(skill);await flow.plan();
    assert.deepEqual(flow.current().selected,{reasoning:[skill.id],spark:[]});
    await flow.intercept([],1,assert.fail,'swipe');let lore=loreOf(flow);
    assert.equal(lore.length,2);assert.equal(lore[0].content,'BODY_DEFAULT');assert.equal(lore[0].depth,2);assert.equal(lore[1].outletName,'EcoT');assert.ok(lore.every(e=>!e.disable));assert.ok(owned(books).every(e=>e.disable));
    const plan=structuredClone(flow.current());plan.selected.reasoning=[];await flow.apply(plan);await flow.intercept([],1,assert.fail,'regenerate');assert.equal(loreOf(flow).length,0);
    Object.assign(plan,plan.original);await flow.apply(plan);await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,2);
    const original=flow.current().id;flow.finishGeneration(true);await flow.reuse(original);await flow.apply();await flow.intercept([],1,assert.fail,'regenerate');assert.equal(loreOf(flow).length,2);assert.notEqual(flow.current().id,original);
}));

test('Swipe re-resolves whole model version without Planner; no applicable version, pack/skill/master off and deletion cannot leak ECoT',async()=>fixture(async({world,flow,config,books,c,model,calls})=>{
    await world.upsert({...skill,versions:skill.versions.slice(1)});model('flash');await flow.plan();
    const history=structuredClone(flow.store().history[0]);await flow.intercept([],1,assert.fail,'swipe');
    let lore=loreOf(flow);assert.equal(lore[0].content,'BODY_FLASH');assert.equal(lore[1].content,'QUESTION_FLASH');assert.equal(lore[1].outletName,'FlashThought');
    model('unknown');await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);assert.ok(flow.active.generationResolution.skills[0].reason);
    model('flash');await world.upsert({...skill,versions:skill.versions.slice(1),enabled:false});await flow.intercept([],1,assert.fail,'regenerate');assert.equal(loreOf(flow).length,0);
    await world.upsert({...skill,versions:skill.versions.slice(1)});config.world='b';await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);
    config.world='a';config.enabled=false;await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);
    config.enabled=true;await world.remove(skill.id);await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);assert.ok(!owned(books).some(e=>e[KEY].kind==='ecot'));
    assert.equal(calls(),1);assert.deepEqual(flow.store().history[0],history);
    c.chatId='new-chat';c.chatMetadata={};flow.cancel();assert.equal(loreOf(flow).length,0);
}));

test('new requests resolve latest body and ECoT together; turning ECoT off or empty affects the next request',async()=>fixture(async({world,flow})=>{
    await world.upsert(skill);await flow.plan();
    const update=structuredClone(skill);update.versions[0].ecotEnabled=false;await world.upsert(update);
    await flow.intercept([],1,assert.fail,'swipe');let lore=loreOf(flow);assert.equal(lore.length,1);assert.equal(lore[0].content,'BODY_DEFAULT');
    update.versions[0].ecotEnabled=true;update.versions[0].ecotText=' ';await world.upsert(update);
    await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,1);
    update.versions[0].ecotText='NEW_QUESTION';update.versions[0].body='NEW_BODY';await world.upsert(update);
    await flow.intercept([],1,assert.fail,'swipe');lore=loreOf(flow);assert.equal(lore[0].content,'NEW_BODY');assert.equal(lore[1].content,'NEW_QUESTION');
    await flow.apply(flow.current());await flow.intercept([],1,assert.fail,'swipe');lore=loreOf(flow);assert.equal(lore[0].content,'NEW_BODY');assert.equal(lore[1].content,'NEW_QUESTION');
}));

test('editing and toggling materials preserves the active execution and historical planning snapshot',async()=>fixture(async({world,flow})=>{
    await world.upsert(skill);const plan=await flow.plan(), historical=structuredClone(plan.entries);
    await flow.intercept([],1,assert.fail,'swipe');const active=structuredClone(flow.active);
    const update=structuredClone(skill);update.versions[0].body='NEXT_BODY';update.versions[0].ecotText='NEXT_ECOT';
    await world.upsert(update);flow.setEnabledPacks([]);
    assert.deepEqual(flow.active,active);assert.deepEqual(plan.entries,historical);
    assert.equal(loreOf(flow)[0].content,'BODY_DEFAULT');assert.equal(loreOf(flow)[1].content,'QUESTION_DEFAULT\n第二行');
    await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);
    flow.setEnabledPacks(['default']);await flow.intercept([],1,assert.fail,'swipe');
    assert.equal(loreOf(flow)[0].content,'NEXT_BODY');assert.equal(loreOf(flow)[1].content,'NEXT_ECOT');
    flow.cancel();assert.equal(loreOf(flow).length,0);assert.ok(owned({a:(await world.read()).data}).every(e=>e.disable));
}));

test('cross-book/category moves and reimport retain association and create exactly one local companion',async()=>fixture(async({world,flow,config,books})=>{
    await world.upsert(skill);await flow.plan();await world.category('来源','新分类');
    const packed=importPack(exportPack(await world.skills(),['新分类'],tags));
    config.world='b';await world.importSkills(packed);await world.importSkills(packed);await world.syncEcot();
    assert.equal((await world.skills()).length,1);assert.equal((await world.skills())[0].category,'新分类');
    assert.equal(owned(books,'b').filter(e=>e[KEY].kind==='ecot').length,1);
    await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0); // Plans belong to the bound book.
    config.world='a';await world.remove(skill.id);assert.ok(!owned(books).some(e=>e[KEY].kind==='ecot'));
    config.world='b';await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,0);
}));

test('creation/save/synchronization failures are visible and abort generation with neither part active; missing companions can be repaired',async()=>fixture(async({world,flow,books,fail,creationFail,notices})=>{
    creationFail(true);await assert.rejects(world.upsert(skill),/创建/);assert.equal(owned(books).length,0);creationFail(false);
    creationFail('ecot');await assert.rejects(world.upsert(skill),/ECoT Outlet/);assert.equal(owned(books).length,0);creationFail(false);
    await world.upsert(skill);await flow.plan();await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,2);
    const child=owned(books).find(e=>e[KEY].kind==='ecot');delete books.a.entries[child.uid];fail(true);
    let aborted=false;await flow.intercept([],1,()=>{aborted=true;},'swipe');assert.equal(aborted,true);assert.equal(flow.active,null);assert.equal(loreOf(flow).length,0);
    assert.ok(notices.some(([message])=>/ECoT 同步失败.*503/.test(message)));assert.match(flow.current().lastGeneration.error,/503/);
    fail(false);await flow.intercept([],1,assert.fail,'swipe');assert.equal(loreOf(flow).length,2);assert.equal(flow.syncError,'');
    const before=structuredClone(books.a);fail(true);await assert.rejects(world.remove(skill.id),/503/);assert.deepEqual(books.a,before);
}));

test('debug names the version, paired activation, native Outlet and missing preset consumer without relocating content',async()=>fixture(async({world,flow,model,c})=>{
    await world.upsert(skill);await flow.plan();model('flash');await flow.intercept([],1,assert.fail,'swipe');
    const d=flow.active.generationResolution.skills[0];assert.equal(d.versionId,'flash-v');assert.equal(d.mainEnabled,true);assert.equal(d.ecotEnabled,true);assert.equal(d.outletName,'FlashThought');assert.match(d.outletDiagnostic,/未找到引用/);
    assert.equal(loreOf(flow)[1].position,7);assert.equal(loreOf(flow)[1].outletName,'FlashThought');
    c.chatCompletionSettings.prompts.push({content:'{{OUTLET:: FlashThought }}'});await flow.intercept([],1,assert.fail,'swipe');assert.match(flow.active.generationResolution.skills[0].outletDiagnostic,/包含引用/);
}));
