// Isolated native hosts and a local provider only. No daily data or paid APIs.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const url=process.env.ST_TEST_URL || 'http://127.0.0.1:8062',label=process.env.ST_TEST_LABEL || '1.18.0',out=`test-results/ux03/${label}`;
assert.match(url,/^http:\/\/127\.0\.0\.1:806[23]$/);assert.match(label,/^[\w.-]+$/);await mkdir(out,{recursive:true});
const checks=[],errors=[],calls=[];const check=text=>{checks.push(text);console.log(text);};
let holdStory=false,holdPlanner=false,releaseStory,releasePlanner,answer='[reasoning skill:001][spark:001]\n候选分析\n<guidance># 本轮指导\n\n- 保留人物边界\n- **推进剧情**\n\n'+ '创作段落用于完整阅读。\n\n'.repeat(12)+'</guidance>\n尾部分析';
const api=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;res.setHeader('content-type','application/json');
    if(req.url.endsWith('/models')){calls.push({kind:'models'});res.end(JSON.stringify({data:[{id:'vendor/model (full)/test'}]}));return;}
    const data=JSON.parse(raw),planner=JSON.stringify(data.messages).includes('Reasoning Skill 选择');calls.push({kind:planner?'planner':'story',data});
    if(planner && holdPlanner)await new Promise(resolve=>{releasePlanner=resolve;});
    if(!planner && holdStory)await new Promise(resolve=>{releaseStory=resolve;});
    res.end(JSON.stringify({choices:[{message:{role:'assistant',content:planner?answer:'LOCAL_STORY'},finish_reason:'stop'}]}));
});await new Promise(r=>api.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${api.address().port}/v1`;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,timezoneId:'Asia/Hong_Kong'});
await page.context().grantPermissions(['clipboard-read','clipboard-write'],{origin:url});page.on('pageerror',e=>errors.push(e.message));
const panel=page.locator('#spark-planner'),modal=()=>page.locator('.spark-editor-dialog[open]').last(),field=key=>modal().locator(`[data-field=${key}]`);
async function open(){if(!await panel.isVisible()){await page.locator('#extensionsMenuButton').click();await page.locator('#spark-planner-wand').click();}}
async function save(){const id=await modal().getAttribute('data-id');await modal().locator('.popup-button-ok').click();await page.locator(`dialog[data-id="${id}"]`).waitFor({state:'detached'});}
async function cancel(){const id=await modal().getAttribute('data-id');await modal().locator('.popup-button-cancel').click();await page.locator(`dialog[data-id="${id}"]`).waitFor({state:'detached'});}
async function more(action){await panel.locator('.spark-run-footer [data-more] > summary').click();await panel.locator(`[data-action=${action}]`).click();}
async function generate(text){await page.evaluate(async text=>{document.querySelector('#send_textarea').value=text;await SillyTavern.getContext().generate('normal');},text);await page.waitForFunction(()=>!document.body.dataset.generating);}
try{
    await page.goto(url);await page.waitForFunction(()=>window.sparkPlannerIntercept);
    await page.waitForFunction(()=>SillyTavern.getContext().characters.length || document.querySelector('dialog[open] .onboarding'));
    if(await page.locator('dialog[open] .onboarding').count())await page.locator('dialog[open]').filter({has:page.locator('.onboarding')}).locator('.popup-button-ok').click();
    await page.waitForFunction(()=>SillyTavern.getContext().characters.length && (!document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display==='none'));
    await page.evaluate(async endpoint=>{
        let c=SillyTavern.getContext();await c.selectCharacterById(0);$('#main_api').val('openai').trigger('change');c=SillyTavern.getContext();
        Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:endpoint,custom_model:'gpt-4o',stream_openai:false,openai_max_tokens:1024});(await import('/script.js')).setOnlineStatus('local-fixture');
        const {DEFAULT_PROMPTS}=await import('/scripts/extensions/third-party/spark-planner/core.js'),s=c.extensionSettings.spark_planner;
        Object.assign(s,{enabled:true,world:'UX03-Fixture',discoveryId:'',runMode:'auto',channelId:'',channels:[],maxTokens:2048,timeout:15,prompts:{...DEFAULT_PROMPTS},modelTags:[]});
        const {Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js'),w=window.__uxWorld=new Worldbook(()=>SillyTavern.getContext(),()=>s);
        await c.saveWorldInfo(s.world,{entries:{}},true);await c.updateWorldInfoList();await w.ensureDiscovery();
        await w.importSkills([{id:'r',type:'reasoning',title:'方法条目',body:'BODY_R',category:'主分类'},{id:'s',type:'spark',title:'火花条目',body:'BODY_S',category:'主分类'},...Array.from({length:300},(_,i)=>({id:'many-'+i,type:'spark',title:`长条目 ${String(i).padStart(3,'0')} 用于验证数百条素材的连续滚动`,body:'BODY_'+i,category:i<200?'主分类':'末尾分类'}))]);
        for(const m of await w.analysisModules())await w.removeAnalysisModule(m.id);
        await w.upsertAnalysisModule({id:'analysis',name:'心理分析',packId:'default',analysis:'已有分析资料',outputFormat:'使用 guidance 标签交付',enabled:true});
        c.chat.splice(0);c.chatMetadata.spark_planner={plans:{},history:[]};c.chatMetadata.world_info=s.world;await c.eventSource.emit(c.eventTypes.SETTINGS_UPDATED);
    },endpoint);
    await open();await generate('UX03_FIRST_INPUT');await page.waitForFunction(()=>document.querySelector('[data-guidance-reader]')?.textContent.includes('保留人物边界'));
    assert.equal(await panel.locator('[data-page=current] textarea:visible').count(),0);assert.equal(await panel.locator('[data-all-materials]').evaluate(n=>n.open),false);assert.equal(await panel.locator('[data-current-debug]').evaluate(n=>n.open),false);
    const record=await page.evaluate(()=>structuredClone(SillyTavern.getContext().chatMetadata.spark_planner.history[0]));
    assert.equal(record.evidence.calls.planner,1);assert.equal(record.evidence.calls.generation,1);
    assert.deepEqual(record.evidence.requests.planner.body.messages,calls.find(c=>c.kind==='planner').data.messages);assert.deepEqual(record.evidence.requests.generation.body.messages,calls.find(c=>c.kind==='story').data.messages);
    assert.equal(record.generation.actualInjection.state,'unavailable');await panel.locator('[data-copy-guidance]').click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n/g,'\n')),record.plan.discovery);
    await page.screenshot({path:`${out}/current-mobile.png`});check('当前页直接阅读/复制指导；材料及原始输出折叠；序列化最终 Planner/Generation 请求与真实本地请求一致；装配不冒充实际注入');
    await panel.locator('[data-edit-guidance]').click();await field('text').fill('HANDWRITTEN_GUIDANCE');assert.ok(await modal().boundingBox().then(b=>b.height>844*.85));
    const toolbar=modal().locator('.spark-text-toolbar');assert.equal(await toolbar.locator('.spark-text-stats').count(),1);assert.equal(await toolbar.getByRole('button',{name:'放大',exact:true}).count(),1);
    await save();assert.match(await panel.locator('[data-guidance-status]').textContent(),/草稿/);assert.equal(await panel.locator('[data-guidance-reader]').textContent(),'HANDWRITTEN_GUIDANCE');
    assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.history[0].generation.discovery),record.generation.discovery);
    await panel.locator('[data-action=apply]').click();
    await panel.locator('[data-adjust-selection]').click();assert.equal(await modal().getAttribute('aria-label'),'本轮选材');await modal().locator('[data-choice-category="主分类"] > summary').click();
    await modal().locator('[data-id=s]').uncheck();await cancel();assert.equal(await panel.locator('[data-selected-id=s]').count(),0);await panel.locator('[data-action=apply]').click();check('指导保存为新草稿且不覆盖历史；统一工具栏；选材大窗口返回并应用，主页面不丢状态');
    const chip=panel.locator('[data-selected-id=r]');await chip.scrollIntoViewIfNeeded();const box=await chip.boundingBox(),cdp=await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+15,y:box.y+15}]});await page.waitForTimeout(650);await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await modal().locator('[data-field=body]').waitFor();assert.equal(await field('body').inputValue(),'BODY_R');await cancel();check('触摸长按已选标签进入素材编辑；返回当前页，保留选材与指导');
    await panel.locator('[data-all-materials] > summary').click();await panel.locator('[data-all-materials]').getByText('预计注入 · 实际注入记录不可用',{exact:true}).waitFor();assert.match(await panel.locator('[data-all-materials]').textContent(),/实际注入记录不可用/);await panel.locator('[data-all-materials]').getByRole('button',{name:'全部展开',exact:true}).click();
    await panel.locator('[data-all-materials]').getByRole('button',{name:'复制全部正文',exact:true}).click();assert.equal(await page.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n/g,'\n')),'BODY_R\n\nHANDWRITTEN_GUIDANCE');
    await more('request');assert.equal(await modal().locator('[data-run-diagnostics]').count(),1);assert.ok(!(await modal().locator('[data-diagnostic-page=overview]').textContent()).includes('{'));
    await modal().getByRole('tab',{name:'Generation 注入',exact:true}).click();assert.match(await modal().textContent(),/最终来源未确认/);await modal().getByRole('button',{name:'复制完整请求正文',exact:true}).filter({visible:true}).click();assert.ok((await page.evaluate(async()=>(await navigator.clipboard.readText()).replace(/\r\n/g,'\n'))).includes('BODY_R'));await cancel();check('全部材料复制保持装配顺序且不附加说明；独立诊断按阶段阅读最终请求，明确逐素材来源不可确认');
    await panel.locator('[data-tab=library]').click();await panel.locator('[data-category-group="主分类"] > summary').click();
    const library=panel.locator('[data-page=library]');await library.evaluate(n=>{n.scrollTop=450;});const scroll=await library.evaluate(n=>n.scrollTop);
    await panel.locator('[data-tab=current]').click();await panel.locator('[data-tab=library]').click();assert.equal(await library.evaluate(n=>n.scrollTop),scroll);
    const row=panel.locator('[data-skill-card=many-20] [data-skill-title]');await row.click();const parentScroll=await library.evaluate(n=>n.scrollTop);
    await field('body').fill('EDITED_BODY');const input=field('body'),handle=modal().locator('.spark-field:has([data-field=body]) .spark-resize-handle');await handle.scrollIntoViewIfNeeded();const old=await input.evaluate(n=>n.getBoundingClientRect().height),hb=await handle.boundingBox();
    await page.mouse.move(hb.x+10,hb.y+10);await page.mouse.down();await page.mouse.move(hb.x+10,hb.y+110,{steps:8});await page.mouse.up();assert.ok(await input.evaluate(n=>n.getBoundingClientRect().height)>old+70);
    await input.evaluate(n=>{n.focus();n.setSelectionRange(2,6);n.scrollTop=10;});await page.evaluate(async()=>{const c=SillyTavern.getContext();await c.eventSource.emit(c.eventTypes.CHATCOMPLETION_MODEL_CHANGED);});await page.waitForTimeout(800);assert.equal(await input.inputValue(),'EDITED_BODY');assert.deepEqual(await input.evaluate(n=>[n.selectionStart,n.selectionEnd]),[2,6]);
    const resizedHeight=await input.evaluate(n=>n.getBoundingClientRect().height);await page.setViewportSize({width:390,height:430});await page.waitForTimeout(120);const saveBox=await modal().locator('.popup-button-ok').boundingBox();assert.ok(saveBox.y+saveBox.height<=431);assert.ok(Math.abs(await input.evaluate(n=>n.getBoundingClientRect().height)-resizedHeight)<2);await page.setViewportSize({width:390,height:844});await save();assert.equal(await library.evaluate(n=>n.scrollTop),parentScroll);
    check('切页保留滚动；素材编辑保持父页面位置；Token/模型刷新不覆盖内容、高度与光标选区');
    const main=panel.locator('[data-category-group="主分类"]');assert.equal(await main.locator('.spark-category-items').evaluate(n=>getComputedStyle(n).overflowY),'visible');
    await library.evaluate(n=>{n.scrollTop=1000;});const lb=await library.boundingBox(),beforeTouch=await library.evaluate(n=>n.scrollTop);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:lb.x+130,y:lb.y+400}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:lb.x+130,y:lb.y+400-i*20}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(120);assert.ok(await library.evaluate(n=>n.scrollTop)>beforeTouch+30);
    await library.evaluate(n=>{n.scrollTop=n.scrollHeight;});assert.equal(await panel.locator('[data-category-group="末尾分类"] > summary').isVisible(),true);check('302 条素材使用整页主滚动；条目普通区域真实触摸滑动可到达后续分类');
    await library.evaluate(n=>{n.scrollTop=0;});await panel.getByRole('searchbox',{name:'搜索条目'}).fill('many missing');await panel.locator('.spark-library-searchbar .spark-more-menu').first().locator('summary').click();await panel.getByRole('button',{name:'新增条目',exact:true}).click();
    await field('title').fill('新火花');await field('body').fill('NEW_SPARK_BODY');await save();assert.equal(await panel.getByRole('searchbox',{name:'搜索条目'}).inputValue(),'many missing');await panel.getByRole('searchbox',{name:'搜索条目'}).fill('');
    await panel.locator('[data-library-tab=modules]').click();await panel.getByRole('button',{name:'新增分析模块',exact:true}).click();await field('name').fill('新分析模块');await field('analysis').fill('NEW_ANALYSIS');await save();
    await panel.locator('[data-tab=current]').click();await panel.getByRole('button',{name:'配置组合',exact:true}).click();assert.ok(await modal().boundingBox().then(b=>b.height<844*.7));await modal().getByRole('combobox',{name:'当前聊天创作包组合',exact:true}).selectOption('independent');const packCheck=modal().getByRole('checkbox').first();await packCheck.uncheck();await page.waitForFunction(()=>document.querySelector('[aria-label="当前聊天启用此创作包"]').checked===false);await packCheck.check();await modal().getByRole('combobox',{name:'当前聊天创作包组合',exact:true}).selectOption('inherit');await cancel();check('新建火花/分析模块后保留搜索与子页签；组合配置使用紧凑自适应窗口');
    await panel.locator('[data-tab=library]').click();await panel.locator('[data-library-tab=assets]').click();await panel.getByRole('searchbox',{name:'搜索条目'}).fill('方法条目');holdStory=true;
    await page.evaluate(()=>{document.querySelector('#send_textarea').value='EDIT_DURING_GENERATION';window.__pendingGeneration=SillyTavern.getContext().generate('normal');});
    await page.waitForFunction(()=>document.body.dataset.generating);await panel.locator('[data-close]').click();await panel.waitFor({state:'hidden'});assert.ok(await page.evaluate(()=>!!document.body.dataset.generating));await open();assert.equal(await panel.locator('[data-library-tab=assets]').getAttribute('aria-selected'),'true');assert.equal(await panel.getByRole('searchbox',{name:'搜索条目'}).inputValue(),'方法条目');await panel.locator('[data-skill-card=r] [data-skill-title]').click();await field('body').fill('EDITED_DURING_GENERATION');await field('body').evaluate(n=>{n.focus();n.setSelectionRange(1,5);});
    while(!releaseStory)await new Promise(r=>setTimeout(r,20));releaseStory();holdStory=false;await page.evaluate(()=>window.__pendingGeneration);await page.waitForTimeout(100);assert.equal(await field('body').inputValue(),'EDITED_DURING_GENERATION');assert.deepEqual(await field('body').evaluate(n=>[n.selectionStart,n.selectionEnd]),[1,5]);await save();
    assert.ok(!JSON.stringify(calls.filter(c=>c.kind==='story').at(-1).data.messages).includes('EDITED_DURING_GENERATION'));check('生成过程中可编辑素材；生成结束不覆盖编辑草稿或焦点；已发送请求保持冻结内容');
    await panel.locator('[data-tab=current]').click();holdPlanner=true;
    await page.evaluate(()=>{document.querySelector('#send_textarea').value='EDIT_WHILE_PLANNER_RETURNS';window.__pendingPlanner=SillyTavern.getContext().generate('normal');});
    for(let i=0;!releasePlanner && i<200;i++)await new Promise(r=>setTimeout(r,25));assert.ok(releasePlanner);
    await panel.locator('[data-edit-guidance]').click();await field('text').fill('UNSAVED_DURING_PLANNER');await field('text').evaluate(n=>{n.focus();n.setSelectionRange(3,7);});releasePlanner();holdPlanner=false;await page.evaluate(()=>window.__pendingPlanner);
    assert.equal(await field('text').inputValue(),'UNSAVED_DURING_PLANNER');assert.deepEqual(await field('text').evaluate(n=>[n.selectionStart,n.selectionEnd]),[3,7]);await save();assert.equal(await panel.locator('[data-guidance-reader]').evaluate(n=>n.sparkRaw),'UNSAVED_DURING_PLANNER');check('Planner 返回不覆盖未保存指导；同轮保存正常，历史交付保持独立');
    await panel.locator('[data-tab=current]').click();for(const width of [360,390,430,1200]){await page.setViewportSize({width,height:844});assert.equal(await panel.evaluate(n=>n.scrollWidth>n.clientWidth+2),false);}
    await page.setViewportSize({width:1200,height:844});await page.screenshot({path:`${out}/current-desktop.png`});await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{window.__themeBefore=document.body.getAttribute('style');for(const [name,value] of Object.entries({SmartThemeBlurTintColor:'rgb(245,245,245)',SmartThemeBodyColor:'rgb(34,51,68)',SmartThemeEmColor:'rgb(85,95,105)',SmartThemeBorderColor:'rgb(185,195,205)',SmartThemeQuoteColor:'rgb(65,100,85)'}))document.body.style.setProperty('--'+name,value);});
    assert.equal(await panel.evaluate(n=>getComputedStyle(n).color),'rgb(34, 51, 68)');await page.screenshot({path:`${out}/theme-light.png`});await page.evaluate(()=>{if(window.__themeBefore==null)document.body.removeAttribute('style');else document.body.setAttribute('style',window.__themeBefore);});
    assert.equal(await page.evaluate(async()=>{const {readingText}=await import('/scripts/extensions/third-party/spark-planner/ui.js');return readingText('<img src=x onerror="window.__unsafe=1"><script>window.__unsafe=1</script>').querySelectorAll('img,script,[onerror]').length;}),0);
    const menu=panel.locator('.spark-run-footer [data-more]');await menu.locator('summary').click();await page.keyboard.press('Escape');assert.equal(await menu.evaluate(n=>n.open),false);assert.equal(await panel.isVisible(),true);
    await panel.locator('[data-selected-id=r]').focus();await page.keyboard.press('F2');await field('body').waitFor();const editorId=await modal().getAttribute('data-id');await page.keyboard.press('Escape');await page.locator('dialog[data-id="'+editorId+'"]').waitFor({state:'detached'});assert.equal(await panel.isVisible(),true);
    const historyBefore=await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.history.length);await panel.locator('[data-close]').click();await open();assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.history.length),historyBefore);
    assert.deepEqual(errors,[]);check('360/390/430/1200 布局、桌面鼠标与键盘；关闭面板不取消或新增运行；无页面异常');
}catch(error){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;}
finally{releaseStory?.();releasePlanner?.();await writeFile(`${out}/result.json`,JSON.stringify({checks,errors,calls:calls.map(c=>({kind:c.kind,model:c.data?.model}))},null,2));await browser.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
