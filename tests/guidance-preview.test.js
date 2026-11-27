import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PROMPTS, KEY, parsePlanner, plannerSections } from '../core.js';
import { Workflow } from '../workflow.js';
import { injectionText, tokenTotals, assembleInjection } from '../injection.js';
import { measureTextTokens, tokenLabel } from '../text-stats.js';

const catalog={reasoning:[{id:'r',title:'方法',number:'001'}],spark:[{id:'s',title:'火花',number:'001'}]};
const scenarios=[
    ['无标签','分析、候选、审美筛选及输出协议'.repeat(50),''],
    ['一个标签','外部<guidance>只交付这一段</guidance>外部','只交付这一段'],
    ['多个标签','<guidance>第一段</guidance>中间<guidance>第二段</guidance>','第一段\n\n第二段'],
    ['未闭合','<guidance>不完整',''],
    ['非法嵌套','<guidance>外层<guidance>嵌套</guidance>后文</guidance>',''],
    ['空标签','<guidance> \n </guidance>',''],
    ['非法标签属性','<guidance mode="full">不合法</guidance>',''],
    ['坏块后有效块','<guidance>外<guidance>内</guidance></guidance><guidance>有效</guidance>','有效'],
];
for(const [name,body,expected] of scenarios)test(`固定输出：${name}，仅交付有效标签，选材不受影响`,()=>{
    for(const injectionMode of [undefined,'full','guidance','view']) {
        const raw=`[reasoning skill:001][spark:001]\n${body}`, parsed=parsePlanner(raw,catalog,5,[{id:'m',name:'任意模块',injectionMode}]);
        assert.equal(parsed.discovery,expected);assert.deepEqual(parsed.selected,{reasoning:['r'],spark:['s']});
        assert.equal(parsed.guidanceMissing,!expected);assert.ok(raw.includes(body));
    }
});

function fixture() {
    let raw='[reasoning skill:001][spark:001]<guidance>上轮指导</guidance>';
    const config={enabled:true,world:'book',runMode:'auto',reasoningLimit:5,timeout:10,prompts:{...DEFAULT_PROMPTS}};
    const c={mainApi:'openai',getChatCompletionModel:()=> 'fixture',chat:[{is_user:true,mes:'one'}],chatId:'a',chatMetadata:{},
        saveMetadataDebounced(){},saveChat:async()=>{},stopGeneration(){},deactivateSendButtons(){},eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{makeLast(){},removeListener(){}},generateQuietPrompt:async()=>raw};
    const entries=[{id:'r',type:'reasoning',content:'SKILL_BODY'},{id:'s',type:'spark',content:'SPARK_BODY'}].map((s,i)=>({uid:i,world:'book',comment:s.id,content:s.content,disable:true,position:4,role:0,depth:0,order:i,
        [KEY]:{owner:KEY,kind:'skill',id:s.id,type:s.type,enabled:true}}));
    entries.push({uid:2,world:'book',content:'OLD_MIRROR',position:4,role:0,depth:0,disable:true,[KEY]:{owner:KEY,kind:'discovery',id:'g'}});
    const world={skills:async()=>entries.filter(e=>e[KEY].kind==='skill').map(e=>({id:e[KEY].id,type:e[KEY].type,title:e.comment,body:e.content})),entries:async()=>structuredClone(entries),ensureDiscovery:async content=>{entries[2].content=content;},analysisModules:async()=>[]};
    const flow=new Workflow(()=>c,()=>config,world),scan=()=>{const lore={chatLore:[],globalLore:structuredClone(entries)};flow.lore(lore);return lore.chatLore;};
    return {flow,c,config,entries,scan,answer:value=>{raw=value;}};
}

