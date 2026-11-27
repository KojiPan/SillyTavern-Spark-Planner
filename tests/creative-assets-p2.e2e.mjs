// Disposable local ST data root and local provider only; no real model traffic.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const calls=[],checks=[],errors=[],label=process.env.ST_TEST_LABEL || '1.19.1';
if(!/^[\w.-]+$/.test(label))throw new Error('Invalid test label');
const resultDir=`test-results/creative-assets-p2/${label}`;await mkdir(resultDir,{recursive:true});
const server=createServer(async(req,res)=>{
    let body='';for await(const part of req)body+=part;const data=JSON.parse(body);
    const planner=data.messages?.at(-1)?.content.includes('Reasoning Skill 选择');calls.push({planner,data});
    res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{role:'assistant',content:planner?'[reasoning skill:001][spark:001,002,003,004]\n### 标签模块\nSECRET_ANALYSIS<guidance>DELIVERED_GUIDANCE</guidance>OUTSIDE_ANALYSIS':'P2_STORY'},finish_reason:'stop'}]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const apiUrl=`http://127.0.0.1:${server.address().port}/v1`;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
page.on('pageerror',e=>errors.push(e.stack));const panel=page.locator('#spark-planner');
const editor=()=>page.locator('.spark-editor-dialog').last();
async function save(){const id=await editor().getAttribute('data-id');await editor().locator('.popup-button-ok').click();await page.locator(`.spark-editor-dialog[data-id="${id}"]`).waitFor({state:'detached'});}
async function closeEditor(){const close=editor().locator('.spark-editor-head button');if(await close.count())await close.click();else await editor().locator('.popup-button-cancel').click();}
async function open(){if(!await panel.isVisible()){await page.locator('#extensionsMenuButton').click();await page.locator('#spark-planner-wand').click();}}
async function libMore(text){const menu=panel.locator('.spark-library-searchbar [data-more-menu]').last();if(!await menu.evaluate(n=>n.open))await menu.locator('summary').click();await menu.getByRole('button',{name:text,exact:true}).click();}
async function newPack(){const menu=panel.locator('.spark-library-searchbar [data-more-menu]').first();await menu.locator('summary').click();await menu.getByRole('button',{name:'新建创作包',exact:true}).click();}
async function management(){await libMore('创作包管理');}
async function packOp(text){const menu=editor().locator('[data-more-menu]');if(!await menu.evaluate(n=>n.open))await menu.locator('summary').click();await menu.getByRole('button',{name:text,exact:true}).click();}
async function extra(action){const menu=panel.locator('.spark-run-footer [data-more]');if(!await menu.evaluate(n=>n.open))await menu.locator('summary').click();await panel.locator('[data-action='+action+']').click();}
async function reuse(record,mode){if(!await record.evaluate(n=>n.open))await record.locator(':scope > summary').click();await record.getByRole('button',{name:'复用方案',exact:true}).click();await editor().locator('[data-field=mode]').selectOption(mode);await save();}
async function refresh(){await page.locator('[data-close]').click();await panel.waitFor({state:'hidden'});await open();await page.waitForTimeout(150);}
async function idle(){await page.waitForFunction(()=>!document.body.dataset.generating);await page.waitForTimeout(100);}
async function waitCalls(n){for(let i=0;i<200 && calls.length<n;i++)await page.waitForTimeout(50);assert.equal(calls.length,n);await idle();}
async function generate(text,type='normal'){await page.evaluate(({text,type})=>{document.querySelector('#send_textarea').value=text;window.__p2Done=false;void SillyTavern.getContext().generate(type).finally(()=>{window.__p2Done=true;});},{text,type});await page.waitForFunction(()=>window.__p2Done);await idle();}
const textOf=call=>JSON.stringify(call.data.messages);
try {
    await page.goto(process.env.ST_TEST_URL || 'http://127.0.0.1:8041');await page.waitForFunction(()=>window.sparkPlannerIntercept && SillyTavern.getContext().characters.length);
    await page.waitForFunction(()=>!document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display==='none');
    await page.evaluate(async apiUrl=>{
        let c=SillyTavern.getContext();await c.selectCharacterById(0);$('#main_api').val('openai').trigger('change');c=SillyTavern.getContext();
        Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:apiUrl,custom_model:'p2-fixture',stream_openai:false,openai_max_tokens:1024});(await import('/script.js')).setOnlineStatus('p2-connected');
        const {DEFAULT_PROMPTS}=await import('/scripts/extensions/third-party/spark-planner/core.js');
        Object.assign(c.extensionSettings.spark_planner,{enabled:true,world:'',discoveryId:'',runMode:'auto',channelId:'',contextMode:'native',prompts:{...DEFAULT_PROMPTS},reasoningLimit:1,timeout:15,maxTokens:2048,modelTags:[{id:'special',name:'专用',groups:[['special']]}]});
        c.chatMetadata.spark_planner={plans:{},history:[]};c.chat.splice(0);
    },apiUrl);
    await open();await refresh();await page.locator('[data-tab=library]').click();
    await newPack();await editor().locator('[data-field=name]').fill(`Spark-P2-${Date.now()}`);await save();
    await editor().locator('[data-field=name]').fill('创作包一');await save();
    assert.equal(await page.locator('[data-pack-browse] option:checked').textContent().then(x=>x.includes('创作包一')),true);
    const firstWorld=await page.evaluate(()=>SillyTavern.getContext().extensionSettings.spark_planner.world);
    await newPack();assert.ok((await editor().textContent()).includes('新建创作包'));await editor().locator('[data-field=name]').fill('创作包二');await save();
    assert.equal(await page.evaluate(()=>SillyTavern.getContext().extensionSettings.spark_planner.world),firstWorld);
    assert.equal(await page.getByRole('checkbox',{name:'当前聊天启用此创作包',exact:true}).isChecked(),false);
    checks.push('continuous first-pack initialization; subsequent pack shares world, switches browsing without activation');
    await management();
    await packOp('重命名 / 描述');await editor().locator('[data-field=name]').fill('重命名创作包');await editor().locator('[data-field=description]').fill('P2_DESCRIPTION');await save();
    await packOp('复制创作包');await page.waitForFunction(()=>document.querySelector('[data-pack-browse] option:checked')?.textContent.includes('副本'));
    const copyId=await page.locator('[data-pack-browse]').inputValue();
    await closeEditor();await libMore('分类管理');await editor().locator('[data-field=name]').fill('P2_EMPTY_CATEGORY');await save();
    await management();const downloadPromise=page.waitForEvent('download');await packOp('导出所选包 ZIP');const download=await downloadPromise,stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);
    await editor().getByLabel('导入创作包 ZIP 或 Markdown').setInputFiles({name:'p2-copy.zip',mimeType:'application/zip',buffer:Buffer.concat(parts)});
    const confirmation=page.locator('dialog[open]:not(.spark-dialog):not(.spark-editor-dialog)').last();await confirmation.waitFor();assert.match(await confirmation.textContent(),/包 ID 冲突/);await confirmation.locator('.popup-button-ok').click();await confirmation.waitFor({state:'detached'});
    await page.waitForFunction(copyId=>document.querySelector('[data-pack-browse]').value!==copyId,copyId);const importedId=await page.locator('[data-pack-browse]').inputValue();assert.notEqual(importedId,copyId);
    const imported=await page.evaluate(async importedId=>{const c=SillyTavern.getContext(),{Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js');return (await new Worldbook(()=>c,()=>c.extensionSettings.spark_planner).packState()).packs.find(p=>p.id===importedId);},importedId);
    assert.equal(imported.description,'P2_DESCRIPTION');assert.ok(imported.categories.includes('P2_EMPTY_CATEGORY'));
    await packOp('删除创作包');await confirmation.waitFor();await confirmation.locator('.popup-button-ok').click();await confirmation.waitFor({state:'detached'});
    await page.waitForFunction(importedId=>![...document.querySelector('[data-pack-browse]').options].some(o=>o.value===importedId),importedId);
    await closeEditor();checks.push('shared browsing state drives rename/description/copy/category/ZIP export and conflict-safe import/delete');
    await page.evaluate(async()=>{
        const c=SillyTavern.getContext(),s=c.extensionSettings.spark_planner,{Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js');
        const w=window.__p2World=new Worldbook(()=>SillyTavern.getContext(),()=>s),state=await w.packState();
        const bulk=state.packs.find(p=>p.name==='创作包一');
        const items=[{id:'r',type:'reasoning',title:'方法',body:'R_ORIGINAL',packId:'default'},...Array.from({length:5},(_,i)=>({id:`s${i}`,type:'spark',title:`火花${i}`,body:`SPARK_${i}_ORIGINAL`,packId:'default'})),...Array.from({length:300},(_,i)=>({id:`bulk${i}`,type:i%2?'spark':'reasoning',title:`检索素材${i}`,body:`BODY_SEARCH_${i}`,recommendation:`条件${i}`,category:i<250?'大量条目':'其他分类',packId:bulk.id}))];
        await w.importSkills(items);for(const m of await w.analysisModules())await w.removeAnalysisModule(m.id);
        await w.upsertAnalysisModule({id:'m',name:'标签模块',packId:'default',enabled:true,injectionMode:'guidance',analysis:'自定义任务',outputFormat:'### 标签模块'});
        c.chatMetadata.world_info=s.world;c.chatMetadata.spark_planner={plans:{},history:[]};
    });
    await refresh();await page.locator('[data-tab=library]').click();
    assert.equal(await page.locator('[data-page=settings] [data-analysis-manager]').count(),0);
    await page.locator('[data-library-tab=modules]').click();assert.ok((await page.locator('[data-analysis-manager]').textContent()).includes('已生效'));
    await page.locator('[data-library-tab=assets]').click();await page.locator('.spark-library-filters').locator('..').locator(':scope > summary').click();await page.locator('[data-library-scope]').selectOption('all');await page.getByRole('searchbox',{name:'搜索条目',exact:true}).fill('BODY_SEARCH_299');
    await page.locator('[data-skill-card=bulk299] [data-skill-title]').click();assert.equal(await editor().locator('[data-field=title]').inputValue(),'检索素材299');await closeEditor();
    assert.equal(await page.getByRole('searchbox',{name:'搜索条目',exact:true}).inputValue(),'BODY_SEARCH_299');
    await page.screenshot({path:`${resultDir}/mobile-library.png`});
    await page.getByRole('searchbox',{name:'搜索条目',exact:true}).fill('');
    await page.locator('[data-category-group="大量条目"] > summary').click();
    const scrollTargets=await page.locator('[data-category-group="大量条目"] .spark-library-row').first().evaluate(node=>{const found=[];for(let p=node;p;p=p.parentElement){const s=getComputedStyle(p);if(p.scrollHeight>p.clientHeight+1 && /auto|scroll/.test(s.overflowY))found.push(p.dataset.page || p.className);}return found;});
    assert.deepEqual(scrollTargets,['library']);checks.push('analysis entry/status moved; 300 assets cross-pack body search and direct edit preserve query, one page scroller');
    await page.locator('[data-tab=current]').click();await panel.getByRole('button',{name:'配置组合',exact:true}).click();await page.getByRole('combobox',{name:'当前聊天创作包组合',exact:true}).selectOption('independent');
    const actual=await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.enabledPackIds);assert.deepEqual(actual,['default']);
    await page.getByRole('combobox',{name:'当前聊天创作包组合',exact:true}).selectOption('inherit');assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.enabledPackIds),undefined);
    await closeEditor();checks.push('independent chat composition clones effective defaults, then restores inheritance');
    await page.locator('[data-tab=current]').click();await panel.locator('[data-adjust-selection]').click();await page.locator('[data-choice-category="未分类"] > summary').click();
    await page.locator('[data-policy-id=s0]').selectOption('required');await page.locator('[data-policy-id=s4]').selectOption('excluded');await closeEditor();
    await generate('P2_INPUT');assert.equal(calls.length,2);assert.ok(calls[0].planner);assert.ok(!calls[1].planner);
    for(const token of ['R_ORIGINAL','SPARK_0_ORIGINAL','SPARK_1_ORIGINAL','SPARK_2_ORIGINAL','SPARK_3_ORIGINAL','DELIVERED_GUIDANCE'])assert.ok(textOf(calls[1]).includes(token));
    for(const token of ['SPARK_4_ORIGINAL','SECRET_ANALYSIS','OUTSIDE_ANALYSIS'])assert.ok(!textOf(calls[1]).includes(token));
    const record=await page.evaluate(()=>structuredClone(SillyTavern.getContext().chatMetadata.spark_planner.history[0]));assert.equal(record.generation.status,'succeeded');assert.equal(record.generation.selected.spark.length,4);assert.equal(record.parsed.selected.spark.length,3);
    assert.deepEqual(await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.selectionPolicy),undefined);
    checks.push('required plus three autonomous sparks, exclusion, selective guidance, actual snapshot and success cleanup');
    await page.locator('[data-all-materials] > summary').click();await page.locator('[data-all-materials] [data-injection-viewer]').waitFor();assert.ok((await page.locator('[data-all-materials]').textContent()).includes('R_ORIGINAL'));
    await page.evaluate(async()=>{const w=window.__p2World,r=(await w.skills()).find(s=>s.id==='r');await w.upsert({...r,body:'R_EDITED',versions:[{id:'default',tagId:null,body:'R_EDITED',recommendation:''},{id:'specific',tagId:'special',body:'R_SPECIAL',recommendation:''}]});SillyTavern.getContext().chatCompletionSettings.custom_model='p2-special';});
    await refresh();await page.locator('[data-tab=history]').click();const history=page.locator(`[data-history-id="${record.id}"]`);await history.locator('> summary').click();
    await reuse(history,'latest');
    await extra('regenerate-story');await waitCalls(3);assert.ok(textOf(calls.at(-1)).includes('R_SPECIAL'));assert.equal(await page.evaluate(()=>SillyTavern.getContext().chat.filter(m=>m.is_user).length),1);
    checks.push('latest reuse rematches changed Generation model/body; native body regeneration skips Planner and preserves turn');
    await page.evaluate(async()=>{await window.__p2World.remove('r');await window.__p2World.remove('s0');});
    await refresh();await page.locator('[data-tab=history]').click();const old=page.locator(`[data-history-id="${record.id}"]`);if(!await old.evaluate(n=>n.open))await old.locator('> summary').click();
    await reuse(old,'snapshot');await extra('regenerate-story');await waitCalls(4);
    assert.equal(calls.length,4);assert.ok(textOf(calls.at(-1)).includes('R_ORIGINAL'));assert.ok(textOf(calls.at(-1)).includes('SPARK_0_ORIGINAL'));assert.ok(!textOf(calls.at(-1)).includes('R_SPECIAL'));
    assert.ok(!await page.evaluate(async()=>(await window.__p2World.skills()).some(s=>['r','s0'].includes(s.id))));
    checks.push('historical snapshot reproduces deleted/edited material without writing it back');
    const before=calls.length;await extra('replan-generate');await waitCalls(before+2);assert.ok(calls[before].planner);checks.push('explicit replan and generate invokes Planner, native turn unchanged');
    await page.evaluate(()=>globalThis.toastr?.clear());await page.screenshot({path:`${resultDir}/mobile-current.png`});await page.locator('[data-tab=history]').click();await page.screenshot({path:`${resultDir}/mobile-history.png`});
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,requests:calls.length}));
} catch(e){await page.screenshot({path:`${resultDir}/failure.png`}).catch(()=>{});await writeFile(`${resultDir}/state.json`,JSON.stringify(await page.evaluate(()=>({history:SillyTavern.getContext().chatMetadata.spark_planner?.history.map(r=>({id:r.id,status:r.status,error:r.error})),toasts:[...document.querySelectorAll('.toast')].map(n=>n.textContent)})).catch(()=>({})),null,2));throw e;}
finally {await writeFile(`${resultDir}/result.json`,JSON.stringify({checks,calls,errors},null,2));await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
