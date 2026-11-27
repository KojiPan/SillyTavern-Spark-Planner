import { element as el, action, editDialog } from './editor.js';

export const contentText=value=>typeof value==='string'?value:JSON.stringify(value,null,2) ?? '';
export function messageText(message) {
    const extra=Object.fromEntries(Object.entries(message).filter(([key])=>!['role','content'].includes(key)));
    return contentText(message.content)+(Object.keys(extra).length?`\n\n消息附加字段：\n${JSON.stringify(extra,null,2)}`:'');
}
export const requestCharacters=request=>(request?.messages || []).reduce((n,m)=>n+contentText(m.content).length,0);
export function requestText(request) {
    if(!request)return '此记录未保存实际请求';
    return [`Planner: ${request.plannerModelId || '未知'} · Generation: ${request.generationModelId || '未知'}`,
        `模式：${request.mode==='standalone'?'独立默认预设':'沿用酒馆预设'}`,`快照阶段：${request.boundaryNote || request.boundary || '未标记'}`,
        `模型参数：${JSON.stringify(request.parameters || {},null,2)}`,...(request.transportNotes || []),
        ...(request.messages || []).map((m,i)=>`[${i+1}] ${m.role}\n${messageText(m)}`)].join('\n\n');
}

export async function showRequest(context,record,notify=()=>{}) {
    // Everything in this window comes from this saved record, never live settings.
    const request=structuredClone(record.request), diagnostics=structuredClone(record.requestDiagnostics || {});
    const copy=async text=>{
        try{await navigator.clipboard.writeText(text);notify('已复制');}
        catch{await editDialog(context,{title:'复制内容',readOnly:true,large:true,fields:{text:{label:'可手动选择复制',type:'textarea',value:text}},notify});}
    };
    const download=(ext,text)=>{
        const url=URL.createObjectURL(new Blob([text],{type:ext==='json'?'application/json':'text/plain;charset=utf-8'}));
        const a=el('a');a.href=url;a.download=`spark-request-${String(record.id).replace(/[^\w-]/g,'_')}.${ext}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    };
    await editDialog(context,{title:'Planner 实际请求',readOnly:true,large:!!request,fields:{},notify,setup:({form,body,popup})=>{
        popup.dlg.classList.add('spark-request-dialog');
        body.dataset.requestViewer='';
        body.tabIndex=0;body.setAttribute('aria-label','请求阅读区');
        if(!request){body.append(el('p','此记录未保存实际请求'));return;}
        const meta=el('div',undefined,'spark-request-meta');
        meta.append(el('p',`${request.mode==='standalone'?'独立默认预设':'沿用酒馆预设'} · 浏览器→酒馆 · ${(request.messages || []).length} 条消息`),
            el('p',`Planner：${request.plannerModelId || '未知'} · Generation：${request.generationModelId || '未知'}`));
        if(record.error)meta.append(el('p',`失败原因：${record.error}`,'spark-editor-error'));
        const toolbar=el('div',undefined,'spark-request-toolbar');
        toolbar.append(action('复制完整请求',()=>copy(requestText(request))),action('导出 TXT',()=>download('txt',requestText(request))),action('导出 JSON',()=>download('json',JSON.stringify({request,diagnostics,status:record.status,error:record.error || null},null,2))));
        const tabs=el('div',undefined,'spark-request-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','实际请求视图');
        const structure=action('提示词结构',()=>render('structure')), full=action('完整请求',()=>render('full'));
        for(const tab of [structure,full])tab.setAttribute('role','tab');tabs.append(structure,full);
        body.before(meta,toolbar,tabs);
        function part(title,content,source,key) {
            const details=el('details',undefined,'spark-request-part');details.dataset.requestPart=key;
            details.append(el('summary',title));
            // Long text grows within the dialog's one scroll area. Messages remain collapsed.
            let rendered=false;
            details.addEventListener('toggle',()=>{
                if(!details.open || rendered)return;rendered=true;
                if(source)details.append(el('p',source,'spark-request-source'));
                const copyPart=action('复制此部分',()=>copy(content));copyPart.setAttribute('aria-label',`复制 ${title}`);details.append(copyPart,el('pre',content));
            });
            return details;
        }
        function render(view) {
            structure.setAttribute('aria-selected',String(view==='structure'));full.setAttribute('aria-selected',String(view==='full'));
            body.replaceChildren();body.scrollTop=0;
            if(view==='structure') {
                for(const section of request.sections || []) {
                    const sources=(section.sources || []).map(s=>`${s.order}. ${s.source || s.name}${s.number?' · 本轮编号 '+s.number:''}：${s.enabled===false?'未启用':s.assembled===false?'已跳过':s.label || '已装配'}${s.reason?' · '+s.reason:''}`);
                    body.append(part(`${section.order}. ${section.title}${section.enabled?'':'（未装配）'}`,section.content,[`来源：${section.source}`,...sources].join('\n'),section.id));
                }
                const debug=part('模型参数、编号映射与解析诊断',JSON.stringify({parameters:request.parameters,catalog:request.catalog,modules:request.modules,diagnostics:{...request.diagnostics,...diagnostics}},null,2),'冻结于本次请求','diagnostics');body.append(debug);
            } else for(const [i,message] of (request.messages || []).entries())body.append(part(`${i+1}. ${message.role}`,messageText(message),'按实际发送顺序；原消息结构保留在 JSON 中',`message-${i}`));
            const boundary=el('details',undefined,'spark-request-boundary');boundary.append(el('summary','快照阶段'),el('p',[request.boundaryNote || request.boundary,...(request.transportNotes || [])].join('\n')));body.append(boundary);
        }
        tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tab=e.key==='Home'?structure:e.key==='End'?full:document.activeElement===structure?full:structure;tab.click();tab.focus();});
        render('structure');
    }});
}
