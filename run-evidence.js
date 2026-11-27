// Evidence only: never add markers to prompts or change request/generation behavior.
const PARAMETERS=['model','chat_completion_source','stream','max_tokens','max_completion_tokens','temperature','top_p','top_k','min_p','seed','reasoning_effort','custom_prompt_post_processing'];
export function sanitizedRequest(data,kind){
    const body={};
    if(Array.isArray(data.messages))body.messages=data.messages.map(message=>Object.fromEntries(['role','content','name','tool_calls','tool_call_id'].filter(k=>message[k]!==undefined).map(k=>[k,structuredClone(message[k])])));
    else for(const key of ['prompt','input'])if(typeof data[key]==='string')body[key]=data[key];
    for(const key of ['tools','tool_choice','response_format','json_schema','system','stop'])if(data[key]!==undefined)body[key]=structuredClone(data[key]);
    const request={schemaVersion:1,id:crypto.randomUUID(),kind,state:'captured',capturedAt:new Date().toISOString(),boundary:'browser-fetch',parameters:Object.fromEntries(PARAMETERS.filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])])),body};
    if(JSON.stringify(body).length>500000){delete request.body;request.state='too-large';}
    return request;
}
export function evidenceEvent(record,type,detail={}){
    if(!record)return;
    const evidence=record.evidence ||= {schemaVersion:1,calls:{planner:0,generation:0},events:[],requests:{}};
    evidence.events.push({time:new Date().toISOString(),type,...detail});if(evidence.events.length>80)evidence.events.splice(0,evidence.events.length-80);
    return evidence;
}
export function retainRequestBodies(history){
    let count=0,total=0;
    const requests=history.flatMap(record=>Object.values(record.evidence?.requests || {})).filter(r=>r.body).sort((a,b)=>b.capturedAt.localeCompare(a.capturedAt));
    for(const request of requests){const size=JSON.stringify(request.body).length;count++;total+=size;if(count>5 || total>1500000){delete request.body;request.state='cleared';}}
}
export function guidanceCount(raw){
    let count=0,start=-1,depth=0,valid=true;
    for(const token of String(raw || '').matchAll(/<\/?guidance\b[^>]*>/g)){
        if(!token[0].startsWith('</')){if(!depth){start=token.index+token[0].length;valid=token[0]==='<guidance>';}else valid=false;depth++;}
        else if(depth){if(token[0]!=='</guidance>')valid=false;if(!--depth && valid && raw.slice(start,token.index).trim())count++;}
    }
    return count;
}
export function requestBodyText(request){
    if(!request?.body)return request?.state==='cleared'?'完整请求正文已按保留范围清理':request?.state==='too-large'?'请求过大，未保留完整正文':'尚未捕获最终请求';
    const body=request.body;
    const text=body.messages?body.messages.map((m,i)=>`[${i+1}] ${m.role}\n${typeof m.content==='string'?m.content:JSON.stringify(m.content,null,2)}${m.tool_calls?'\n'+JSON.stringify(m.tool_calls,null,2):''}`).join('\n\n'):body.prompt ?? body.input ?? '';
    const extra=Object.fromEntries(Object.entries(body).filter(([key])=>!['messages','prompt','input'].includes(key)));
    return text+(Object.keys(extra).length?'\n\n模型可见附加字段\n'+JSON.stringify(extra,null,2):'');
}
