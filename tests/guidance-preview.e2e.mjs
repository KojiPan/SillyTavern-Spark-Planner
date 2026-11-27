// Disposable host and fixed local provider responses only. Never use a daily ST data root.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const calls=[],errors=[],checks=[],label=process.env.ST_TEST_LABEL || '1.19.1',out=`test-results/guidance-preview/${label}`;
if(!/^[\w.-]+$/.test(label))throw new Error('Invalid test label');await mkdir(out,{recursive:true});
let answer='';
const api=createServer(async(req,res)=>{let body='';for await(const p of req)body+=p;const data=JSON.parse(body),planner=data.messages?.at(-1)?.content.includes('Reasoning Skill 选择');calls.push({planner,messages:data.messages});res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:planner?`[reasoning skill:001][spark:001]\n${answer}`:'FIXTURE_STORY'},finish_reason:'stop'}]}));});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const url=process.env.ST_TEST_URL || 'http://127.0.0.1:8041';
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:url});
page.on('pageerror',e=>errors.push(e.stack));const panel=page.locator('#spark-planner'),modal=()=>page.locator('.spark-editor-dialog').last();
async function open(){if(!await panel.isVisible()){await page.locator('#extensionsMenuButton').click();await page.locator('#spark-planner-wand').click();}}
async function closeRead(){assert.equal(await modal().locator('.spark-editor-body textarea').count(),0);assert.equal(await modal().getByText('返回',{exact:true}).count(),1);await modal().locator('.popup-button-cancel').click();await page.locator('.spark-editor-dialog').waitFor({state:'detached'});}
async function generate(text){await page.evaluate(async text=>{document.querySelector('#send_textarea').value=text;await SillyTavern.getContext().generate('normal');},text);await page.waitForFunction(()=>!document.body.dataset.generating);await page.waitForTimeout(120);}
async function preview(expected,assembly=false){
    let viewer;
    if(assembly){await page.locator('[data-tab=history]').click();const record=page.locator('[data-history-id]').first();if(!await record.evaluate(n=>n.open))await record.locator(':scope > summary').click();await record.getByRole('button',{name:'查看装配快照',exact:true}).click();viewer=modal().locator('[data-injection-viewer]');}
    else{const details=page.locator('[data-all-materials]');if(!await details.evaluate(n=>n.open))await details.locator(':scope > summary').click();viewer=details;await viewer.locator('[data-injection-viewer]').waitFor();}
    const data=await viewer.locator('[data-injection-index]').evaluateAll(nodes=>nodes.map(n=>({index:Number(n.dataset.injectionIndex),content:n.querySelector('[data-injection-body]').sparkRaw ?? n.querySelector('[data-injection-body]').textContent})).sort((a,b)=>a.index-b.index));
    assert.deepEqual(data.map(i=>i.content),expected);assert.equal(await viewer.locator('textarea,.spark-text-stats').count(),0);
    await viewer.getByRole('button',{name:'复制全部正文',exact:true}).click();assert.equal((await page.evaluate(()=>navigator.clipboard.readText())).replace(/\r\n/g,'\n'),expected.join('\n\n'));
    if(assembly){await closeRead();await page.locator('[data-tab=current]').click();}
}

