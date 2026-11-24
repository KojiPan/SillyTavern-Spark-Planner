import { element as el, action, editDialog } from './editor.js';
import { enabledPackIds, preparePackImport } from './packs.js';
import { exportPack, importPack, fromMarkdown } from './skill-pack.js';
import { mergeImportedTags, generationModel, resolveSkills } from './model-versions.js';
import { KEY } from './core.js';

export function installPackManager(root,context,settings,world,flow,refresh,notify,download) {
    const panel=el('details',undefined,'spark-card spark-fold');panel.append(el('summary','创作包管理'));
    panel.dataset.packManager='';
    const body=el('div',undefined,'spark-fold-body'), selector=el('select'), info=el('p',undefined,'spark-hint');
    selector.setAttribute('aria-label','管理创作包');
    const defaults=el('div',undefined,'spark-pack-defaults'), chatInfo=el('p',undefined,'spark-hint');
    let state,skills=[];
    const selected=()=>state?.packs.find(p=>p.id===selector.value);
    const idle=()=>{if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束后管理创作包');};
    const button=(text,fn)=>action(text,async()=>{try{idle();await fn();}catch(e){notify(e.message,true);}});
    const requirePack=()=>{const p=selected();if(!p)throw new Error('请先绑定世界书并选择创作包');return p;};
    async function edit(existing) {
        if(!settings().world)throw new Error('请先绑定世界书');
        const pack=existing || {id:crypto.randomUUID(),name:'新创作包',description:'',categories:['未分类']};
        await editDialog(context,{title:existing?'编辑创作包':'新建创作包',notify,fields:{name:{label:'包名称',required:true,value:pack.name},description:{label:'描述',type:'textarea',rows:3,value:pack.description}},submit:async v=>{
            idle();await world.savePack({...pack,...v});await refresh();selector.value=pack.id;showInfo();notify(existing?'创作包已保存':'创作包已创建，尚未启用');
        }});
    }
    function showInfo(){const p=selected();info.textContent=p?`${p.name} · ${skills.filter(s=>s.packId===p.id).length} 项条目 · ${(state.analysisModules || []).filter(m=>m.packId===p.id).length} 个分析模块${p.description?' · '+p.description:''}`:'请先绑定世界书';}
    selector.addEventListener('change',showInfo);
    const actions=el('div',undefined,'spark-compact-actions');
    actions.append(button('新建空创作包',()=>edit()),button('重命名 / 描述',()=>edit(requirePack())),button('复制可选火花目录',async()=>{
        const model=await generationModel(context);
        const text=resolveSkills(await flow.candidateSkills(),model.modelId,settings().modelTags || []).filter(s=>s.type==='spark').map(s=>`${s.title} — 推荐开启：${s.recommendation || '按情境判断'}`).join('\n');
        try{await navigator.clipboard.writeText(text);notify('可选火花目录已复制');}catch{const node=el('textarea');node.value=text;node.rows=12;await context().Popup.show.text('火花目录（可手动复制）',node);}
    }),button('导出所选包 ZIP',async()=>{
        const p=requirePack(), modules=(await world.analysisModules()).filter(m=>m.packId===p.id);
        download(`${p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}.zip`,exportPack(skills.filter(s=>s.packId===p.id),p.categories,settings().modelTags || [],p,modules),'application/zip');
    }),button('复制创作包',async()=>{
        const p=requirePack(), copy={...p,id:crypto.randomUUID(),name:p.name+'（副本）'};
        const modules=(await world.analysisModules()).filter(m=>m.packId===p.id).map(m=>({...m,id:crypto.randomUUID(),packId:copy.id}));
        await world.importSkills(skills.filter(s=>s.packId===p.id).map(s=>({...s,id:crypto.randomUUID(),packId:copy.id})),undefined,false,copy,modules);
        await refresh();selector.value=copy.id;showInfo();notify('创作包已复制，尚未启用；副本条目使用新 ID');
    }),button('删除创作包',async()=>{
        const p=requirePack(), count=skills.filter(s=>s.packId===p.id).length;
        if(state.packs.length<=1)throw new Error('至少保留一个创作包作为新条目的默认归属');
        const text=`删除「${p.name}」及其中 ${count} 项条目、${(state.analysisModules || []).filter(m=>m.packId===p.id).length} 个分析模块、对应的插件管理世界书条目与 ECoT 关联。历史规划和已完成请求快照保留，但已删除条目无法再次应用。普通世界书条目不受影响。`;
        if(!await context().Popup.show.confirm('确认删除创作包',el('p',text).outerHTML))return;
        await world.removePack(p.id);flow.active=null;await refresh();notify('创作包已删除，历史保留');
    }));
    const upload=el('input');upload.type='file';upload.accept='.zip,.md';upload.setAttribute('aria-label','导入创作包 ZIP 或 Markdown');
    upload.addEventListener('change',()=>void (async()=>{
        const file=upload.files[0];if(!file)return;idle();if(file.size>10*1024*1024)throw new Error('导入文件超过 10MB');
        const parse=text=>SillyTavern.libs.yaml.parse(text);
        const records=/\.zip$/i.test(file.name)?importPack(new Uint8Array(await file.arrayBuffer()),parse):[fromMarkdown(await file.text(),parse)];
        const rawPack=records.pack || records[0]?.pack || {id:crypto.randomUUID(),name:file.name.replace(/\.(zip|md)$/i,''),categories:records.categories || []};
        const worldName=settings().world, chat=flow.chatKey();
        const currentModules=await world.analysisModules();const latest=await world.reload(), current=await world.skills();
        const prepared=preparePackImport(rawPack,records,latest.data[KEY],[...current,...currentModules],undefined,records.analysisModules || []);
        const tagFingerprint=JSON.stringify(settings().modelTags || []);
        const merged=mergeImportedTags(settings().modelTags || [],[...(records.modelTags || []),...records.flatMap(s=>s.modelTags || [])],[...prepared.skills,...prepared.modules]);
        const importedSkills=merged.skills.slice(0,prepared.skills.length), importedModules=merged.skills.slice(prepared.skills.length);
        const box=el('div');box.append(el('h3','作为新创作包导入'),el('p',`${prepared.pack.name} · ${importedSkills.length} 项条目 · ${importedModules.length} 个分析模块 · 导入后不自动启用`));
        for(const change of [...prepared.changes,...merged.changes])box.append(el('p',change));
        const details=el('details');details.append(el('summary','查看分类、条目和分析模块预览'),el('pre',JSON.stringify({pack:prepared.pack,skills:importedSkills,analysisModules:importedModules},null,2)));box.append(details);
        if(!await context().Popup.show.confirm('确认导入创作包',box.outerHTML))return;
        idle();if(settings().world!==worldName || flow.chatKey()!==chat || JSON.stringify(settings().modelTags || [])!==tagFingerprint)throw new Error('聊天、绑定世界书或模型标签已变化，请重新导入预览');
        await world.importSkills(importedSkills,JSON.stringify(latest.data),false,prepared.pack,importedModules);
        settings().modelTags=merged.tags;context().saveSettingsDebounced();await refresh();selector.value=prepared.pack.id;showInfo();notify('创作包已导入；请在创作库确认启用后参与 Planner');
    })().catch(e=>notify(e.message,true)).finally(()=>{upload.value='';}));
    body.append(selector,info,actions,el('p','导入 ZIP / Markdown（旧格式也作为新包导入；ID 冲突将在预览中重分配，不覆盖原内容）','spark-hint'),upload,el('strong','全局默认启用组合'),defaults,
        button('保存全局默认组合',async()=>{await world.defaultPacks([...defaults.querySelectorAll('input:checked')].map(n=>n.value));flow.active=null;await refresh();notify('全局默认组合已保存；已有聊天覆盖保持不变');}),chatInfo,
        button('当前聊天恢复继承全局',async()=>{flow.setEnabledPacks(null);await refresh();notify('当前聊天已恢复继承全局组合');}));
    panel.append(body);root.querySelector('[data-page=settings]').append(panel);
    return {render(next){skills=next;state=flow.packState;const id=selector.value;selector.replaceChildren();defaults.replaceChildren();
        for(const p of state?.packs || []) {
            const o=el('option',p.name);o.value=p.id;selector.append(o);
            const label=el('label',p.name,'spark-inline-toggle'),check=el('input');check.type='checkbox';check.value=p.id;check.checked=state.defaultEnabledPackIds.includes(p.id);label.append(check);defaults.append(label);
        }
        if(state?.packs.some(p=>p.id===id))selector.value=id;showInfo();
        const active=state?enabledPackIds(state,flow.store()):new Set();
        chatInfo.textContent=`当前聊天：${Array.isArray(flow.store().enabledPackIds)?'使用独立组合':'继承全局组合'} · ${state?.packs.filter(p=>active.has(p.id)).map(p=>p.name).join('、') || '全部关闭'}`;
    }};
}
