import test from 'node:test';
import assert from 'node:assert/strict';
import { characterCount, countTextTokens } from '../text-stats.js';

test('character count includes punctuation, spaces, newlines and astral characters once',()=>{
    assert.equal(characterCount('中 a\n😀 '),6);
    assert.equal(characterCount(''),0);
});

test('counts reuse native tokenizer and cache by model; an independent Planner uses its own model',async()=>{
    let calls=0,model='generation-a';
    const c={mainApi:'openai',getChatCompletionModel:()=>model,getTokenCountAsync:async()=>{calls++;return 17;},extensionSettings:{spark_planner:{}}};
    assert.equal(await countTextTokens('TEXT',()=>c),17);
    assert.equal(await countTextTokens('TEXT',()=>c),17);assert.equal(calls,1);
    model='generation-b';await countTextTokens('TEXT',()=>c);assert.equal(calls,2);
    c.extensionSettings.spark_planner={channelId:'planner',channels:[{id:'planner',model:'planner-special'}]};
    c.getRequestHeaders=()=>({});const before=globalThis.fetch;
    try {
        globalThis.fetch=async(url,options)=>{
            assert.equal(url,'/api/tokenizers/openai/encode?model=planner-special');assert.equal(JSON.parse(options.body).text,'TEXT');
            return {ok:true,json:async()=>({count:23})};
        };
        assert.equal(await countTextTokens('TEXT',()=>c,'planner'),23);assert.equal(calls,2);
        assert.equal(await countTextTokens('',()=>c,'planner'),0);
        globalThis.fetch=async()=>({ok:false});await assert.rejects(countTextTokens('ERROR',()=>c,'planner'),/unavailable/);
    }finally{globalThis.fetch=before;}
});
