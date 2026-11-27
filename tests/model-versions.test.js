import test from 'node:test';
import assert from 'node:assert/strict';
import { matchTags, resolveVersion, resolveSkills, generationModel, mergeImportedTags } from '../model-versions.js';
import { validateSkill, exportPack, importPack, toMarkdown, fromMarkdown } from '../skill-pack.js';
import { Workflow } from '../workflow.js';
import { KEY, DEFAULT_PROMPTS } from '../core.js';

const tags=[{id:'a',name:'Argon',groups:[['gemini','argon'],['alternate','a-model']],priority:0},{id:'b',name:'Carbon',groups:[['carbon']],priority:0}];
const version=(id,tagId,priority=0)=>({id,tagId,priority,recommendation:`REC_${id}`,body:`BODY_${id}`});
const skill={id:'logical',type:'spark',title:'唯一标题',enabled:true,versions:[version('default',null),version('argon','a'),version('carbon','b')],native:{position:7,outletName:'test'}};

test('model tags use case-insensitive AND within groups, OR between groups, and tolerate API paths',()=>{
    assert.deepEqual(matchTags('google/GEMINI-4-Argon:preview',tags).map(t=>t.id),['a']);
    assert.equal(matchTags('gemini-4',tags).length,0);
    assert.equal(matchTags('alternate/a-model-suffix',tags).length,1);
    assert.equal(matchTags(null,tags).length,0);
});

test('one logical skill selects one whole version; no-default skills disappear from unmatched catalogs',()=>{
    for(const [model,id] of [['google/gemini-argon','argon'],['carbon','carbon'],['other','default'],[null,'default']]){
        const resolved=resolveSkills([skill],model,tags);assert.equal(resolved.length,1);assert.equal(resolved[0].id,skill.id);
        assert.equal(resolved[0].body,`BODY_${id}`);assert.equal(resolved[0].recommendation,`REC_${id}`);
    }
    const special={...skill,versions:skill.versions.slice(1)};
    assert.equal(resolveSkills([special],'unknown',tags).length,0);
    assert.equal(resolveSkills([special],'gemini/argon/carbon',tags).length,1);
    assert.equal(resolveSkills([{...special,versions:[version('only','a')]}],'carbon',tags).length,0);
});

test('conflicts use version priority, then tag priority, then stable ID, with an explicit tie warning',()=>{
    let s={versions:[version('z','a'),version('a','b')]};
    let r=resolveVersion(s,'gemini-argon-carbon',tags);assert.equal(r.version.id,'a');assert.ok(r.warning);
    r=resolveVersion(s,'gemini-argon-carbon',[{...tags[0],priority:9},tags[1]]);assert.equal(r.version.id,'z');assert.equal(r.warning,'');
    s.versions[1].priority=10;r=resolveVersion(s,'gemini-argon-carbon',[{...tags[0],priority:9},tags[1]]);assert.equal(r.version.id,'a');
});

test('model identity uses the host resolver, never Planner channel, display name or status',async()=>{
    assert.deepEqual(await generationModel(()=>({mainApi:'openai',getChatCompletionModel:()=> 'actual/id',displayName:'alias'})),{modelId:'actual/id',diagnostic:''});
    const unknown=await generationModel(()=>({mainApi:'openai',onlineStatus:'fake',chatCompletionSettings:{custom_model:'stale'},channels:[{model:'planner'}]}));
    assert.equal(unknown.modelId,null);assert.ok(unknown.diagnostic);
});

test('legacy migration and Markdown/ZIP round trips preserve all versions and label definitions',()=>{
    const legacy=validateSkill({id:'old',title:'old',type:'reasoning',body:'\nraw body\n',recommendation:'old rec'});
    assert.equal(legacy.versions[0].body,'\nraw body\n');assert.equal(legacy.versions[0].tagId,null);
    for(const s of [skill,{...skill,versions:skill.versions.slice(1)}]){
        const pack=importPack(exportPack([s],['category'],tags));assert.deepEqual(pack[0],validateSkill(s));assert.deepEqual(pack.modelTags,tags);
        const md=fromMarkdown(toMarkdown(s,tags));assert.deepEqual(md.modelTags,tags);assert.equal(md.versions.length,s.versions.length);
    }
    assert.throws(()=>validateSkill({...skill,versions:[]}),/至少/);
    assert.throws(()=>validateSkill({...skill,versions:[version('a',null),version('b',null)]}),/默认/);
    assert.throws(()=>exportPack([skill]),/缺少模型标签/);
});