try {
    await page.goto(url);await page.waitForFunction(()=>window.sparkPlannerIntercept && SillyTavern.getContext().characters.length);await page.waitForFunction(()=>!document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display==='none');
    await page.evaluate(async apiUrl=>{
        let c=SillyTavern.getContext();await c.selectCharacterById(0);$('#main_api').val('openai').trigger('change');c=SillyTavern.getContext();
        Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:apiUrl,custom_model:'gpt-4o',stream_openai:false,openai_max_tokens:1024});(await import('/script.js')).setOnlineStatus('fixture');
        const {DEFAULT_PROMPTS}=await import('/scripts/extensions/third-party/spark-planner/core.js'),s=c.extensionSettings.spark_planner;
        Object.assign(s,{enabled:true,world:'Spark-Guidance-Fix',discoveryId:'',runMode:'auto',channelId:'',modelTags:[],prompts:{...DEFAULT_PROMPTS},timeout:15,maxTokens:2048,contextMode:'native'});
        const {Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js'),w=window.__gWorld=new Worldbook(()=>SillyTavern.getContext(),()=>s);
        await c.saveWorldInfo(s.world,{entries:{}},true);await c.updateWorldInfoList();await w.ensureDiscovery();
        await w.importSkills([{id:'r',type:'reasoning',title:'方法',body:'REASONING_BODY',recommendation:'推荐条件'},{id:'s',type:'spark',title:'火花',body:'SPARK_BODY'}]);
        for(const m of await w.analysisModules())await w.removeAnalysisModule(m.id);
        for(const injectionMode of ['full','guidance','view'])await w.upsertAnalysisModule({id:injectionMode,name:`旧${injectionMode}模块`,packId:'default',injectionMode,analysis:'USER_ANALYSIS',outputFormat:'USER_FORMAT'});
        c.chat.splice(0);c.chatMetadata.spark_planner={plans:{},history:[]};c.chatMetadata.world_info=s.world;
        window.__gScans=[];window.__gGenerationScans=[];c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA,(_data,dry)=>{if(!dry)window.__gGenerationScans.push(structuredClone(window.__gScans.at(-1)));});c.eventSource.makeLast(c.eventTypes.WORLDINFO_ENTRIES_LOADED,lore=>window.__gScans.push(structuredClone((lore.chatLore || []).filter(e=>e.spark_planner?.owner==='spark_planner'))));
    },`http://127.0.0.1:${api.address().port}/v1`);
    await open();await page.locator('[data-close]').click();await open();
    const scenarios=[['none','PRIVATE_ANALYSIS 候选构思 审美筛选 输出协议'.repeat(80),''],['one','PRIVATE_ANALYSIS<guidance>ONE_GUIDANCE</guidance>OUTSIDE_ANALYSIS','ONE_GUIDANCE'],['many','PRIVATE_ANALYSIS<guidance>FIRST_GUIDANCE</guidance>OUTSIDE_ANALYSIS<guidance>SECOND_GUIDANCE</guidance>','FIRST_GUIDANCE\n\nSECOND_GUIDANCE'],['unclosed','PRIVATE_ANALYSIS<guidance>UNCLOSED',''],['nested','<guidance>OUTER<guidance>INNER</guidance>END</guidance>',''],['again-one','<guidance>PREVIOUS_GUIDANCE</guidance>','PREVIOUS_GUIDANCE'],['clear-next','PRIVATE_ANALYSIS WITHOUT_TAGS','']];
    for(const [name,raw,guidance] of scenarios){answer=raw;const before=calls.length;await generate(`INPUT_${name}`);assert.equal(calls.length,before+2);
        const expected=['REASONING_BODY','SPARK_BODY',...(guidance?[guidance]:[])],record=await page.evaluate(()=>structuredClone(SillyTavern.getContext().chatMetadata.spark_planner.history[0]));
        assert.equal(record.raw,`[reasoning skill:001][spark:001]\n${raw}`);assert.equal(record.generation.discovery,guidance);assert.deepEqual(record.generation.items.map(i=>i.content),expected);
        assert.deepEqual(await page.evaluate(()=>window.__gGenerationScans.at(-1).map(e=>e.content)),expected);
        const story=JSON.stringify(calls.at(-1).messages);for(const excluded of ['PRIVATE_ANALYSIS','OUTSIDE_ANALYSIS','UNCLOSED','OUTER','INNER'])assert.ok(!story.includes(excluded));assert.ok(!story.includes('"position"'));assert.ok(!story.includes('仅预览插件'));
        await preview(expected);await preview(expected,true);
        if(!guidance)assert.ok((await page.locator('[data-all-materials]').textContent()).includes('本轮无有效创作指导。'));
        checks.push(`fixed response ${name}: request/scan/snapshot/preview/clipboard agree`);
    }
    await page.locator('[data-setting=runMode]').selectOption('manual');await page.locator('[data-edit-guidance]').click();await modal().locator('[data-field=text]').fill('HANDWRITTEN_GUIDANCE\n'+'line\n'.repeat(80));await modal().locator('.popup-button-ok').click();await modal().waitFor({state:'detached'});await page.locator('[data-action=apply]').click();await page.waitForFunction(()=>SillyTavern.getContext().chatMetadata.spark_planner.draft.applied);
    const before=calls.length;await generate('MANUAL_INPUT');assert.equal(calls.length,before+1);assert.ok(JSON.stringify(calls.at(-1).messages).includes('HANDWRITTEN_GUIDANCE'));checks.push('handwritten guidance injects directly without Planner or tags');
    await page.locator('[data-tab=library]').click();await page.locator('[data-category-group="未分类"] > summary').click();await page.locator('[data-skill-card=r] [data-skill-title]').click();
    const input=modal().locator('[data-field=body]'),handle=input.locator('..').locator('.spark-resize-handle');await handle.scrollIntoViewIfNeeded();
    const old=await input.evaluate(n=>n.getBoundingClientRect().height),box=await handle.boundingBox();await page.mouse.move(box.x+12,box.y+12);await page.mouse.down();await page.mouse.move(box.x+12,box.y+112,{steps:10});await page.mouse.up();
    const height=await input.evaluate(n=>n.getBoundingClientRect().height);assert.ok(height>old+70);
    await input.fill('RESIZED_BODY');await page.waitForTimeout(850);assert.ok(Math.abs(await input.evaluate(n=>n.getBoundingClientRect().height)-height)<2);
    assert.match(await modal().locator('.spark-field:has([data-field=body]) .spark-text-stats').textContent(),/^Token：\d[\d,]*$/);
    const field=modal().locator('.spark-field:has([data-field=body])');await field.getByRole('button',{name:'放大',exact:true}).click();const large=modal().locator('[data-field=text]');await large.fill('ENLARGED_BODY');await modal().locator('.popup-button-ok').click();
    assert.equal(await input.inputValue(),'ENLARGED_BODY');assert.ok(Math.abs(await input.evaluate(n=>n.getBoundingClientRect().height)-height)<2);
    const id=await modal().getAttribute('data-id');await modal().locator('.popup-button-ok').click();await page.locator(`dialog[data-id="${id}"]`).waitFor({state:'detached'});
    await page.locator('[data-skill-card=r] [data-skill-title]').click();assert.ok(Math.abs(await modal().locator('[data-field=body]').evaluate(n=>n.getBoundingClientRect().height)-height)<2);
    const touchHandle=modal().locator('[data-field=recommendation]').locator('..').locator('.spark-resize-handle');await touchHandle.scrollIntoViewIfNeeded();
    const touchBox=await touchHandle.boundingBox(),rec=modal().locator('[data-field=recommendation]'),recBefore=await rec.evaluate(n=>n.getBoundingClientRect().height),cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:touchBox.x+12,y:touchBox.y+12}]});for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touchBox.x+12,y:touchBox.y+12+i*9}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.ok(await rec.evaluate(n=>n.getBoundingClientRect().height)>recBefore+50);
    assert.ok(await modal().locator('.spark-editor-body').evaluate(n=>n.scrollHeight>n.clientHeight));await page.screenshot({path:`${out}/resized-mobile.png`});await modal().locator('.popup-button-cancel').click();
    checks.push('mouse and trusted touch resize; token refresh/save/reopen/enlargement preserve height; outer editor still scrolls');
    await page.locator('[data-tab=library]').click();await page.locator('[data-library-tab=modules]').click();await page.locator('[data-analysis-module=full] .spark-title-button').click();assert.equal(await modal().locator('[data-field=injectionMode]').count(),0);assert.equal(await modal().locator('[data-field=analysis]').inputValue(),'USER_ANALYSIS');assert.equal(await modal().locator('[data-field=outputFormat]').inputValue(),'USER_FORMAT');await modal().locator('.popup-button-cancel').click();
    checks.push('legacy mode UI removed; original module prompts and formats preserved');
    await page.locator('[data-tab=current]').click();const details=page.locator('[data-all-materials]');if(!await details.evaluate(n=>n.open))await details.locator(':scope > summary').click();await page.screenshot({path:`${out}/preview-mobile.png`});
    const reader=page.locator('[data-page=current]');await reader.evaluate(n=>{n.scrollTop=300;});const reading=await reader.boundingBox(),scrollBefore=await reader.evaluate(n=>n.scrollTop);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:reading.x+80,y:reading.y+300}]});for(let i=1;i<=10;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:reading.x+80,y:reading.y+300-i*15}]});await page.waitForTimeout(15);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(150);
    assert.ok(await reader.evaluate(n=>n.scrollTop)>scrollBefore+30);assert.equal(await reader.locator('textarea:visible').count(),0);checks.push('long guidance/materials use the page scroller and contain no metadata editor');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,requests:calls.length,errors}));
} catch(e){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw e;}
finally{await writeFile(`${out}/result.json`,JSON.stringify({checks,calls,errors},null,2));await browser.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
