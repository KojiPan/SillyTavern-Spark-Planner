import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizedRequest, retainRequestBodies, guidanceCount, requestBodyText } from '../run-evidence.js';
import { installRequestObserver } from '../request-observer.js';
import { guidanceView } from '../current-workspace.js';

test('final request evidence excludes transport credentials and preserves model-visible message order',()=>{
    const data={model:'vendor/full (id)',messages:[{role:'system',content:'A',authorization:'secret'},{role:'user',content:'B'}],custom_url:'http://private',secret_id:'private-id',api_key:'private-key',headers:{Authorization:'private'}};
    const original=structuredClone(data),saved=sanitizedRequest(data,'generation');
    assert.deepEqual(data,original);assert.equal(requestBodyText(saved),'[1] system\nA\n\n[2] user\nB');assert.equal(saved.parameters.model,data.model);
    assert.ok(!JSON.stringify(saved).includes('private'));assert.ok(!JSON.stringify(saved).includes('authorization'));
});
test('request observation forwards the exact arguments, signal and original response promise',async()=>{
    const signal=new AbortController().signal,body=JSON.stringify({messages:[{role:'user',content:'unchanged'}]}),init={method:'POST',body,signal,headers:{test:'x'}};
    const promise=Promise.resolve({status:200}),seen=[],results=[];
    const target={location:{href:'http://local/'},fetch:(...args)=>{seen.push(args);return promise;}};
    const flow={observeTransport:value=>value===body?{id:'observed'}:null,observeTransportResult:(receipt,status)=>results.push([receipt.id,status])};
    const original=target.fetch,dispose=installRequestObserver(flow,target);
    assert.equal(target.fetch('/api/backends/chat-completions/generate',init),promise);await promise;await Promise.resolve();
    assert.equal(seen[0][1],init);assert.equal(seen[0][1].signal,signal);assert.deepEqual(results,[['observed',200]]);dispose();assert.equal(target.fetch,original);
});
test('bounded new request bodies are cleared without deleting history, raw output, assembly or old snapshots',()=>{
    const history=Array.from({length:8},(_,i)=>({id:String(i),raw:'RAW',generation:{items:[{content:'FROZEN'}]},request:{messages:['OLD']},evidence:{requests:{generation:{capturedAt:String(100+i),body:{prompt:'TEXT'},state:'captured'}}}}));
    retainRequestBodies(history);assert.equal(history.length,8);assert.equal(history.filter(r=>r.evidence.requests.generation.body).length,5);
    assert.ok(history.every(r=>r.raw==='RAW' && r.request.messages[0]==='OLD' && r.generation.items[0].content==='FROZEN'));
    assert.equal(history[0].evidence.requests.generation.state,'cleared');
});
test('guidance counts follow complete balanced tags; assembly cannot become actual guidance',()=>{
    assert.equal(guidanceCount('outside<guidance>one</guidance><guidance>two</guidance>'),2);assert.equal(guidanceCount('<guidance>outer<guidance>inner</guidance>end</guidance>'),0);assert.equal(guidanceCount('<guidance>unclosed'),0);
    const record={generation:{discovery:'ASSEMBLY',items:[]}};
    assert.deepEqual(guidanceView({discovery:'DRAFT',applied:false},record),{text:'DRAFT',kind:'草稿 · 未应用',switchable:false,choice:'draft'});
    const confirmed={generation:{actualInjection:{state:'confirmed',discovery:'ACTUAL'}}};
    assert.equal(guidanceView({discovery:'DRAFT',applied:true},confirmed).text,'ACTUAL');assert.equal(guidanceView({discovery:'EDITED',applied:false},confirmed).text,'EDITED');
    assert.equal(guidanceView({discovery:'DRAFT'},record,'actual').text,'DRAFT');
});
