import { standaloneContext, withPlannerTask, inspectPlannerRequest } from './planner-context.js';

const SECRET = 'api_key_custom';
export function channelUrl(value) {
    const url = new URL(value);
    if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('渠道地址需为无密钥参数的 HTTP(S) API 根地址');
    return url.href.replace(/\/$/,'');
}
async function post(context, path, body, signal) {
    const response = await fetch(path, { method:'POST', headers:context().getRequestHeaders(), body:JSON.stringify(body), signal });
    if(!response.ok) throw new Error(`酒馆请求失败 (${response.status})`);
    return response.status === 204 ? null : response.json();
}
export async function saveChannelKey(context, channel, key) {
    if(!key) return channel;
    const state = await post(context,'/api/secrets/read',{});
    let active = state[SECRET]?.find(s=>s.active)?.id;
    // A blank sentinel preserves the main Custom connection's previous no-key state.
    if(!active) active=(await post(context,'/api/secrets/write',{key:SECRET,value:'',label:'主 Custom 空密钥（火花规划器保留原状态）'})).id;
    try {
        const { id }=await post(context,'/api/secrets/write',{key:SECRET,value:key,label:`火花 Planner · ${channel.name}`});
        return {...channel,secretId:id,secretUrl:channelUrl(channel.url)};
    } finally {
        await post(context,'/api/secrets/rotate',{key:SECRET,id:active});
        const secrets=await import('/scripts/secrets.js'); await secrets.readSecretState();
    }
}
export async function models(context, channel, signal) {
    checkChannel(channel);
    const result=await post(context,'/api/backends/chat-completions/status',{chat_completion_source:'custom',custom_url:channelUrl(channel.url),secret_id:channel.secretId || '__spark_no_key__'},signal);
    const entries=Array.isArray(result.data)?result.data:Array.isArray(result.models)?result.models:[];
    if(result.error || !entries.length) throw new Error('未取得模型列表，可手工填写模型名');
    return entries.map(x=>typeof x==='string'?x:x.id).filter(Boolean);
}
export async function inheritedPlanner(context,settings,prompt,signal,inspect) {
    const c=context();
    if(c.mainApi!=='openai' || !c.eventTypes?.CHAT_COMPLETION_SETTINGS_READY) throw new Error('Planner 最新 User 消息需要 Chat Completion；请切换主连接或选择独立 Planner 渠道。');
    if(settings.contextMode==='standalone') {
        const messages=withPlannerTask(await standaloneContext(context,settings),prompt);
        const {createGenerationParameters,getChatCompletionModel}=await import('/scripts/openai.js');
        const {generate_data}=await createGenerationParameters(c.chatCompletionSettings,getChatCompletionModel(c.chatCompletionSettings),'quiet',messages);
        setOutputLimit(generate_data,settings.maxTokens);
        // Provider parameter transforms must not replace the independent context.
        generate_data.messages=messages;
        inspectPlannerRequest(generate_data.messages,settings,inspect,generate_data,'service-send-request');
        return readResponse(c.ChatCompletionService.sendRequest(generate_data,true,signal),signal);
    }
    // The native boundary runs after preset tails, prefill and provider transforms.
    // Do not pass the task as quietPrompt: ST assigns that prompt the System role.
    const finalize=data=>{
        data.messages=withPlannerTask(data.messages,prompt);
        setOutputLimit(data,settings.maxTokens);
        inspectPlannerRequest(data.messages,settings,inspect,data,'native-settings-ready');
    };
    c.eventSource.makeLast(c.eventTypes.CHAT_COMPLETION_SETTINGS_READY,finalize);
    try {return await c.generateQuietPrompt({quietPrompt:'',quietToLoud:false,skipWIAN:false,forceChId:c.characterId});}
    finally {c.eventSource.removeListener(c.eventTypes.CHAT_COMPLETION_SETTINGS_READY,finalize);}
}
function setOutputLimit(data,limit) {
    if(Object.hasOwn(data,'max_completion_tokens')) data.max_completion_tokens=limit;
    else data.max_tokens=limit;
}
export function checkChannel(channel) {
    channelUrl(channel.url);
    if(channel.secretId && channel.secretUrl !== channelUrl(channel.url)) throw new Error('地址已改变，请重新填写该渠道密钥后保存');
}
export function requestData(channel, messages, settings) {
    checkChannel(channel);
    if(!channel.model?.trim()) throw new Error('请填写 Planner 模型名');
    const data={chat_completion_source:'custom',custom_url:channelUrl(channel.url),secret_id:channel.secretId || '__spark_no_key__',model:channel.model,messages,stream:!!channel.stream,max_tokens:settings.maxTokens,temperature:Number(channel.temperature ?? .7)};
    if(channel.effort) {data.reasoning_effort=channel.effort;data.custom_include_body=JSON.stringify({reasoning_effort:channel.effort});}
    const excluded=String(channel.exclude || '').split(/[,\s]+/).filter(Boolean);
    if(excluded.some(k=>['messages','model','stream'].includes(k))) throw new Error('不能排除 messages/model/stream');
    if(excluded.length) data.custom_exclude_body=JSON.stringify(excluded);
    return data;
}
export async function independentPlanner(context, channel, settings, prompt, signal, inspect) {
    const c=context(); let native;
    if(settings.contextMode==='standalone') return send(context,channel,settings,withPlannerTask(await standaloneContext(context,settings),prompt),signal,inspect);
    const capture=(data,dryRun)=>{ if(dryRun) native=structuredClone(data); };
    c.eventSource.on(c.eventTypes.GENERATE_AFTER_DATA,capture);
    try { await c.generate('quiet',{quiet_prompt:'',quietToLoud:false,skipWIAN:false,force_chid:c.characterId},true); }
    finally { c.eventSource.removeListener(c.eventTypes.GENERATE_AFTER_DATA,capture); }
    if(signal.aborted) throw new Error('Planner 已取消');
    const built=native?.prompt ?? native?.input;
    if(!built) throw new Error('无法获取原生完整生成上下文');
    const messages=Array.isArray(built)?built:[{role:'user',content:built}];
    return send(context,channel,settings,withPlannerTask(messages,prompt),signal,inspect);
}
export async function send(context,channel,settings,messages,signal,inspect) {
    const service=context().ChatCompletionService;
    if(!service) throw new Error('缺少官方 ChatCompletionService');
    const data=requestData(channel,messages,settings);
    if(inspect) inspectPlannerRequest(data.messages,settings,inspect,data,'service-send-request');
    return readResponse(service.sendRequest(data,true,signal),signal);
}
async function readResponse(pending,signal) {
    const response=await pending;
    if(typeof response!=='function') return response.content;
    let text='';
    for await(const chunk of response()) { if(signal?.aborted) throw new Error('Planner 已取消'); text=chunk.text; }
    return text;
}
