import { moreMenu } from './ui.js';
import { element as el, action, editDialog, readDialog } from './editor.js';
import { enabledPackIds, preparePackImport } from './packs.js';
import { exportPack, importPack, fromMarkdown } from './skill-pack.js';
import { mergeImportedTags, generationModel, resolveSkills } from './model-versions.js';
import { KEY } from './core.js';

export function installPackManager(root,context,settings,world,flow,refresh,notify,download,library) {
    const panel=el('details',undefined,'spark-card spark-fold');panel.append(el('summary','创作包管理'));
    panel.dataset.packManager='';
    const body=el('div',undefined,'spark-fold-body'), info=el('p',undefined,'spark-hint');
    const defaults=el('div',undefined,'spark-pack-defaults'), chatInfo=el('p',undefined,'spark-hint');
    defaults.dataset.globalPacks='';
    let state,skills=[],defaultsSignature,chatSignature,defaultsDirty=false,bindingWorld;
    const selected=()=>library.currentPack();
    const button=(text,fn)=>action(text,async()=>{try{await fn();}catch(e){notify(e.message,true);}});
    const requirePack=()=>{const p=selected();if(!p)throw new Error('请先绑定世界书并选择创作包');return p;};
    async function initialize() {
        try {if(settings().world){await world.read();return true;}} catch { /* Offer explicit repair, never move existing data. */ }
        const names=context().getWorldInfoNames();let ready=false;
        await editDialog(context,{title:'一次性初始化世界书注入载体',notify,fields:{
            mode:{label:'初始化方式',value:'create',options:[['create','创建插件专用世界书'],['existing','选择已有世界书']]},
            name:{label:'专用世界书名称',value:'火花规划器素材',required:true,when:v=>v.mode==='create'},
            existing:{label:'已有世界书',options:names.map(n=>[n,n]),when:v=>v.mode==='existing'},
        },setup:({body})=>body.prepend(el('p','所有创作包共用此世界书。更换绑定只切换资产来源，不搬移或删除原世界书内容。','spark-hint')),submit:async v=>{
            if(v.mode==='create')await world.create(v.name.trim());
            else {
                const data=await context().loadWorldInfo(v.existing);if(!data?.entries)throw new Error('世界书不存在或无法读取');
                flow.cancel({stop:false});settings().world=v.existing;settings().discoveryId='';context().saveSettingsDebounced();await world.ensureDiscovery();
            }
            ready=true;await refresh();
        }});return ready;
    }
    async function edit(existing) {
        if(!existing && !await initialize())return;
        const pack=existing || {id:crypto.randomUUID(),name:'新创作包',description:'',categories:['未分类']};
        const bound=settings().world;
        await editDialog(context,{title:existing?'编辑创作包':'新建创作包',notify,fields:{name:{label:'包名称',required:true,value:pack.name},...(existing?{description:{label:'描述',type:'textarea',rows:3,value:pack.description}}:{})},submit:async v=>{
            if(bound!==settings().world)throw new Error('绑定世界书已变化，请重新创建');
            await world.savePack({...pack,...v});await refresh();library.browse(pack.id);showInfo();notify(existing?'创作包已保存':'创作包已创建；可直接勾选“当前聊天启用此创作包”');
        }});
    }
    function showInfo(){const p=selected();info.textContent=p?`${p.name} · ${skills.filter(s=>s.packId===p.id).length} 项条目 · ${(state.analysisModules || []).filter(m=>m.packId===p.id).length} 个分析模块${p.description?' · '+p.description:''}`:'请先绑定世界书';}
    root.addEventListener('spark-pack-browse',showInfo);
    const actions=el('div',undefined,'spark-compact-actions');
    actions.append(button('新建空创作包',()=>edit()),button('重命名 / 描述',()=>edit(requirePack())),button('复制可选火花目录',async()=>{
        const model=await generationModel(context);
        const text=resolveSkills(await flow.candidateSkills(),model.modelId,settings().modelTags || []).filter(s=>s.type==='spark').map(s=>`${s.title} — 启用条件：${s.recommendation || '按情境判断'}`).join('\n');
        try{await navigator.clipboard.writeText(text);notify('可选火花目录已复制');}catch{await editDialog(context,{title:'火花目录（可手动复制）',readOnly:true,tokenTarget:'planner',fields:{text:{label:'火花目录',type:'textarea',value:text}}});}
    }),button('导出所选包 ZIP',async()=>{
        const p=requirePack(), modules=(await world.analysisModules()).filter(m=>m.packId===p.id);
        download(`${p.name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_')}.zip`,exportPack(skills.filter(s=>s.packId===p.id),p.categories,settings().modelTags || [],p,modules),'application/zip');
    }),button('复制创作包',async()=>{
        const p=requirePack(), copy={...p,id:crypto.randomUUID(),name:p.name+'（副本）'};
        const modules=(await world.analysisModules()).filter(m=>m.packId===p.id).map(m=>({...m,id:crypto.randomUUID(),packId:copy.id}));
        await world.importSkills(skills.filter(s=>s.packId===p.id).map(s=>({...s,id:crypto.randomUUID(),packId:copy.id})),undefined,false,copy,modules);
        await refresh();library.browse(copy.id);showInfo();notify('创作包已复制，尚未启用；副本条目使用新 ID');
    }),button('删除创作包',async()=>{
        const p=requirePack(), count=skills.filter(s=>s.packId===p.id).length;
        if(state.packs.length<=1)throw new Error('至少保留一个创作包作为新条目的默认归属');
        const text=`删除「${p.name}」及其中 ${count} 项条目、${(state.analysisModules || []).filter(m=>m.packId===p.id).length} 个分析模块、对应的插件管理世界书条目与 ECoT 关联。历史规划和已完成请求快照保留，但已删除条目无法再次应用。普通世界书条目不受影响。`;
        if(!await context().Popup.show.confirm('确认删除创作包',el('p',text).outerHTML))return;
        await world.removePack(p.id);await refresh();notify('创作包已删除，历史保留');
    }));
    const upload=el('input');upload.type='file';upload.accept='.zip,.md';upload.setAttribute('aria-label','导入创作包 ZIP 或 Markdown');
    upload.addEventListener('change',()=>void (async()=>{
        const file=upload.files[0];if(!file)return;if(!await initialize())return;if(file.size>10*1024*1024)throw new Error('导入文件超过 10MB');
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
        if(settings().world!==worldName || flow.chatKey()!==chat || JSON.stringify(settings().modelTags || [])!==tagFingerprint)throw new Error('聊天、绑定世界书或模型标签已变化，请重新导入预览');
        await world.importSkills(importedSkills,JSON.stringify(latest.data),false,prepared.pack,importedModules);
        settings().modelTags=merged.tags;context().saveSettingsDebounced();await refresh();library.browse(prepared.pack.id);showInfo();notify('创作包已导入；请在创作库确认启用后参与 Planner');
    })().catch(e=>notify(e.message,true)).finally(()=>{upload.value='';}));
    const chatMode=el('select');chatMode.setAttribute('aria-label','当前聊天创作包组合');
    for(const [value,text] of [['inherit','继承全局默认组合'],['independent','当前聊天独立组合']]){const o=el('option',text);o.value=value;chatMode.append(o);}
    chatMode.addEventListener('change',async()=>{flow.setEnabledPacks(chatMode.value==='inherit'?null:[...enabledPackIds(state,flow.store())]);await refresh();});
    const chatPacks=el('div',undefined,'spark-pack-defaults');
    const combo=el('div');combo.append(chatMode,chatPacks,chatInfo);
    const manage=moreMenu('包操作');actions.firstElementChild.remove();manage.content.append(...actions.children);
    body.append(info,manage.menu,el('p','导入 ZIP / Markdown，预览确认后作为新包加入。','spark-hint'),upload,el('h4','全局默认启用组合'),defaults,
        button('保存全局默认组合',async()=>{await world.defaultPacks([...defaults.querySelectorAll('input:checked')].map(n=>n.value));defaultsDirty=false;await refresh();notify('全局默认组合已保存');}));
    panel.hidden=true;panel.append(combo);
    const openCombination=()=>readDialog(context,{title:'当前聊天创作包组合',size:'auto',notify,render:area=>area.append(combo)}).finally(()=>panel.append(combo));
    const openManagement=()=>readDialog(context,{title:'创作包管理',size:'auto',notify,render:area=>area.append(body)}).finally(()=>panel.append(body));
    library.actions.append(button('创作包管理',openManagement));
    panel.append(body);root.querySelector('[data-page=library]').insertBefore(panel,root.querySelector('[data-library-list]'));
    library.actions.prepend(button('新建创作包',()=>edit()));
    return {initialize,openCombination,render(next){skills=next;state=flow.packState;
        if(bindingWorld!==settings().world){bindingWorld=settings().world;defaultsDirty=false;defaultsSignature=null;chatSignature=null;}
        const nextDefaults=JSON.stringify([state?.packs.map(p=>[p.id,p.name]),state?.defaultEnabledPackIds]);
        const nextChat=JSON.stringify([nextDefaults,flow.store().enabledPackIds]);
        const pending=new Map([...defaults.querySelectorAll('input')].map(c=>[c.value,c.checked]));
        const updateDefaults=defaultsSignature!==nextDefaults,updateChat=chatSignature!==nextChat;
        if(updateDefaults)defaults.replaceChildren();if(updateChat)chatPacks.replaceChildren();chatMode.disabled=!state;
        chatMode.value=Array.isArray(flow.store().enabledPackIds)?'independent':'inherit';
        for(const p of state?.packs || []) {
            if(updateDefaults){const label=el('label',p.name,'spark-inline-toggle'),check=el('input');check.type='checkbox';check.value=p.id;check.checked=defaultsDirty && pending.has(p.id)?pending.get(p.id):state.defaultEnabledPackIds.includes(p.id);check.addEventListener('change',()=>{defaultsDirty=true;});label.append(check);defaults.append(label);}
            if(updateChat){const chatLabel=el('label',p.name,'spark-inline-toggle'),chatCheck=el('input');chatCheck.type='checkbox';chatCheck.checked=enabledPackIds(state,flow.store()).has(p.id);chatCheck.disabled=chatMode.value==='inherit';
            chatCheck.addEventListener('change',async()=>{const ids=enabledPackIds(state,flow.store());if(chatCheck.checked)ids.add(p.id);else ids.delete(p.id);flow.setEnabledPacks([...ids]);await refresh();});chatLabel.append(chatCheck);chatPacks.append(chatLabel); }
        }
        defaultsSignature=nextDefaults;chatSignature=nextChat;showInfo();
        const active=state?enabledPackIds(state,flow.store()):new Set();
        chatInfo.textContent=`当前聊天：${Array.isArray(flow.store().enabledPackIds)?'使用独立组合':'继承全局组合'} · ${state?.packs.filter(p=>active.has(p.id)).map(p=>p.name).join('、') || '全部关闭'}`;
    }};
}
