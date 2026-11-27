import test from 'node:test';
import assert from 'node:assert/strict';
import { recentRounds, withPlannerTask } from '../planner-context.js';
import { inheritedPlanner, independentPlanner } from '../channels.js';

test('ten complete rounds include multiple character replies, omit greeting/current reply and preserve input',()=>{
    const chat=[{mes:'orphan greeting'}];
    for(let i=0;i<12;i++) chat.push({is_user:true,mes:`user-${i}`},{mes:`reply-${i}`},{mes:`second-${i}`});
    chat.push({is_user:true,mes:'current'},{mes:'existing current reply'});
    const before=structuredClone(chat), history=recentRounds(chat);
    assert.equal(history.length,30); assert.equal(history[0].content,'user-2');
    assert.equal(history.at(-1).content,'second-11'); assert.deepEqual(chat,before);
    assert.deepEqual(recentRounds([{mes:'greeting'},{is_user:true,mes:'unanswered'},{is_user:true,mes:'current'}]),[]);
});

test('native final API boundary appends task after preset tails/prefill and removes handler after request',async()=>{
    let handler, sent, inspected;
    const native=[{role:'system',content:'original preset'},{role:'user',content:'player input'},{role:'assistant',content:'prefill'},{role:'system',content:'tail'}];
    const c={mainApi:'openai',eventTypes:{CHAT_COMPLETION_SETTINGS_READY:'ready'},eventSource:{
        makeLast:(_event,fn)=>{handler=fn;},removeListener:(_event,fn)=>{assert.equal(handler,fn);handler=null;},
    }, generateQuietPrompt:async options=>{
        assert.equal(options.quietPrompt,'');
        sent={messages:structuredClone(native),max_completion_tokens:10};handler(sent);
        return '[spark:]\n三、心理发现\n发现';
    }};
    await inheritedPlanner(()=>c,{maxTokens:123},'TASK',undefined,s=>{inspected=s;});
    assert.deepEqual(sent.messages,withPlannerTask(native,'TASK'));
    assert.equal(sent.max_completion_tokens,123);assert.equal(handler,null);
    assert.deepEqual(inspected.messages,sent.messages);
    assert.equal(native.length,4);
    c.generateQuietPrompt=async()=>{throw new Error('network');};
    await assert.rejects(inheritedPlanner(()=>c,{},'TASK'),/network/);assert.equal(handler,null);
});

test('independent native capture appends a User task without including the task in dry-run',async()=>{
    let capture, data;
    const c={eventTypes:{GENERATE_AFTER_DATA:'built'},eventSource:{on:(_e,fn)=>{capture=fn;},removeListener:()=>{}},
        generate:async(type,options,dryRun)=>{
            assert.equal(type,'quiet'); assert.equal(dryRun,true); assert.equal(options.quiet_prompt,'');
            capture({prompt:[{role:'user',content:'original input'},{role:'assistant',content:'preset prefill'}]},true);
        },ChatCompletionService:{sendRequest:async request=>{data=request;return {content:'plan'};}},
    };
    await independentPlanner(()=>c,{url:'https://example.test',model:'planner'},{maxTokens:100},'TASK',new AbortController().signal,()=>{});
    assert.equal(data.messages.at(-1).role,'user');assert.equal(data.messages.at(-1).content,'TASK');
    assert.equal(data.messages.filter(m=>m.content==='original input').length,1);
});
