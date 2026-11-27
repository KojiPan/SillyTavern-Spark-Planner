// Disposable SillyTavern host and local fake provider only.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const calls=[],errors=[],checks=[];
const label=process.env.ST_TEST_LABEL || 'latest';
if(!/^[a-zA-Z0-9._-]+$/.test(label))throw new Error('Invalid test label');
const results=`test-results/round-control/${label}`;
let failStory=false;
const api=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;
    const data=JSON.parse(body),planner=data.messages?.at(-1)?.content.includes('Reasoning Skill 选择');
    calls.push({planner,data});
    if(!planner && failStory){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'fixture generation failure'}}));return;}
    const text=planner?'[reasoning skill:001][spark:001]\n### 全文模块\n<guidance>FULL_GUIDANCE</guidance>\n### 标签模块\nPRIVATE_ANALYSIS<guidance>EXTRACTED_GUIDANCE</guidance>OUTSIDE_ANALYSIS\n### 查看模块\nVIEW_PRIVATE VIEW_TAG_PRIVATE':'P1_STORY';
    res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:text},finish_reason:'stop'}]}));
});
await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));
const apiUrl=`http://127.0.0.1:${api.address().port}/v1`;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
page.on('pageerror',e=>errors.push(e.stack));
const panel=page.locator('#spark-planner');
const textOf=call=>JSON.stringify(call.data.messages);
async function open(){if(!await panel.isVisible()){await page.locator('#extensionsMenuButton').click();await page.locator('#spark-planner-wand').click();}await page.locator('[data-tab=current]').click();}
async function idle(){await page.waitForFunction(()=>!document.body.dataset.generating);await page.waitForTimeout(80);}
async function start(text,type='normal'){
    await page.evaluate(({text,type})=>{document.querySelector('#send_textarea').value=text;window.__roundDone=false;void SillyTavern.getContext().generate(type).finally(()=>{window.__roundDone=true;});},{text,type});
}
async function done(){await page.waitForFunction(()=>window.__roundDone);await idle();}
async function choices(change){await page.locator('[data-adjust-selection]').click();for(const group of await page.locator('[data-choice-category]').all())if(!await group.evaluate(n=>n.open))await group.locator('summary').click();await change();await page.locator('.spark-editor-dialog[open]').last().locator('.popup-button-cancel').click();}
async function guidance(text){await page.locator('[data-edit-guidance]').click();const editor=page.locator('.spark-editor-dialog[open]').last();await editor.locator('[data-field=text]').fill(text);await editor.locator('.popup-button-ok').click();await editor.waitFor({state:'detached'});}
async function extra(action){const menu=page.locator('.spark-run-footer [data-more]');if(!await menu.evaluate(n=>n.open))await menu.locator('summary').click();await page.locator('[data-action='+action+']').click();}
async function reset(mode){await page.evaluate(mode=>{
    const c=SillyTavern.getContext();c.chat.splice(0);c.chatMetadata.spark_planner={plans:{},history:[]};c.extensionSettings.spark_planner.runMode=mode;
    document.querySelector('#send_textarea').value='';
},mode);await page.locator('[data-close]').click();await panel.waitFor({state:'hidden'});await open();await page.waitForTimeout(100);}
try {
    await page.goto(process.env.ST_TEST_URL || 'http://127.0.0.1:8041');
    await page.waitForFunction(()=>window.sparkPlannerIntercept && SillyTavern.getContext().characters.length);
    await page.waitForFunction(()=>!document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display==='none');
    await page.evaluate(async apiUrl=>{
        let c=SillyTavern.getContext();await c.selectCharacterById(0);$('#main_api').val('openai').trigger('change');c=SillyTavern.getContext();
        Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:apiUrl,custom_model:'round-fixture',stream_openai:false,openai_max_tokens:1024});
        (await import('/script.js')).setOnlineStatus('round-connected');
        const {DEFAULT_PROMPTS}=await import('/scripts/extensions/third-party/spark-planner/core.js');
        const s=c.extensionSettings.spark_planner;Object.assign(s,{enabled:true,world:'Spark-Round-P1-E2E',discoveryId:'',runMode:'manual',channelId:'',contextMode:'native',prompts:{...DEFAULT_PROMPTS},timeout:20,maxTokens:2048,reasoningLimit:1,modelTags:[]});
        const {Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js');window.__roundWorld=new Worldbook(()=>SillyTavern.getContext(),()=>s);
        await c.saveWorldInfo(s.world,{entries:{}},true);await c.updateWorldInfoList();await window.__roundWorld.ensureDiscovery();
        for(const skill of [{id:'r',type:'reasoning',title:'方法',body:'REASONING_BODY'},{id:'s',type:'spark',title:'火花',body:'SPARK_BODY'}])await window.__roundWorld.addSkill(skill);
        for(const module of await window.__roundWorld.analysisModules())await window.__roundWorld.removeAnalysisModule(module.id);
        for(const [i,name] of ['全文模块','标签模块','查看模块'].entries())await window.__roundWorld.upsertAnalysisModule({id:`m${i}`,name,packId:'default',order:i,injectionMode:['full','guidance','view'][i],analysis:`CUSTOM_ANALYSIS_${i}`,outputFormat:`### ${name}`});
        c.chatMetadata.world_info=s.world;c.chat.splice(0);c.chatMetadata.spark_planner={plans:{},history:[]};
    },apiUrl);
    await open();
    await choices(async()=>{await page.locator('[data-id=r]').check();await page.locator('[data-id=s]').check();});await guidance('MANUAL_GUIDANCE');
    await page.locator('[data-action=apply]').click();await page.waitForFunction(()=>SillyTavern.getContext().chatMetadata.spark_planner.draft?.applied);
    assert.equal(calls.length,0);await start('MANUAL_FIRST_INPUT');await done();
    assert.equal(calls.length,1);assert.ok(!calls[0].planner);
    for(const text of ['REASONING_BODY','SPARK_BODY','MANUAL_GUIDANCE'])assert.ok(textOf(calls[0]).includes(text));
    checks.push('new chat manual selection + guidance, zero Planner calls');
    await choices(()=>page.locator('[data-id=s]').uncheck());await page.locator('[data-action=apply]').click();await start('MANUAL_SECOND_INPUT');await done();
    assert.ok(!textOf(calls.at(-1)).includes('SPARK_BODY'));assert.ok(textOf(calls.at(-1)).includes('REASONING_BODY'));
    await extra('clear');await start('MANUAL_EMPTY_INPUT');await done();
    for(const text of ['REASONING_BODY','SPARK_BODY','MANUAL_GUIDANCE'])assert.ok(!textOf(calls.at(-1)).includes(text));
    checks.push('remove selection and clear scheme remove stale injection');
    await reset('auto');let before=calls.length;await start('AUTO_INPUT');await done();
    assert.equal(calls.length,before+2);assert.ok(calls[before].planner);assert.ok(!calls[before+1].planner);
    for(const text of ['FULL_GUIDANCE','EXTRACTED_GUIDANCE','REASONING_BODY','SPARK_BODY'])assert.ok(textOf(calls.at(-1)).includes(text));
    for(const text of ['PRIVATE_ANALYSIS','OUTSIDE_ANALYSIS','VIEW_PRIVATE','VIEW_TAG_PRIVATE','<guidance>'])assert.ok(!textOf(calls.at(-1)).includes(text));
    checks.push('auto one Planner + one Generation; legacy mode fields ignored, tag-only guidance');
    await reset('review');before=calls.length;await start('REVIEW_INPUT');
    await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
    assert.equal(calls.length,before+1);assert.equal(await page.locator('[data-guidance-reader]').evaluate(n=>n.sparkRaw),'FULL_GUIDANCE\n\nEXTRACTED_GUIDANCE');
    await guidance('EDITED_CONFIRMED_GUIDANCE');await choices(()=>page.locator('[data-id=s]').uncheck());
    const raw=await page.locator('[data-raw]').textContent();assert.ok(raw.includes('PRIVATE_ANALYSIS'));
    await page.locator('[data-close]').click();await panel.waitFor({state:'hidden'});await open();assert.equal(await page.locator('[data-guidance-reader]').evaluate(n=>n.sparkRaw),'EDITED_CONFIRMED_GUIDANCE');
    await page.evaluate(async()=>{const skill=(await window.__roundWorld.skills()).find(s=>s.id==='r');await window.__roundWorld.upsert({...skill,body:'LATEST_CONFIRMED_BODY',versions:skill.versions.map(v=>({...v,body:'LATEST_CONFIRMED_BODY'}))});});
    await mkdir(results,{recursive:true});await page.screenshot({path:`${results}/mobile-review.png`});
    await page.locator('[data-action=resume]').click();await done();assert.equal(calls.length,before+2);
    assert.ok(textOf(calls.at(-1)).includes('EDITED_CONFIRMED_GUIDANCE'));assert.ok(textOf(calls.at(-1)).includes('LATEST_CONFIRMED_BODY'));assert.ok(!textOf(calls.at(-1)).includes('SPARK_BODY'));
    assert.equal(await page.locator('[data-raw]').textContent(),raw);
    assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>m.mes==='REVIEW_INPUT').length),1);
    checks.push('review pause/close/reopen/edit/latest asset/resume, one player message and unchanged raw');
    // A failed native retry must reuse the scheme, without another Planner.
    failStory=true;before=calls.length;await start('','regenerate');
    // A consumed reviewed scheme reuses the confirmed selection on explicit regeneration.
    await done();assert.equal(calls.length,before+1);failStory=false;
    before=calls.length;await page.locator('[data-action=resume]').click();
    for(let i=0;calls.length===before && i<200;i++)await new Promise(r=>setTimeout(r,50));
    await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='generated');await idle();
    assert.equal(calls.length,before+1);assert.ok(!calls.at(-1).planner);assert.ok(textOf(calls.at(-1)).includes('EDITED_CONFIRMED_GUIDANCE'));
    checks.push('failed Generation cleaned and retried without Planner');
    for(const type of ['continue','regenerate','swipe']) {
        const length=await page.evaluate(()=>{const c=SillyTavern.getContext();c.chatMetadata.spark_planner.draft=null;c.chatMetadata.spark_planner.plans={};return c.chat.length;});
        before=calls.length;await start('',type);await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
        assert.equal(calls.length,before+1);await guidance(`CONFIRMED_${type}`);
        await page.locator('[data-action=resume]').click();await done();assert.equal(calls.length,before+2);
        assert.ok(textOf(calls.at(-1)).includes(`CONFIRMED_${type}`));assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.length),length);
    }
    checks.push('native continue/regenerate/swipe paused and resumed in their original calls');
    await reset('review');before=calls.length;await start('REPLAN_INPUT');await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
    await extra('replan');await page.waitForFunction(()=>SillyTavern.getContext().chatMetadata.spark_planner.history.length===2 && SillyTavern.getContext().chatMetadata.spark_planner.history[0].status==='review');
    assert.equal(calls.length,before+2);await page.locator('[data-action=resume]').click();await done();assert.equal(calls.length,before+3);
    checks.push('replan replaces pending draft while preserving original generation');
    await reset('review');before=calls.length;await start('UNAVAILABLE_INPUT');await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
    await page.evaluate(async()=>{const skill=(await window.__roundWorld.skills()).find(s=>s.id==='r');await window.__roundWorld.upsert({...skill,enabled:false});});
    await page.locator('[data-action=resume]').click();await page.waitForFunction(()=>!document.querySelector('[data-id=r]').checked);
    assert.equal(calls.length,before+1);assert.equal(await panel.getAttribute('data-view-state'),'review');
    await page.locator('[data-action=resume]').click();await done();assert.equal(calls.length,before+2);assert.ok(!textOf(calls.at(-1)).includes('LATEST_CONFIRMED_BODY'));
    await page.evaluate(async()=>{const skill=(await window.__roundWorld.skills()).find(s=>s.id==='r');await window.__roundWorld.upsert({...skill,enabled:true});});
    checks.push('invalid review selection removed visibly and requires reconfirmation before Generation');
    await reset('review');before=calls.length;await start('CANCEL_INPUT');await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
    await page.locator('[data-action=cancel]').click();await done();assert.equal(calls.length,before+1);checks.push('cancel review makes no Generation request');
    await reset('review');before=calls.length;await start('SWITCH_FROM_INPUT');await page.waitForFunction(()=>document.querySelector('#spark-planner').dataset.viewState==='review');
    await page.evaluate(async()=>{const c=SillyTavern.getContext();c.chatMetadata={world_info:c.extensionSettings.spark_planner.world,spark_planner:{plans:{},history:[]}};c.chat.splice(0);await c.eventSource.emit(c.eventTypes.CHAT_CHANGED);});
    await done();assert.equal(calls.length,before+1);assert.ok(!await page.locator('[data-action=resume]').isVisible());
    await page.locator('[data-setting=runMode]').selectOption('manual');await start('SWITCH_TO_INPUT');await done();
    assert.equal(calls.length,before+2);for(const text of ['REASONING_BODY','LATEST_CONFIRMED_BODY','SPARK_BODY','EXTRACTED_GUIDANCE'])assert.ok(!textOf(calls.at(-1)).includes(text));
    checks.push('chat-change event cancels pending generation and does not inject the old scheme');
    assert.ok(await page.evaluate(async()=>(await window.__roundWorld.entries()).filter(e=>e.spark_planner?.owner==='spark_planner').every(e=>e.disable)));
    assert.equal(errors.filter(e=>e.includes('Internal Server Error') && e.includes('sendOpenAIRequest')).length,1);
    assert.deepEqual(errors.filter(e=>!e.includes('Internal Server Error')),[]);console.log(JSON.stringify({checks,requests:calls.length,expectedProviderErrors:errors.length}));
} catch(error){await mkdir(results,{recursive:true});await page.screenshot({path:`${results}/failure.png`}).catch(()=>{});throw error;}
finally {await mkdir(results,{recursive:true});await writeFile(`${results}/provider-requests.json`,JSON.stringify({checks,calls,errors},null,2));await browser.close();api.closeAllConnections();await new Promise(resolve=>api.close(resolve));}
