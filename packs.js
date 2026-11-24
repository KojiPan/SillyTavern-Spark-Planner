import { KEY } from './core.js';

export const DEFAULT_PACK_ID = 'default';
export function validatePack(raw) {
    if (!raw || typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 200) throw new Error('创作包 ID 不合法');
    if (typeof raw.name !== 'string' || !raw.name.trim()) throw new Error('创作包名称不能为空');
    return { id:raw.id, name:raw.name.trim(), description:String(raw.description || ''),
        categories:[...new Set(['未分类',...(raw.categories || []).filter(c=>typeof c==='string' && c.trim())])] };
}
// Registry and affiliation live in the same WI transaction. Old records are adopted without touching their content or IDs.
export function migratePacks(data, legacyCategories = []) {
    data[KEY] ??= { packVersion:1, packs:[validatePack({id:DEFAULT_PACK_ID,name:'默认创作包',categories:legacyCategories})], defaultEnabledPackIds:[DEFAULT_PACK_ID] };
    const state=data[KEY];
    if(state.packVersion!==1 || !Array.isArray(state.packs) || !state.packs.length)throw new Error('创作包注册表版本或内容不受支持');
    for(const entry of Object.values(data.entries)) {
        const meta=entry[KEY];if(meta?.owner!==KEY || meta.kind!=='skill')continue;
        meta.packId ??= state.packs[0].id;
        const pack=state.packs.find(p=>p.id===meta.packId);
        if(!pack)throw new Error(`条目 ${meta.id} 的所属创作包不存在，请恢复备份`);
        pack.categories=[...new Set(['未分类',...(pack.categories || []),meta.category || '未分类'])];
    }
    return state;
}
export function enabledPackIds(state, store) {
    const ids=Array.isArray(store?.enabledPackIds)?store.enabledPackIds:state.defaultEnabledPackIds;
    return new Set((ids || []).filter(id=>state.packs.some(p=>p.id===id)));
}
export function packReason(packId, state, store) {
    if(!state)return '';
    const pack=state.packs.find(p=>p.id===(packId || DEFAULT_PACK_ID));
    return !pack?'所属创作包已删除':!enabledPackIds(state,store).has(pack.id)?`创作包「${pack.name}」在当前聊天未启用`:'';
}
export function preparePackImport(raw, records, state, current, idFactory=()=>crypto.randomUUID(), analysisModules=[]) {
    let pack=validatePack(raw), changes=[];
    if(state.packs.some(p=>p.id===pack.id) || state.retiredPackIds?.includes(pack.id)) {const old=pack.id;pack.id=idFactory();changes.push(`包 ID 冲突或曾被删除：${old} → ${pack.id}（作为新包）`);}
    const used=new Set(current.map(s=>s.id));
    const skills=records.map(source=>{
        const s=structuredClone(source);
        if(used.has(s.id)){const old=s.id;s.id=idFactory();changes.push(`条目 ID 冲突：${old} → ${s.id}（保留原条目）`);}
        used.add(s.id);s.packId=pack.id;return s;
    });
    pack.categories=[...new Set([...pack.categories,...skills.map(s=>s.category || '未分类')])];
    const modules=analysisModules.map(source=>{
        const m=structuredClone(source);
        if(used.has(m.id)){const old=m.id;m.id=idFactory();changes.push(`分析模块 ID 冲突：${old} → ${m.id}（保留原模块）`);}
        used.add(m.id);m.packId=pack.id;return m;
    });
    return {pack,skills,modules,changes};
}
