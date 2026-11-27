import { element as el, action, readDialog } from './editor.js';
import { injectionText } from './injection.js';
import { readingText } from './ui.js';

export const injectionTitle=kind=>kind==='actual'?'实际注入':kind==='assembly'?'历史装配快照':'预计注入';
export function renderInjection(body,snapshot,{kind='expected',notify=()=>{}}={}){
    body.dataset.injectionViewer='';
    const toolbar=el('div',undefined,'spark-compact-actions');
    toolbar.append(action('复制全部正文',async()=>{try{await navigator.clipboard.writeText(injectionText(snapshot));notify(`已复制${injectionTitle(kind)}正文`);}catch{notify('无法访问剪贴板，请选择正文复制',true);}}));
    const expand=action('全部展开',()=>{const next=expand.textContent==='全部展开';for(const detail of body.querySelectorAll('[data-material]'))detail.open=next;expand.textContent=next?'全部折叠':'全部展开';});toolbar.append(expand);body.append(toolbar);
    for(const [group,label] of [['guidance','本轮创作指导'],['reasoning','Reasoning Skill'],['spark','火花']]){
        const section=el('section',undefined,'spark-injection-group');section.dataset.injectionGroup=group;if(group!=='guidance')section.append(el('h4',label));
        const items=(snapshot.items || []).filter(i=>group==='guidance'?i.kind==='discovery':group==='reasoning'?i.type==='reasoning' || i.kind==='ecot':i.type==='spark');
        if(!items.length)section.append(el('p',group==='guidance'?'本轮无有效创作指导。':'本轮未选择'+label,'spark-hint'));
        for(const item of items){
            const detail=el('details',undefined,'spark-injection-item');detail.dataset.material='';detail.dataset.injectionIndex=String(snapshot.items.indexOf(item));
            detail.append(el('summary',`${item.kind==='discovery'?'本轮创作指导':item.title}${item.versionLabel?' · '+item.versionLabel:''}`));
            const text=readingText(item.content);text.dataset.injectionBody='';detail.append(text);section.append(detail);
        }
        body.append(section);
    }
}
export function showInjection(context,snapshot,{kind='assembly',notify=()=>{}}={}){
    return readDialog(context,{title:injectionTitle(kind),notify,render:body=>{
        body.append(el('p',kind==='actual'?'已确认的最终请求来源':kind==='assembly'?'保留当时装配正文；最终逐素材注入未确认。':'当前方案的预计材料','spark-hint'));
        renderInjection(body,snapshot,{kind,notify});
    }});
}