test('上轮有指导、本轮无标签：镜像、扫描、预计预览、实际快照与复制均不残留旧指导或元数据',async()=>{
    const f=fixture();await f.flow.intercept([],1,assert.fail,'normal');assert.ok(f.scan().some(e=>e.content==='上轮指导'));f.flow.captureGeneration();f.flow.finishGeneration(true);
    f.c.chat.push({is_user:true,mes:'two'});f.answer('[reasoning skill:001][spark:001]PRIVATE_ANALYSIS 候选与输出协议');
    await f.flow.intercept([],1,assert.fail,'normal');
    const preview=await f.flow.previewInjection(),provided=f.scan();
    assert.equal(f.entries[2].content,'');assert.deepEqual(provided.map(e=>e.content),['SKILL_BODY','SPARK_BODY']);
    assert.deepEqual(preview.items.map(i=>i.content),provided.map(e=>e.content));
    f.flow.captureGeneration();const actual=f.flow.store().history[0].generation;
    assert.equal(actual.guidanceMissing,true);assert.deepEqual(actual.items.map(i=>i.content),provided.map(e=>e.content));
    assert.equal(injectionText(actual),'SKILL_BODY\n\nSPARK_BODY');assert.ok(!injectionText(actual).includes('position'));assert.ok(!injectionText(actual).includes('PRIVATE_ANALYSIS'));
    const extra={...actual,scope:'说明'.repeat(10000),model:{diagnostic:'模型配置'.repeat(1000)}};
    assert.equal(injectionText(extra),injectionText(actual));assert.deepEqual(tokenTotals(extra.items),tokenTotals(actual.items));
});

test('玩家手写指导不需要标签；不替换正常素材正文或插入配置',async()=>{
    const f=fixture();f.config.runMode='manual';f.flow.editDraft({selected:{reasoning:['r'],spark:['s']},discovery:'直接手写指导'});await f.flow.apply();await f.flow.intercept([],1,assert.fail,'normal');
    assert.deepEqual(f.scan().map(e=>e.content),['SKILL_BODY','SPARK_BODY','直接手写指导']);assert.equal(f.scan()[0].role,0);assert.equal(f.scan()[0].order,0);
    const snap=assembleInjection(f.flow.active);assert.equal(snap.guidanceMissing,false);assert.equal(snap.tokens.guidance,Math.ceil('直接手写指导'.length/3.35));
});

test('统一协议追加到总协议中，不改写用户模块正文、格式或保存字段',()=>{
    const prompts={...DEFAULT_PROMPTS,protocol:'USER_PROTOCOL'},module={id:'m',name:'旧模块',analysis:'USER_ANALYSIS',outputFormat:'USER_FORMAT',injectionMode:'full'};
    const before=structuredClone({prompts,module}),sections=plannerSections(catalog,prompts,5,[module]);
    assert.ok(sections[3].content.startsWith('USER_PROTOCOL'));assert.ok(sections[3].content.includes('<guidance>'));
    assert.ok(sections[2].content.includes('USER_ANALYSIS'));assert.ok(sections[4].content.includes('USER_FORMAT'));assert.deepEqual({prompts,module},before);
});

test('未编辑的旧 AI 草稿重新提取；人工指导和显式历史快照保持已确认内容',async()=>{
    const f=fixture();await f.flow.plan();const draft=f.flow.current();delete draft.guidanceProtocol;draft.raw='旧版无标签分析';draft.discovery='旧版无标签分析';
    assert.equal(f.flow.current().discovery,'');
    f.flow.editDraft({discovery:'人工确认'});delete f.flow.current().guidanceProtocol;assert.equal(f.flow.current().discovery,'人工确认');
});

test('准确与估算 Token 明确分开；未知 tokenizer 的宿主数字不能冒充准确值',async()=>{
    const c={mainApi:'openai',getChatCompletionModel:()=> 'gemini-fixture',getTokenCountAsync:async()=>398,extensionSettings:{spark_planner:{}}};
    assert.equal(tokenLabel(await measureTextTokens('unknown model fixture',()=>c)),'≈Token：398');
    const original=globalThis.fetch;c.getChatCompletionModel=()=> 'gpt-4o';c.getRequestHeaders=()=>({});
    try {globalThis.fetch=async()=>({ok:true,json:async()=>({ids:[1,2,3]})});assert.equal(tokenLabel(await measureTextTokens('known encoding fixture',()=>c)),'Token：3');}
    finally {globalThis.fetch=original;}
});