test('import conflicts preserve local definitions and remap only imported version references',()=>{
    const incoming=[{...tags[0],groups:[['different']]}], before=structuredClone(tags);
    const result=mergeImportedTags(tags,incoming,[skill],()=> 'new-tag');
    assert.deepEqual(tags,before);assert.equal(result.tags[0].groups[0][1],'argon');assert.equal(result.skills[0].versions[1].tagId,'new-tag');assert.equal(skill.versions[1].tagId,'a');assert.equal(result.changes.length,1);
    assert.throws(()=>mergeImportedTags([],[],[skill]),/不存在/);
});

test('Planner resolves using Generation model, five-section modules; Swipe re-resolves without planning and histories stay immutable',async()=>{
    let model='google/gemini-argon', calls=0, prompt;
    const listeners=new Map(), user={is_user:true,mes:'input'};
    const config={enabled:true,world:'book',timeout:5,autoContinue:true,reasoningLimit:5,prompts:{...DEFAULT_PROMPTS,task:'TASK_SECTION',protocol:'PROTOCOL_SECTION'},modelTags:structuredClone(tags),
        analysisModules:[{id:'module',name:'分析',enabled:true,versions:[{id:'a',tagId:'a',priority:0,analysis:'ANALYSIS_ARGON',outputFormat:'FORMAT_ARGON'},{id:'b',tagId:'b',priority:0,analysis:'ANALYSIS_CARBON',outputFormat:'FORMAT_CARBON'}]},
        {id:'skipped',name:'跳过',enabled:true,versions:[{id:'missing',tagId:'missing',analysis:'NEVER_ANALYSIS',outputFormat:'NEVER_FORMAT'}]}]};
    const c={mainApi:'openai',getChatCompletionModel:()=>model,chat:[user],chatId:'test',chatMetadata:{},saveChat:async()=>{},saveMetadataDebounced:()=>{},stopGeneration:()=>{},deactivateSendButtons:()=>{},
        eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{makeLast:(name,fn)=>listeners.set(name,fn),removeListener:name=>listeners.delete(name)},
        generateQuietPrompt:async()=>{calls++;const payload={messages:[{role:'user',content:'input'}]};await listeners.get('ready')(payload);prompt=payload.messages.at(-1).content;return '[reasoning skill:][spark:001,002]\n三、心理发现\nFINDING';}};
    const entry=s=>({content:s.versions.find(v=>v.tagId==null)?.body || '',comment:s.title,[KEY]:{owner:KEY,kind:'skill',id:s.id,type:s.type,versions:s.versions,enabled:true}});
    const only={...skill,id:'only-a',title:'Only A',versions:[version('only','a')]};
    const world={skills:async()=>[skill,only],entries:async()=>[entry(skill),entry(only)],ensureDiscovery:async()=>{}};
    const flow=new Workflow(()=>c,()=>config,world);await flow.plan();
    assert.equal(calls,1);assert.ok(prompt.includes('REC_argon'));assert.ok(!prompt.includes('REC_carbon'));assert.equal(prompt.split('唯一标题').length,2);assert.ok(!prompt.includes('BODY_'));assert.ok(!prompt.includes('NEVER_'));
    const positions=['TASK_SECTION','唯一标题','ANALYSIS_ARGON','PROTOCOL_SECTION','FORMAT_ARGON'].map(t=>prompt.indexOf(t));assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
    assert.ok(flow.current().modelResolution.modules[1].reason);
    const history=structuredClone(flow.store().history[0]);
    model='carbon';await flow.intercept([],1,assert.fail,'swipe');assert.equal(calls,1);assert.equal(flow.active.entries[0].content,'BODY_carbon');assert.deepEqual(flow.store().history[0],history);
    model='unknown';await flow.intercept([],1,assert.fail,'swipe');assert.equal(flow.active.entries.length,1);assert.ok(flow.active.generationResolution.skills.find(s=>s.id==='only-a').reason);
    config.modelTags[0].groups=[['changed']];assert.deepEqual(flow.store().history[0],history);
    const lore={chatLore:[]};config.enabled=false;flow.lore(lore);assert.equal(lore.chatLore.length,0);
    model='carbon';config.enabled=true;await flow.plan();assert.ok(prompt.includes('ANALYSIS_CARBON'));assert.ok(prompt.includes('FORMAT_CARBON'));assert.ok(!prompt.includes('Only A'));
});
