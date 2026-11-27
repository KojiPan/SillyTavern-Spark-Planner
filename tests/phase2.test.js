import test from 'node:test';
import assert from 'node:assert/strict';
import { exportPack, importPack, toMarkdown, fromMarkdown, validateSkill } from '../skill-pack.js';
import { parsePlanner, freezeCatalog, KEY, migrateDefaults, DEFAULT_PROMPTS } from '../core.js';
import { requestData, channelUrl } from '../channels.js';
import { Workflow } from '../workflow.js';
const skill={id:'stable-001',type:'spark',title:'旧标题',category:'动作/情绪',body:'自由格式正文\n---\n不强制模板',recommendation:'按情境',enabled:false,native:{position:7,role:2,depth:5,outletName:'koji_cot',probability:80,triggers:['swipe']}};
test('ZIP + Markdown roundtrip preserves stable ID, position, role, depth, outlet and native config',()=>{
    const zip=exportPack([skill],['动作/情绪']); const result=importPack(zip,JSON.parse);
    assert.deepEqual(result,[validateSkill(skill)]);
    const md=toMarkdown(skill).replace('旧标题','重命名标题');
    assert.equal(fromMarkdown(md).id,skill.id);assert.equal(fromMarkdown(md).title,'重命名标题');
    assert.ok(!new TextDecoder().decode(zip).includes('api_key'));
});
test('imports reject invalid field ranges and duplicate IDs',()=>{
    assert.throws(()=>validateSkill({...skill,native:{depth:-1}}));
    assert.throws(()=>fromMarkdown('没有 frontmatter'));
    assert.throws(()=>importPack(new Uint8Array(10*1024*1024+1)));
    assert.throws(()=>exportPack([skill,{...skill,category:'other'}]),/重复/);
    assert.deepEqual(importPack(exportPack([],['空分类'])).categories,['空分类']);
});
test('new defaults migrate builtins while preserving customized text and chosen token limit',()=>{
    const fresh={};migrateDefaults(fresh);assert.deepEqual(fresh.prompts,DEFAULT_PROMPTS);
    const custom={prompts:{task:'我的自定义任务'},maxTokens:4096};migrateDefaults(custom);assert.equal(custom.prompts.task,'我的自定义任务');assert.equal(custom.maxTokens,4096);
    const old={maxTokens:1500};migrateDefaults(old);assert.equal(old.maxTokens,32768);
});
test('new output protocol extracts psychological section only; reasons cannot enable skills',()=>{
    const catalog=freezeCatalog([{...skill,enabled:true}]);
    const raw='一、reasoning skill选择理由概述\n本轮不选\n最终选择：[reasoning skill:]\n二、火花选择理由概述\n适合拥抱\n最终选择：[spark:001]\n三、心理发现\n1. 本轮情感核心：复杂情绪\n2. 人物心理发现：私人矛盾';
    const parsed=parsePlanner(raw,catalog);
    assert.deepEqual(parsed.selected.spark,[skill.id]);assert.equal(parsed.discovery,'');
    assert.ok(!parsed.discovery.includes('适合拥抱'));
    const referenced=parsePlanner('理由里举例 [spark:999]\n最终选择：[spark:001]\n三、心理发现\n指导',catalog);
    assert.ok(referenced.warnings.every(w=>w.includes('缺少 reasoning') || w.includes('guidance')));assert.deepEqual(referenced.selected.spark,[skill.id]);
});
test('independent channel sends secret ID only and requires key rebinding after URL change',()=>{
    const channel={url:'https://example.test/v1',model:'model',secretId:'server-secret-id',secretUrl:'https://example.test/v1',effort:'high',exclude:'top_p,frequency_penalty',stream:true};
    const data=requestData(channel,[{role:'user',content:'native context'}],{maxTokens:52000});
    assert.equal(data.max_tokens,52000);assert.equal(data.secret_id,'server-secret-id');assert.equal(data.reasoning_effort,'high');
    assert.equal(data.custom_exclude_body,'["top_p","frequency_penalty"]');assert.ok(!('api_key' in data));
    assert.throws(()=>requestData({...channel,url:'https://unrelated.test/v1'},[],{maxTokens:1}));
    assert.throws(()=>channelUrl('javascript:alert(1)'));
});
test('P2 legacy history restores latest material as an unapplied draft and never labels it a historical body',async()=>{
    const user={is_user:true,mes:'当前输入',extra:{[KEY]:'turn-b'}};
    const source={id:'source',time:'old',raw:'原始输出',parsed:{selected:{reasoning:[],spark:['stable-001']},discovery:'原发现',warnings:[]},applied:{id:'source',turn:'turn-a',input:'旧输入',selected:{reasoning:[],spark:['stable-001']},discovery:'原发现',entries:[{content:'冻结正文'}]}};
    const c={chat:[user],chatId:'c',characterId:1,chatMetadata:{[KEY]:{plans:{},history:[source]}},saveChat:async()=>{},saveMetadataDebounced:()=>{}};
    const world={ensureDiscovery:async()=>{},entries:async()=>[{content:'后来修改的正文'}]};
    const flow=new Workflow(()=>c,()=>({reasoningLimit:5}),world);
    const before=structuredClone(source);const plan=await flow.reuse('source');
    assert.deepEqual(source,before);assert.equal(plan.entries[0].content,'后来修改的正文');assert.equal(plan.turn,'turn-b');assert.notEqual(plan.id,'source');
    assert.equal(plan.applied,false);assert.equal(flow.store().history.length,1);
    await assert.rejects(flow.reuse('source','snapshot'),/未保存实际正文快照/);
});
