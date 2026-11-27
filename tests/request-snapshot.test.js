import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_PROMPTS, plannerPrompt, plannerSections, KEY } from '../core.js';
import { inspectPlannerRequest } from '../planner-context.js';
import { Workflow } from '../workflow.js';
import { requestText, requestCharacters } from '../request-viewer.js';

test('new assembly retains custom global sections; existing historical prompt fixtures remain untouched',async()=>{
    const fixtures=JSON.parse(await readFile(new URL('./prompt-assembly.fixture.json',import.meta.url),'utf8'));
    const before=structuredClone(fixtures);
    for(const {input} of fixtures){
        const {catalog,prompts,limit,modules}=input;
        const prompt=plannerPrompt(catalog,prompts,limit,modules);
        const sections=plannerSections(catalog,prompts,limit,modules);
        assert.equal(sections.length,5);assert.deepEqual(sections.map(s=>s.order),[1,2,3,4,5]);
        assert.equal(sections.map(s=>s.content).filter(Boolean).join('\n\n'),prompt);
        assert.equal(sections[0].content,prompts.task || '');assert.ok(sections[3].content.includes(prompts.protocol || ''));assert.ok(sections[3].content.includes('<guidance>'));
        if(modules?.length)assert.match(sections[2].content,/<analysis_modules>/);
    }
    assert.deepEqual(fixtures,before);
});

test('boundary capture clones complete message order/content and allowlists parameters without credentials',()=>{
    const messages=[{role:'system',content:'preset + character + world'},{role:'user',content:[{type:'text',text:'input'}]},{role:'assistant',content:'history',name:'speaker',tool_calls:[{id:'tool',function:{name:'example',arguments:'{}'}}]},{role:'user',content:'TASK'}];
    const data={messages,model:'planner-id',max_tokens:123,temperature:.4,secret_id:'SECRET_SENTINEL',proxy_password:'SECRET_SENTINEL',headers:{Authorization:'SECRET_SENTINEL'},custom_include_body:'SECRET_SENTINEL',custom_url:'https://secret.test'};
    let snapshot;inspectPlannerRequest(messages,{contextMode:'native'},s=>snapshot=s,data,'service-send-request');
    const before=structuredClone(snapshot);messages[0].content='mutated';data.temperature=2;
    assert.deepEqual(snapshot,before);assert.equal(snapshot.plannerModelId,'planner-id');assert.equal(snapshot.parameters.temperature,.4);
    assert.ok(!JSON.stringify(snapshot).includes('SECRET_SENTINEL'));assert.ok(!JSON.stringify(snapshot).includes('secret.test'));
    assert.ok(snapshot.boundaryNote.includes('服务端'));
    const text=requestText(snapshot);assert.ok(text.indexOf('system')<text.indexOf('assistant'));assert.ok(text.includes('preset + character + world'));assert.ok(text.includes('input'));assert.ok(text.includes('tool_calls'));assert.ok(text.includes('speaker'));
    assert.ok(requestCharacters(snapshot)>30);assert.equal(requestText(null),'此记录未保存实际请求');
});

test('failed Planner retains the exact captured request in existing history; edits cannot rebuild it',async()=>{
    const settings={enabled:true,world:'book',reasoningLimit:5,timeout:5,prompts:{...DEFAULT_PROMPTS},modelTags:[],analysisModules:[{id:'off',name:'disabled',enabled:false,analysis:'NEVER'}]};
    let finalize,saveCount=0;
    const c={mainApi:'openai',getChatCompletionModel:()=> 'generation-id',chatId:'chat',chat:[{is_user:true,mes:'input'}],chatMetadata:{},
        eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{makeLast:(_e,fn)=>{finalize=fn;},removeListener:()=>{}},saveMetadataDebounced:()=>saveCount++,stopGeneration:()=>{},
        generateQuietPrompt:async()=>{const data={model:'planner-actual',temperature:.6,messages:[{role:'system',content:'ORIGINAL_CONTEXT'},{role:'user',content:'input'}]};finalize(data);data.messages[0].content='LATER_MUTATION';throw new Error('fixture API failure');}};
    const world={skills:async()=>[{id:'stable',type:'spark',title:'one skill',recommendation:'condition',body:'body'}]};
    const flow=new Workflow(()=>c,()=>settings,world);await assert.rejects(flow.plan(),/fixture API failure/);
    const record=flow.store().history[0],request=structuredClone(record.request);
    assert.equal(record.status,'failed');assert.equal(request.messages[0].content,'ORIGINAL_CONTEXT');assert.equal(request.generationModelId,'generation-id');assert.equal(request.plannerModelId,'planner-actual');
    assert.equal(request.catalog.spark[0].id,'stable');assert.equal(request.catalog.spark[0].number,'001');assert.equal(request.modules[0].enabled,false);assert.equal(record.requestDiagnostics.error,'fixture API failure');assert.ok(saveCount>=3);
    settings.prompts.task='NEW SETTINGS';settings.analysisModules=[];assert.deepEqual(record.request,request);
    const restored=JSON.parse(JSON.stringify(c.chatMetadata));assert.deepEqual(restored[KEY].history[0].request,request);
});
