// Run only against the disposable UX-02 host. All upstream calls use this local fixture.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir,writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const checks=[],errors=[],calls=[],url=process.env.ST_TEST_URL || 'http://127.0.0.1:8052',label=process.env.ST_TEST_LABEL || '',out=`test-results/ux02${label?'/'+label:''}`;
assert.match(label,/^[\w.-]*$/);
checks.push=(...items)=>{console.log(items.join('\n'));return Array.prototype.push.apply(checks,items);};
assert.match(url,/^http:\/\/127\.0\.0\.1:80[56][23]$/);await mkdir(out,{recursive:true});
const ids=['vendor/model (beta)/full','模型/中文',...Array.from({length:220},(_,i)=>`vendor/large-${i}`)];
const api=createServer(async(req,res)=>{
    const path=req.url,auth=req.headers.authorization;let body='';for await(const chunk of req)body+=chunk;
    const call={path,auth,data:body?JSON.parse(body):null};calls.push(call);
    res.setHeader('content-type','application/json');
    if(path.includes('/slow/'))await new Promise(r=>setTimeout(r,2200));
    if(path.endsWith('/models')){
        if(path.includes('/fail/')){res.statusCode=401;res.end(JSON.stringify({error:'fixture unauthorized'}));}
        else if(path.includes('/bad/'))res.end(JSON.stringify({unknown:[]}));
        else res.end(JSON.stringify({data:(path.includes('/empty/')?[]:path.includes('/b/')?['other/model B']:path.includes('/slow/')?['STALE_MODEL']:ids).map(id=>({id}))}));
    }else if(path.endsWith('/chat/completions')){
        await new Promise(r=>setTimeout(r,180));
        if(call.data.model==='invalid-model'){res.statusCode=404;res.end(JSON.stringify({error:{message:'model not found'}}));}
        else res.end(JSON.stringify({choices:[{message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));
    }else{res.statusCode=404;res.end('{}');}
});
await new Promise(r=>api.listen(0,'127.0.0.1',r));const endpoint=path=>`http://127.0.0.1:${api.address().port}/${path}/v1`;
const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Asia/Hong_Kong'});
page.on('pageerror',e=>errors.push(e.message));
const panel=page.locator('#spark-planner'),modal=()=>page.locator('.spark-editor-dialog[open]').last(),field=key=>modal().locator(`[data-field=${key}]`);
async function open(){if(!await panel.isVisible()){await page.locator('#extensionsMenuButton').click();await page.locator('#spark-planner-wand').click();}}
async function closeModal(){await modal().locator('.popup-button-cancel').click();}
async function saveModal(){const id=await modal().getAttribute('data-id');await modal().locator('.popup-button-ok').click();await page.locator(`dialog[data-id="${id}"]`).waitFor({state:'detached'});}
async function back(){await page.getByRole('button',{name:'‹ 返回设置',exact:true}).filter({visible:true}).click();}
async function entry(title){await page.locator('.spark-settings-entry').filter({has:page.getByText(title,{exact:true})}).click();}
async function state(pattern){await page.waitForFunction(source=>new RegExp(source).test(document.querySelector('[data-models-status]')?.textContent),pattern.source);}
const settings=()=>page.evaluate(()=>structuredClone(SillyTavern.getContext().extensionSettings.spark_planner));
async function secrets(){return page.evaluate(async()=>{const c=SillyTavern.getContext();return (await (await fetch('/api/secrets/read',{method:'POST',headers:c.getRequestHeaders(),body:'{}'})).json()).api_key_custom || [];});}
try{
    await page.goto(url);await page.waitForFunction(()=>window.sparkPlannerIntercept);
    await page.waitForFunction(()=>document.querySelector('dialog[open] .onboarding') || SillyTavern.getContext().characters.length);
    if(await page.locator('dialog[open] .onboarding').count())await page.locator('dialog[open]').filter({has:page.locator('.onboarding')}).locator('.popup-button-ok').click();
    await page.waitForFunction(()=>SillyTavern.getContext().characters.length && (!document.querySelector('#preloader') || getComputedStyle(document.querySelector('#preloader')).display==='none'));
    console.log('Disposable host ready');await page.evaluate(async()=>{
        let c=SillyTavern.getContext();await c.selectCharacterById(0);$('#main_api').val('openai').trigger('change');c=SillyTavern.getContext();
        Object.assign(c.chatCompletionSettings,{chat_completion_source:'custom',custom_url:'http://127.0.0.1:1',custom_model:'gpt-4o',stream_openai:false});
        const {DEFAULT_PROMPTS}=await import('/scripts/extensions/third-party/spark-planner/core.js'),s=c.extensionSettings.spark_planner;
        Object.assign(s,{enabled:true,world:'UX02-Fixture',discoveryId:'',runMode:'manual',channelId:'',channels:[],maxTokens:2048,timeout:10,prompts:{...DEFAULT_PROMPTS,task:'CUSTOM_TASK_KEEP'}});
        const {Worldbook}=await import('/scripts/extensions/third-party/spark-planner/worldbook.js'),w=window.__uxWorld=new Worldbook(()=>SillyTavern.getContext(),()=>s);
        await c.saveWorldInfo(s.world,{entries:{}},true);await c.updateWorldInfoList();await w.ensureDiscovery();await w.importSkills([{id:'r',type:'reasoning',title:'历史方法',body:'HISTORICAL_BODY'}]);
        c.chat.splice(0,c.chat.length,{is_user:true,mes:'玩家输入摘要，用于历史列表',extra:{spark_planner:'ux-turn'}},{is_user:false,mes:'FIXTURE_REPLY'});
        const plan={id:'actual',chat:JSON.stringify([null,c.characterId,c.chatId]),world:s.world,turn:'ux-turn',input:c.chat[0].mes,selected:{reasoning:['r'],spark:[]},discovery:'FINAL_GUIDANCE\n'+'长文本\n'.repeat(30),source:'manual',revision:2,applied:true,entries:await w.entries()};
        const {assembleInjection}=await import('/scripts/extensions/third-party/spark-planner/injection.js');
        const actual={...assembleInjection(plan),chat:plan.chat,turn:plan.turn,model:{modelId:'full/generation-model'},plannerModel:'full/planner-model',reply:{index:1,swipeId:0},revision:2};
        c.chatMetadata.spark_planner={plans:{},history:[{id:'actual',time:'2026-11-26T18:30:00.000Z',turn:'ux-turn',plan,applied:plan,generation:actual,status:'succeeded',raw:'RAW_DIAGNOSTIC_OUTPUT'},{id:'legacy',time:'2026-11-25T18:30:00.000Z',plan:{...plan,id:'legacy',input:'旧记录输入'},generation:{model:{modelId:'legacy'},selected:plan.selected},status:'applied',raw:'LEGACY_RAW'}]};
        await c.eventSource.emit(c.eventTypes.SETTINGS_UPDATED);
    });
    await open();await page.locator('[data-tab=history]').click();
    assert.equal(await page.locator('.spark-history-day').count(),2);
    const record=page.locator('[data-history-id=actual]');assert.equal(await record.evaluate(n=>n.open),false);
    assert.match(await record.locator(':scope > summary').textContent(),/玩家输入摘要/);assert.ok(!(await record.locator(':scope > summary').textContent()).includes('full/'));
    assert.match(await record.locator('time').textContent(),/02:30/);await page.screenshot({path:`${out}/history-mobile.png`});
    await record.locator(':scope > summary').click();assert.equal(await record.locator('textarea').count(),0);assert.equal(await record.locator('[data-run-details]').evaluate(n=>n.open),false);
    await record.getByRole('button',{name:'查看装配快照',exact:true}).click();assert.ok((await modal().locator('[data-injection-body]').allTextContents()).join('\n').includes('HISTORICAL_BODY'));await closeModal();
    await record.locator('[data-run-details] > summary').click();await record.getByRole('button',{name:'本轮运行诊断',exact:true}).click();await modal().getByRole('tab',{name:'响应与解析',exact:true}).click();assert.match(await modal().textContent(),/RAW_DIAGNOSTIC_OUTPUT/);await closeModal();
    const legacy=page.locator('[data-history-id=legacy]');await legacy.locator(':scope > summary').click();await legacy.getByRole('button',{name:'复用方案',exact:true}).click();assert.equal(await field('mode').locator('option').count(),1);await closeModal();
    await record.getByRole('button',{name:'复用方案',exact:true}).click();await field('mode').selectOption('snapshot');await saveModal();
    assert.equal(await page.evaluate(()=>SillyTavern.getContext().chatMetadata.spark_planner.draft.frozenInjection.items.find(i=>i.kind==='skill').content),'HISTORICAL_BODY');
    checks.push('历史按本地日期分组与本地时间；短输入摘要；折叠诊断、只读指导、原注入组件；旧记录限制及快照复用');
    await page.locator('[data-tab=settings]').click();assert.equal(await page.locator('[data-settings-directory]').isVisible(),true);assert.equal(await page.locator('[data-world]').isVisible(),false);
    await entry('Planner 任务提示词');const prompt=page.locator('[data-prompt-key=task]');await prompt.locator('summary').click();assert.equal(await prompt.locator('textarea').inputValue(),'CUSTOM_TASK_KEEP');await prompt.locator('textarea').fill('CUSTOM_TASK_EDITED\n精确保留');assert.equal((await settings()).prompts.task,'CUSTOM_TASK_EDITED\n精确保留');
    await page.getByRole('button',{name:'恢复默认文案',exact:true}).click();await page.locator('dialog[open]').last().locator('.popup-button-cancel').click();assert.equal((await settings()).prompts.task,'CUSTOM_TASK_EDITED\n精确保留');await back();
    checks.push('设置目录；高级世界书配置下沉；直接展开编辑提示词；取消恢复默认保留自定义内容');
    await entry('Planner 模型渠道');assert.equal(await page.getByRole('combobox',{name:'Planner 渠道',exact:true}).inputValue(),'');
    await page.getByRole('button',{name:'添加渠道',exact:true}).click();assert.match(await modal().locator('[data-models-status]').textContent(),/请填写/);
    await field('name').fill('UX02 独立渠道');await field('model').fill('legacy/model');await field('timeout').fill('');await field('url').fill(endpoint('a'));await field('key').fill('fixture-key-A-only');await state(/已加载 222/);await field('timeout').fill('10');
    assert.equal((await settings()).channels.length,0);assert.equal(await field('key').getAttribute('type'),'password');assert.equal(await field('model').inputValue(),'legacy/model');assert.match(await modal().locator('[data-models-status]').textContent(),/已保留原值/);
    await modal().getByRole('searchbox',{name:'搜索模型 ID'}).fill('model (beta)');await modal().getByRole('listbox',{name:'模型列表'}).selectOption(ids[0]);assert.equal(await field('model').inputValue(),ids[0]);
    await modal().getByRole('button',{name:'刷新模型',exact:true}).click();await state(/已加载/);assert.equal(await field('model').inputValue(),ids[0]);
    assert.equal(calls.filter(c=>c.path.endsWith('/chat/completions')).length,0);
    await modal().getByRole('button',{name:'测试渠道',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-channel-test-status]').textContent.includes('测试通过'));
    assert.equal((await settings()).channels.length,0);assert.equal(calls.filter(c=>c.path.endsWith('/chat/completions')).length,1);
    for(const width of [360,390,430,900]){await page.setViewportSize({width,height:844});assert.equal(await modal().evaluate(n=>n.scrollWidth>n.clientWidth+2),false);}
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${out}/channel-mobile.png`});
    await saveModal();let saved=(await settings()).channels[0];assert.ok(saved.secretId);assert.ok(!JSON.stringify(await settings()).includes('fixture-key'));
    const active=(await secrets()).find(x=>x.active)?.id,beforeCache=calls.length;
    await page.locator(`[data-channel-id="${saved.id}"]`).click();await state(/已加载/);assert.equal(calls.length,beforeCache);assert.equal(await field('key').inputValue(),'');assert.equal(await field('maxTokens').inputValue(),'2048');
    const test=modal().getByRole('button',{name:'测试渠道',exact:true});await test.click();assert.equal(await test.isDisabled(),true);await page.waitForFunction(()=>document.querySelector('[data-channel-test-status]').textContent.includes('测试通过'));
    const generation=calls.filter(c=>c.path.endsWith('/chat/completions'));assert.equal(generation.length,2);assert.equal(generation[0].auth,'Bearer fixture-key-A-only');assert.equal(generation[0].data.max_tokens,64);assert.equal(generation[0].data.messages[0].content,'Reply OK.');
    assert.equal((await secrets()).find(x=>x.active)?.id,active);
    checks.push('未保存渠道自动获取；完整模型 ID 搜索与保存；刷新不替换旧模型；模型查询无生成调用；缓存、密钥留空复用与全局 Token 继承；当前表单测试及防重复');
    await field('url').fill(endpoint('b'));await state(/无法加载/);assert.equal(calls.filter(c=>c.path==='/b/v1/models').length,0);await field('key').fill('fixture-key-B-only');await state(/已加载 1/);
    assert.equal(calls.find(c=>c.path==='/b/v1/models').auth,'Bearer fixture-key-B-only');
    await field('url').fill(endpoint('slow'));await state(/正在加载/);await page.waitForFunction(()=>document.querySelector('[data-models-status]').textContent.includes('正在加载'));await page.waitForTimeout(850);
    await field('url').fill(endpoint('b'));await state(/已加载 1/);await page.waitForTimeout(2400);assert.match(await modal().locator('[data-models-status]').textContent(),/已加载 1/);assert.ok(!(await modal().locator('[aria-label="模型列表"]').textContent()).includes('STALE_MODEL'));
    for(const [path,expected] of [['empty',/未返回可用模型/],['bad',/格式不兼容/],['fail',/请求失败/]]){
        await field('url').fill(endpoint(path));await state(expected);assert.equal(await field('model').inputValue(),ids[0]);assert.equal(await field('model').isVisible(),true);
    }
    await field('url').fill(endpoint('b'));await state(/已加载 1/);await modal().getByRole('checkbox',{name:'手动输入模型 ID'}).check();await field('model').fill('invalid-model');await test.click();await page.waitForFunction(()=>document.querySelector('[data-channel-test-status]').textContent.includes('测试失败'));assert.match(await modal().locator('[data-channel-test-status]').textContent(),/接口或模型未找到/);
    await field('model').fill('other/model B');await saveModal();saved=(await settings()).channels[0];assert.equal(saved.url,endpoint('b'));assert.equal(saved.model,'other/model B');assert.ok(!JSON.stringify(await settings()).includes('fixture-key'));
    checks.push('地址变更不复用旧密钥；迟到请求隔离；空列表、不兼容和失败状态；保留模型与手动回退；生成测试失败可见');
    await page.getByRole('combobox',{name:'Planner 渠道',exact:true}).selectOption(saved.id);assert.equal((await settings()).channelId,saved.id);await page.getByRole('combobox',{name:'Planner 渠道',exact:true}).selectOption('');assert.equal((await settings()).channelId,'');
    const beforeCancel=(await secrets()).map(s=>s.id);await page.getByRole('button',{name:'添加渠道',exact:true}).click();await field('url').fill(endpoint('a'));await field('key').fill('fixture-discarded-key');await state(/已加载/);await closeModal();await page.locator('dialog[open]').last().locator('.popup-button-ok').click();await page.waitForTimeout(300);assert.deepEqual((await secrets()).map(s=>s.id),beforeCancel);
    await page.locator(`[data-channel-id="${saved.id}"]`).click();await modal().getByRole('button',{name:'删除渠道',exact:true}).click();await page.locator('dialog[open]').last().locator('.popup-button-ok').click();await page.waitForFunction(()=>SillyTavern.getContext().extensionSettings.spark_planner.channels.length===0);
    await back();await page.screenshot({path:`${out}/settings-mobile.png`});
    checks.push('渠道切换、继承主模型、删除；取消新建后清理临时密钥；360/390/430/900 布局无溢出');
    assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,requests:calls.length,errors}));
}catch(error){await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});throw error;}
finally{await writeFile(`${out}/result.json`,JSON.stringify({checks,errors,requests:calls.map(c=>({path:c.path,model:c.data?.model}))},null,2));await browser.close();api.closeAllConnections();await new Promise(r=>api.close(r));}
