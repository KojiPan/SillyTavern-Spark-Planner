import test from 'node:test';
import assert from 'node:assert/strict';
import { models, channelUrl, checkChannel, requestData } from '../channels.js';
import { ModelListLoader } from '../model-list.js';
import { historySummary, hasHistorySnapshot } from '../history-view.js';
import { channelTestFailure } from '../channel-settings.js';

test('model discovery uses authenticated ST status and exact URL/secret reference; preserves full IDs',async()=>{
    const original=globalThis.fetch,calls=[];
    globalThis.fetch=async(path,options)=>{calls.push({path,...options});return {ok:true,status:200,json:async()=>({data:[{id:'vendor/model (beta)/full'},{id:'模型/中文'},'other:id','other:id',{name:'invalid'},null]})};};
    try{
        const channel={url:'https://fixture.invalid/custom/v1/',secretUrl:'https://fixture.invalid/custom/v1',secretId:'channel-only'};
        assert.deepEqual(await models(()=>({getRequestHeaders:()=>({'x-csrf-token':'fixture'})}),channel),['vendor/model (beta)/full','模型/中文','other:id']);
        assert.equal(calls.length,1);assert.equal(calls[0].path,'/api/backends/chat-completions/status');
        assert.deepEqual(JSON.parse(calls[0].body),{chat_completion_source:'custom',custom_url:'https://fixture.invalid/custom/v1',secret_id:'channel-only'});
        assert.equal(calls[0].headers['x-csrf-token'],'fixture');
        assert.throws(()=>checkChannel({...channel,url:'https://other.invalid/v1'}),/地址已改变/);
        assert.equal(channelUrl('https://fixture.invalid/root/'),'https://fixture.invalid/root');
        assert.throws(()=>channelUrl('https://fixture.invalid?key=private'));
        assert.equal(requestData({...channel,model:'vendor/model (beta)/full'},[],{maxTokens:2048}).max_tokens,2048);
    }finally{globalThis.fetch=original;}
});
test('empty list, incompatible format, provider error, and HTTP failure stay distinct',async()=>{
    const original=globalThis.fetch,context=()=>({getRequestHeaders:()=>({})}),channel={url:'http://127.0.0.1/v1'};
    try{
        for(const response of [{data:[]},{models:[]},{} ,{error:true}]){
            globalThis.fetch=async()=>({ok:true,status:200,json:async()=>response});
            if('data' in response || 'models' in response)assert.deepEqual(await models(context,channel),[]);
            else await assert.rejects(models(context,channel),/不兼容|请求失败/);
        }
        globalThis.fetch=async()=>({ok:false,status:401});await assert.rejects(models(context,channel),/401/);
    }finally{globalThis.fetch=original;}
});
test('late model responses, failures and editor close cannot overwrite new credentials',async()=>{
    const pending=[],states=[],loader=new ModelListLoader((channel,signal)=>new Promise((resolve,reject)=>pending.push({channel,signal,resolve,reject})),state=>states.push(state));
    const old=loader.refresh({url:'old'}),next=loader.refresh({url:'new'});
    assert.equal(pending[0].signal.aborted,true);pending[1].resolve(['new/full (id)']);await next;
    pending[0].resolve(['old']);await old;assert.deepEqual(states.at(-1),{state:'ready',ids:['new/full (id)']});
    const closed=loader.refresh({url:'closed'});loader.invalidate();const size=states.length;pending[2].reject(new Error('late failure'));await closed;assert.equal(states.length,size);
    const empty=loader.refresh({});pending[3].resolve([]);await empty;assert.equal(states.at(-1).state,'empty');
    const failed=loader.refresh({});pending[4].reject(new Error('safe error'));await failed;assert.equal(states.at(-1).state,'failed');
});
test('history derives short input summaries without AI and groups across local midnight',()=>{
    const record={id:'internal',turn:'turn',time:'2026-11-26T18:30:00.000Z',plan:{input:'玩家输入 '.repeat(40),selected:{}},generation:{reply:{index:4},model:{modelId:'DO_NOT_SHOW'}}};
    const result=historySummary(record);assert.equal(result.title,'回复 5');assert.ok(result.summary.startsWith('玩家输入'));assert.ok(result.summary.length<70);assert.ok(!JSON.stringify(result).includes('DO_NOT_SHOW'));
    const local=new Date(record.time);assert.equal(result.dayKey,`${local.getFullYear()}-${local.getMonth()}-${local.getDate()}`);
    assert.equal(historySummary({turn:'t',time:'invalid'},[{is_user:true,mes:'CHAT_INPUT',extra:{spark_planner:'t'}}]).summary,'CHAT_INPUT');
    assert.equal(historySummary({time:'invalid'}).summary,'仅规划');assert.equal(historySummary({time:'invalid'}).time,'时间未记录');
    assert.equal(hasHistorySnapshot({generation:{model:{modelId:'legacy'}}}),false);
    assert.equal(hasHistorySnapshot({generation:{items:[],selected:{reasoning:[],spark:[]}}}),true);
});
test('test errors explain authentication/model/quota failures without echoing credentials',()=>{
    for(const [message,expected] of [['401 invalid key fixture-secret',/认证失败/],['model not found fixture-secret',/模型不存在/],['429 quota fixture-secret',/额度不足/],['arbitrary fixture-secret',/请检查/]]){
        const result=channelTestFailure(new Error(message));assert.match(result,expected);assert.ok(!result.includes('fixture-secret'));
    }
});
