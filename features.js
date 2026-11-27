import { showRunDiagnostics } from './run-diagnostics.js';
import { installModelSettings } from './model-settings.js';
import { installAnalysisSettings } from './analysis-settings.js';
import { KEY } from './core.js';
import { installPackManager } from './pack-manager.js';
import { installChannelSettings } from './channel-settings.js';
import { historySummary, hasHistorySnapshot } from './history-view.js';
import { action, editDialog } from './editor.js';
import { installLibrary } from './library.js';
import { showInjection as showInjectionPage } from './injection-viewer.js';
import { readingText } from './ui.js';
import { enabledPackIds } from './packs.js';

const el=(tag,text,cls)=>{ const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(cls) node.className=cls; return node; };
export function download(name,bytes,type='application/octet-stream') {
    const url=URL.createObjectURL(new Blob([bytes],{type})); const a=el('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function installFeatures(root,context,settings,world,flow,refresh,notify,openNative) {
    const find=s=>root.querySelector(s);
    const save=()=>context().saveSettingsDebounced();
    const button=(label,fn)=>{ const b=el('button',label,'spark-button'); b.type='button'; b.addEventListener('click',()=>{if(b.disabled)return;b.disabled=true;void Promise.resolve().then(()=>{return fn();}).catch(e=>notify(e.message,true)).finally(()=>{b.disabled=false;});}); return b; };
    const confirm=(title,text)=>context().Popup.show.confirm(title,text);
    const dialog=(title,fields,submit,label='保存')=>editDialog(context,{title,fields,submit:async v=>{await submit(v);},label,notify});
    const modelSettings=installModelSettings(root,context,settings,flow,refresh,notify);
    const analysisSettings=installAnalysisSettings(root,context,settings,world,flow,refresh,notify);
    const library=installLibrary(root,context,settings,world,flow,notify,openNative,refresh);
    const packManager=installPackManager(root,context,settings,world,flow,refresh,notify,download,library);library.finalizeToolbar();
    const libraryPage=find('[data-page=library]'), tabs=el('div',undefined,'spark-compact-actions'), assets=el('div'), modules=el('div');
    tabs.dataset.libraryTabs='';
    assets.dataset.libraryAssets='';modules.dataset.libraryModules='';modules.hidden=true;
    const list=find('[data-library-list]');assets.append(library.tools,list);
    const analysisPanel=find('[data-analysis-manager]');analysisPanel.open=true;modules.append(analysisPanel);
    for(const [text,value] of [['Skill 与火花','assets'],['分析模块','modules']]){const b=button(text,()=>{assets.hidden=value!=='assets';modules.hidden=value!=='modules';for(const tab of tabs.children)tab.setAttribute('aria-selected',String(tab===b));});b.dataset.libraryTab=value;b.setAttribute('aria-selected',String(value==='assets'));tabs.append(b);}
    libraryPage.append(tabs,assets,modules);
    const overview=el('div',undefined,'spark-card'), overviewText=el('p',undefined,'spark-hint');overview.dataset.packOverview='';
    const configure=()=>packManager.openCombination();
    overview.classList.add('spark-content-heading');overview.append(overviewText,button('配置组合',configure));find('[data-page=current]').prepend(overview);
    async function showInjection(actual) {await showInjectionPage(context,structuredClone(actual),{kind:'assembly',notify});}

    const channelSettings=installChannelSettings(root,context,settings,notify);

    const safety=el('details',undefined,'spark-card spark-fold'); safety.append(el('summary','调试与诊断'));
    const safetyBody=el('div',undefined,'spark-fold-body');
    const discoverySelect=el('select'); discoverySelect.setAttribute('aria-label','本轮分析条目'); safetyBody.append(el('p','本轮分析写入条目（仅限插件拥有的条目）','spark-hint'),discoverySelect);
    discoverySelect.addEventListener('change',async()=>{
        try {settings().discoveryId=discoverySelect.value;save();await refresh();}
        catch(error) {discoverySelect.value=settings().discoveryId || '';notify(error.message,true);}
    });
    safetyBody.append(button('修复插件镜像',async()=>{
        const binding=settings().world,chat=flow.chatKey();await flow.syncEcot();
        if(binding!==settings().world || chat!==flow.chatKey())throw new Error('聊天或绑定已变化，请重新修复镜像');
        await world.ensureDiscovery();await refresh();notify('插件镜像已检查并修复');
    }),button('新建分析结果条目',async()=>{
        const name=(await context().Popup.show.input('新建分析结果条目','标题','本轮分析'))?.trim(); if(!name) return;
        const api=await world.api(); let id;
        await world.mutate(data=>{const entry=api.createWorldInfoEntry(settings().world,data);id=crypto.randomUUID();Object.assign(entry,{comment:name,content:'',disable:true,position:4,role:0,depth:0,order:100,probability:100,useProbability:true,[KEY]:{owner:KEY,kind:'discovery',id}});});
        settings().discoveryId=id;save();await refresh();
    }));
    const backup=el('details',undefined,'spark-card spark-fold');backup.append(el('summary','备份与恢复'));
    const backupBody=el('div',undefined,'spark-fold-body');backupBody.append(button('恢复插件条目备份',async()=>{
        const backups=await world.backups(); if(!backups.length) throw new Error('暂无备份');
        await dialog('恢复插件条目备份',{index:{label:'备份时间（只恢复插件条目，普通条目不受影响）',value:'0',options:backups.map((b,i)=>[String(i),b.time])}},async values=>{
            if(!await confirm('恢复备份','将替换当前世界书中的插件条目。')) throw new Error('已取消恢复');
            await world.restoreBackup(Number(values.index));await refresh();
        },'恢复');
    }));
    backup.append(backupBody);find('[data-page=settings]').append(backup);
    const debug=el('pre');safetyBody.append(debug);safety.append(safetyBody);find('[data-page=settings]').append(safety);
    const retention=el('details',undefined,'spark-card spark-fold');retention.append(el('summary','历史保留与清理'));
    const retentionBody=el('div',undefined,'spark-fold-body'),limit=el('input');limit.type='number';limit.min='1';limit.max='500';limit.value=String(flow.historyLimit());limit.setAttribute('aria-label','历史保留条数');
    retentionBody.append(el('p','默认保留最近 50 条规划 / 正文执行记录。新记录加入时按此上限保留；修改上限不会立即删除已有历史。','spark-hint'),limit,
        button('保存历史保留上限',()=>{if(!limit.checkValidity())throw new Error('保留条数应为 1–500');settings().historyLimit=Number(limit.value);save();notify('保留规则已保存，将在新记录加入时执行');}),
        button('清理当前聊天历史',async()=>{if(await confirm('清理当前聊天历史','将删除当前聊天保存的规划与执行快照，当前可编辑方案保留。')){flow.store().history=[];context().saveMetadataDebounced();renderHistory();}}));
    retention.append(retentionBody);find('[data-page=settings]').append(retention);
    function renderHistory() {
        const page=find('[data-page=history]'),scroll=page.scrollTop;
        const signature=JSON.stringify([flow.chatKey(),flow.historyLimit(),flow.store().history]);if(page.sparkSignature===signature)return;page.sparkSignature=signature;
        const expanded=new Map([...page.querySelectorAll('[data-history-id]')].map(card=>[card.dataset.historyId,{open:card.open,debug:card.querySelector('[data-run-details]')?.open}]));
        page.replaceChildren(el('p',`当前聊天 · 保留最近 ${flow.historyLimit()} 条规划 / 正文执行记录`,'spark-hint'));
        const groups=new Map();
        for(const record of flow.store().history) {
            const actual=record.generation,plan=record.applied || record.plan,selection=actual?.selected || plan?.selected || {reasoning:[],spark:[]};
            const info=historySummary(record,context().chat),hasSnapshot=hasHistorySnapshot(record);
            if(!groups.has(info.dayKey)){const group=el('section',undefined,'spark-history-day');group.append(el('h3',info.day));groups.set(info.dayKey,group);page.append(group);}
            const status=({running:'规划中',applied:'已应用',review:'等待审核',requested:'已请求正文',succeeded:'生成成功',failed:'失败',cancelled:'已取消',interrupted:'已中断'})[record.status] || record.status || '未记录';
            const card=el('details',undefined,'spark-fold spark-history-record');card.dataset.historyId=record.id;
            const summary=el('summary'),heading=el('span',undefined,'spark-history-heading');heading.append(el('strong',info.title),el('time',info.time));
            summary.append(heading,el('span',info.summary,'spark-history-summary'),el('small',`Reasoning Skill ${selection.reasoning.length} · 火花 ${selection.spark.length} · ${status}`));card.append(summary);
            const body=el('div',undefined,'spark-fold-body'),actions=el('div',undefined,'spark-text-actions');
            if(hasSnapshot)actions.append(button('查看装配快照',()=>showInjection(actual)));
            if(Array.isArray(selection.reasoning) && Array.isArray(selection.spark) && (plan || actual?.selected))actions.append(button('复用方案',async()=>{
                const options=[['latest','使用最新素材']];if(hasSnapshot)options.push(['snapshot','使用历史快照']);
                await dialog('复用方案',{mode:{label:hasSnapshot?'恢复为当前草稿后，可修改、应用并生成正文':'此记录没有实际正文快照，仅支持最新素材',value:'latest',options}},async values=>{
                    if(flow.run || document.body.dataset.generating)throw new Error('请等待当前运行结束后恢复规划');
                    await flow.reuse(record.id,values.mode);await refresh();find('[data-tab=current]').click();notify('已恢复为当前草稿，可修改、应用并生成正文');
                },'复用为草稿');
            }));
            body.append(el('strong',hasSnapshot?'装配素材':'规划选材'));
            const tags=el('div',undefined,'spark-chips');
            if(hasSnapshot){for(const item of actual.items)if(item.kind!=='discovery')tags.append(el('span',item.title || item.id,'spark-chip'));}
            else for(const [type,ids] of Object.entries(selection))for(const id of ids)tags.append(el('span',`${type==='reasoning'?'Reasoning Skill':'火花'} · ${id}`,'spark-chip'));
            if(!tags.childNodes.length)tags.append(el('small','无素材'));body.append(tags,el('strong','最终创作指导'),readingText(actual?.discovery ?? plan?.discovery ?? record.parsed?.discovery ?? '无创作指导'),actions);
            if(!hasSnapshot)body.append(el('p','此记录未保存实际正文快照，不能还原历史正文。','spark-hint'));
            const debug=el('details');debug.dataset.runDetails='';debug.append(el('summary','运行详情'));
            debug.append(button('本轮运行诊断',()=>showRunDiagnostics(context,record,notify,{editSkill:(id,version)=>library.editSkill({id},false,version)})));
            body.append(debug);card.append(body);groups.get(info.dayKey).append(card);
            const previous=expanded.get(record.id);if(previous){card.open=previous.open;debug.open=previous.debug;}
        }
        if(!groups.size)page.append(el('p','当前聊天暂无规划记录。','spark-hint'));page.scrollTop=scroll;
    }
    return {
        editSkill:(id,versionId)=>library.editSkill({id},false,versionId),
        renderHistory,
        async render(skills,carrierReady=true) {
            if(carrierReady)await analysisSettings.render();library.render(skills);packManager.render(skills);renderHistory();channelSettings.render();await modelSettings.render();
            const active=flow.packState?enabledPackIds(flow.packState,flow.store()):new Set();
            overviewText.textContent=`当前聊天${Array.isArray(flow.store().enabledPackIds)?'独立组合':'继承全局'}：${flow.packState?.packs.filter(p=>active.has(p.id)).map(p=>p.name).join('、') || '未启用创作包'}`;
            discoverySelect.replaceChildren();
            if(settings().world && carrierReady) {
                const {data}=await world.read();
                for(const e of Object.values(data.entries)) if(e[KEY]?.owner===KEY && e[KEY].kind==='discovery'){const o=el('option',e.comment || '分析结果');o.value=e[KEY].id;discoverySelect.append(o);}
                discoverySelect.value=settings().discoveryId || discoverySelect.options[0]?.value || '';
            }
            debug.textContent=JSON.stringify({extension:'0.8.0',world:settings().world,channel:settings().channelId || 'inherit',running:!!flow.run,history:flow.store().history.length,skills:skills.length},null,2);
        },
    };
}
