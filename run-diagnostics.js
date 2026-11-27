import { element as el, action, readDialog } from './editor.js';
import { showRequest } from './request-viewer.js';
import { requestBodyText, guidanceCount } from './run-evidence.js';
import { renderInjection } from './injection-viewer.js';
import { readingText } from './ui.js';

const EVENTS={
    'planner-started':'Planner 开始','planner-request':'Planner 请求发出','planner-transport':'Planner 传输响应','planner-returned':'Planner 输出返回',parsed:'解析完成','plan-applied':'方案已应用','awaiting-review':'等待审核',
    'generation-prepared':'Generation 装配就绪','generation-request':'Generation 请求发出','generation-transport':'Generation 传输响应','generation-completed':'正文生成完成','generation-failed':'正文生成失败','planner-failed':'Planner 失败',cancelled:'运行已取消','execution-released':'临时执行引用已释放',
};
export function diagnosticStages(record){
    const evidence=record.evidence,requests=evidence?.requests || {},generation=record.generation;
    const count=kind=>evidence?`${evidence.calls[kind]} 次请求`:'调用次数未记录';
    const raw=record.raw || '';
    return [
        ['Planner',record.plan?.source==='manual' && !record.request?'手动方案':count('planner'),false],
        ['Planner 请求',requests.planner?'已观察到浏览器发送':record.request?'保留序列化前快照':'尚未捕获',false],
        ['选材与指导解析',record.parsed?`解析完成 · ${guidanceCount(raw)} 个有效 guidance 标签`:raw?'保留原始输出，解析结果未记录':'未记录',!!raw && !guidanceCount(raw) && !!record.parsed],
        ['注入来源','实际注入记录不可用',true],
        ['Generation',count('generation'),false],
        ['正文状态',({succeeded:'生成成功',failed:'生成失败',requested:'已准备/发起请求',cancelled:'已取消',interrupted:'已中断'})[generation?.status] || '尚无正文执行记录',generation?.status==='failed'],
        ['临时状态',evidence?.events.some(e=>e.type==='execution-released')?'执行引用已释放':'未记录清理证据',false],
    ];
}
export function showRunDiagnostics(context,record,notify=()=>{},{editSkill}={}){
    // Freeze the selected run, rather than read a different live run after a tab switch.
    record=structuredClone(record);
    const copy=async text=>{try{await navigator.clipboard.writeText(text);notify('已复制');}catch{notify('无法访问剪贴板，可选择正文复制',true);}};
    const fold=(title,text)=>{const d=el('details');d.append(el('summary',title),el('pre',text));return d;};
    const requestView=(body,kind)=>{
        const request=record.evidence?.requests?.[kind];
        body.append(el('p',request?.body?'已捕获浏览器 → 酒馆请求；服务端供应商转换不在观测范围内。':requestBodyText(request),'spark-hint'));
        if(!request?.body)return;
        body.append(action('复制完整请求正文',()=>copy(requestBodyText(request))));
        if(request.body.messages)for(const [i,message] of request.body.messages.entries()){
            const part=fold(`${i+1}. ${message.role}`,typeof message.content==='string'?message.content:JSON.stringify(message.content,null,2));
            const extra=Object.fromEntries(Object.entries(message).filter(([key])=>!['role','content'].includes(key)));if(Object.keys(extra).length)part.append(fold('消息附加字段',JSON.stringify(extra,null,2)));body.append(part);
        }
        else body.append(el('pre',requestBodyText(request)));
        const extra=Object.fromEntries(Object.entries(request.body).filter(([key])=>!['messages','prompt','input'].includes(key)));if(Object.keys(extra).length)body.append(fold('模型可见附加字段',JSON.stringify(extra,null,2)));
        body.append(fold('请求参数',JSON.stringify(request.parameters,null,2)));
    };
    return readDialog(context,{title:'本轮运行诊断',notify,render:body=>{
        body.dataset.runDiagnostics='';
        const tabs=el('div',undefined,'spark-diagnostic-tabs'),pages=[];tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','运行诊断阶段');body.append(tabs);
        for(const [key,title] of [['overview','概览'],['planner','Planner 输入'],['response','响应与解析'],['generation','Generation 注入'],['timeline','运行时间线']]){
            const section=el('section');section.dataset.diagnosticPage=key;section.hidden=key!=='overview';
            const tab=action(title,()=>{for(const [page,button] of pages){page.hidden=page!==section;button.setAttribute('aria-selected',String(page===section));}section.hidden=false;tab.setAttribute('aria-selected','true');});tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(key==='overview'));pages.push([section,tab]);tabs.append(tab);body.append(section);
        }
        const get=key=>body.querySelector(`[data-diagnostic-page=${key}]`),overview=get('overview');
        const stages=el('div',undefined,'spark-diagnostic-stages');
        for(const [title,value,warning] of diagnosticStages(record)){const row=el('div',undefined,'spark-diagnostic-stage');row.dataset.warning=String(warning);row.append(el('span',title),el('span',value));stages.append(row);}overview.append(stages);
        if(record.error)overview.append(el('p','本轮存在失败或中断，请结合阶段记录排查。','spark-hint'));
        overview.append(el('p','最终消息没有逐素材来源标识，世界书激活与装配快照不能证明最终注入。','spark-hint'));
        const planner=get('planner');planner.append(el('p',`渠道：${record.request?.channelName || '未记录'} · 模型：${record.evidence?.requests?.planner?.parameters.model || record.request?.plannerModelId || '未记录'}`,'spark-hint'));requestView(planner,'planner');
        if(record.request)planner.append(action('查看提示词结构与原有快照',()=>showRequest(context,record,notify)));
        for(const section of record.request?.sections || [])planner.append(fold(section.title,section.content));
        if(record.request?.modules?.length){const d=el('details');d.append(el('summary','分析模块与模型适配'));for(const m of record.request.modules)d.append(el('p',`${m.name} · ${m.label || '无适用版本'} · ${m.assembled?'已进入任务':m.reason || '未进入任务'}`));planner.append(d);}
        const response=get('response');response.append(action('复制原始输出',()=>copy(record.raw || '')),fold('Planner 原始输出',record.raw || '无输出'));
        response.append(el('p',`${guidanceCount(record.raw)} 个有效 guidance 标签`),el('h4','提取的创作指导'),readingText(record.parsed?.discovery || '无有效指导'));
        const selected=record.parsed?.selected || record.plan?.original?.selected || record.plan?.selected;
        if(selected){const catalog=Object.values(record.request?.catalog || {}).flat();for(const [type,ids] of Object.entries(selected))response.append(el('p',`${type==='reasoning'?'Reasoning Skill':'火花'}：${ids.map(id=>catalog.find(s=>s.id===id)?.title || id).join('、') || '无'}`));}
        for(const warning of record.requestDiagnostics?.warnings || [])response.append(el('p',warning,'spark-hint'));
        if(record.applied)response.append(fold('玩家确认/修改后的方案指导',record.applied.discovery || '无指导'));
        const generation=get('generation');generation.append(el('p','实际注入记录不可用；未确认的条目不标记为已注入。','spark-hint'));
        for(const item of record.generation?.items || []){
            const activated=record.generation.activatedMaterials?.some(m=>m.id===item.id && m.kind===item.kind);
            generation.append(el('p',`${item.title} · ${item.versionLabel || '装配版本'} · 计划使用 · ${activated?'观察到世界书激活':'激活证据未记录'} · 最终来源未确认`));
            if(item.kind==='skill' && editSkill){const issue=el('p','','spark-hint');generation.append(action('编辑当前素材',async()=>{try{await editSkill(item.id,item.versionId);}catch(error){issue.textContent=error.message;}}),issue);}
        }
        if(record.generation?.items){const assembly=el('details');assembly.append(el('summary','当时装配正文'));const contents=el('div');assembly.append(contents);renderInjection(contents,record.generation,{kind:'assembly',notify});generation.append(assembly);}
        generation.append(el('h4','Generation 完整请求'));requestView(generation,'generation');
        const timeline=get('timeline'),list=el('ol',undefined,'spark-diagnostic-timeline');
        for(const event of record.evidence?.events || []){const row=el('li');row.append(el('time',new Date(event.time).toLocaleTimeString()),el('span',EVENTS[event.type] || event.type));if(event.httpStatus!=null)row.append(el('small',` · HTTP ${event.httpStatus}`));list.append(row);}timeline.append(list);
        if(!list.childNodes.length)timeline.append(el('p','此旧记录未保存阶段时间线。','spark-hint'));
        timeline.append(fold('精确时间与运行标识',JSON.stringify({timeUTC:record.time,id:record.id,turn:record.turn,chat:record.chat,reply:record.generation?.reply,requests:Object.values(record.evidence?.requests || {}).map(r=>({id:r.id,capturedAt:r.capturedAt,state:r.state}))},null,2)));
    }});
}
