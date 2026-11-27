import { KEY, overlayLore } from './core.js';
import { NATIVE_FIELDS } from './skill-pack.js';
import { estimateTokens, measureTextTokens } from './text-stats.js';

export const INJECTION_SCOPE = '仅预览插件提供给世界书扫描的正文；原生预算、触发与裁剪仍可能影响最终请求。';

// The same overlay produces the execution scan and the preview. Store only the
// resolved body, identity and insertion fields, never all unused model versions.
export function assembleInjection(plan, packs) {
    const lore={chatLore:[]};
    overlayLore(lore,plan.entries || [],plan,true);
    const items=lore.chatLore.map(entry=>{
        const meta=entry[KEY], resolution=plan.generationResolution?.skills?.find(s=>s.id===(meta.skillId || meta.id));
        const type=meta.type || (meta.kind==='skill'?(plan.selected.reasoning.includes(meta.id)?'reasoning':'spark'):undefined);
        return {id:meta.id,skillId:meta.skillId,kind:meta.kind,type,
            title:entry.comment || (meta.kind==='discovery'?'创作指导':meta.id),packId:meta.packId,
            packName:packs?.packs.find(p=>p.id===meta.packId)?.name || '',
            versionId:resolution?.versionId,versionLabel:resolution?.label,
            content:entry.content,entry:Object.fromEntries(['uid','world','comment','content','disable',...NATIVE_FIELDS].filter(k=>entry[k]!==undefined).map(k=>[k,structuredClone(entry[k])])),
            tokens:estimateTokens(entry.content),estimated:true};
    });
    const selected={reasoning:[],spark:[]};for(const item of items)if(item.kind==='skill')selected[item.type].push(item.id);
    const guidance=(plan.entries || []).find(e=>e[KEY]?.kind==='discovery');
    const guidanceTemplate=guidance?{...Object.fromEntries(['uid','world','comment',...NATIVE_FIELDS].filter(k=>guidance[k]!==undefined).map(k=>[k,structuredClone(guidance[k])])),content:'',[KEY]:structuredClone(guidance[KEY])}:null;
    return {version:1,scope:INJECTION_SCOPE,selected,requestedSelection:structuredClone(plan.selected),discovery:plan.discovery || '',guidanceTemplate,guidanceMissing:plan.source!=='manual' && !!plan.guidanceMissing && !plan.discovery?.trim(),
        model:structuredClone(plan.generationResolution || {}),items,tokens:tokenTotals(items)};
}
export function tokenTotals(items) {
    const sum=type=>items.filter(i=>type==='guidance'?i.kind==='discovery':i.type===type || (type==='reasoning' && i.kind==='ecot')).reduce((n,i)=>n+i.tokens,0);
    return {reasoning:sum('reasoning'),spark:sum('spark'),guidance:sum('guidance'),total:items.reduce((n,i)=>n+i.tokens,0),estimated:items.some(i=>i.estimated)};
}
export async function measureInjection(snapshot,context) {
    for(const item of snapshot.items) {
        const result=await measureTextTokens(item.content,context);item.tokens=result.count;item.estimated=result.estimated;
    }
    snapshot.tokens=tokenTotals(snapshot.items);
    // Counts cover text only; native wrappers and the full context are excluded.
    snapshot.tokens.method=snapshot.items.some(i=>i.estimated)?'含本地字符估算':'宿主 tokenizer 文本计数';
    return snapshot;
}
export function snapshotEntries(snapshot) {
    const entries=snapshot.items.map(i=>({...structuredClone(i.entry),world:'spark-history',content:i.content,
        [KEY]:{owner:KEY,kind:i.kind,id:i.id,skillId:i.skillId,type:i.type,packId:i.packId}}));
    if(snapshot.guidanceTemplate && !entries.some(e=>e[KEY]?.kind==='discovery'))entries.push(structuredClone(snapshot.guidanceTemplate));
    return entries;
}
export function injectionText(snapshot) {
    return snapshot.items.map(i=>i.content).join('\n\n');
}
