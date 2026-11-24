import { element as el, action, editDialog } from './editor.js';
import { generationModel, versionsOf } from './model-versions.js';
import { versionEditor } from './version-editor.js';
import { ANALYSIS_FIELDS, resolveAnalysisModules } from './analysis-modules.js';

export function installAnalysisSettings(root,context,settings,world,flow,refresh,notify) {
    const panel=el('details',undefined,'spark-card spark-fold');panel.dataset.analysisManager='';panel.append(el('summary','Planner 分析模块'));
    const body=el('div',undefined,'spark-fold-body'), list=el('div'), migration=el('div',undefined,'spark-analysis-migration');
    const idle=()=>{if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束');};
    const button=(text,fn)=>action(text,async()=>{try{idle();await fn();}catch(e){notify(e.message,true);}});
    let modules=[],rendering=0;
    const bound=()=>({world:settings().world,chat:flow.chatKey()});
    const assertBound=original=>{idle();if(original.world!==settings().world || original.chat!==flow.chatKey())throw new Error('聊天或绑定世界书已变化，请重新打开编辑器');};
    async function edit(existing) {
        if(!settings().world)throw new Error('请先绑定世界书');
        const original=bound(), packs=(await world.packState()).packs;
        const module=existing || {id:crypto.randomUUID(),name:'',description:'',packId:packs[0].id,enabled:true,order:Math.max(-1,...modules.map(m=>m.order))+1,analysis:'',outputFormat:''};
        const initial=versionsOf(module,ANALYSIS_FIELDS)[0];let getVersions;
        await editDialog(context,{title:existing?'编辑分析模块':'新增分析模块',notify,fields:{
            name:{label:'模块名称',value:module.name,required:true},
            packId:{label:'所属创作包',value:module.packId,options:packs.map(p=>[p.id,p.name])},
            description:{label:'简短描述（可选）',value:module.description},
            analysis:{label:'分析资料',type:'textarea',value:initial.analysis},
            outputFormat:{label:'输出格式',type:'textarea',value:initial.outputFormat},
        },setup:parts=>{
            getVersions=versionEditor(parts,module,settings().modelTags || [],ANALYSIS_FIELDS);
            const hint=el('p','','spark-hint');parts.rows.packId.append(hint);
            const update=()=>{hint.textContent=flow.packReason(parts.controls.packId.value)?'该创作包在当前聊天未启用，模块保存后暂不参与 Planner。':'';};
            parts.controls.packId.addEventListener('change',update);update();
        },submit:async values=>{
            assertBound(original);
            await world.upsertAnalysisModule({...module,...values,versions:getVersions()},existing?JSON.stringify(existing):undefined);
            await refresh();notify(flow.packReason(values.packId)?'分析模块已保存；所属创作包未启用，当前不参与 Planner':'分析模块已保存');
        }});
    }
    const add=button('新增分析模块',()=>edit());
    body.append(add,migration,el('p','手动启用与排序；顺序用于本聊天的分析资料和输出格式。模块只有在所属创作包已启用且当前模型有适用版本时参与 Planner。','spark-hint'),list);
    panel.append(body);root.querySelector('[data-page=settings]').append(panel);
    async function reviewMigration() {
        const original=bound();
        await editDialog(context,{title:'确认旧输出协议迁移',notify,fields:{
            protocol:{label:'全局输出总协议（保留全局规则；模块格式请移至对应模块的输出格式中）',type:'textarea',value:settings().prompts.protocol},
        },setup:({body})=>body.prepend(el('p','旧自定义协议已原样保留并备份，程序未猜测拆分。请先在分析模块中保存属于各模块的格式，再在这里删除相应的重复内容。保存即确认迁移。','spark-hint')),submit:async values=>{
            assertBound(original);settings().prompts.protocol=values.protocol;settings().analysisMigrationPending=false;context().saveSettingsDebounced();await refresh();notify('旧协议迁移已确认；原始自定义文字保留在迁移备份中');
        }});
    }
    return {async render(){
        const version=++rendering, original=bound();
        const next=settings().world?await flow.analysisModules():[];
        const model=await generationModel(context);
        if(version!==rendering || original.world!==settings().world || original.chat!==flow.chatKey())return;
        modules=next;add.disabled=!settings().world;list.replaceChildren();migration.replaceChildren();
        if(settings().analysisMigrationPending)migration.append(el('p','旧自定义输出协议正在兼容保留，可能含有心理发现格式。请检查并确认拆分，避免关闭模块后旧格式仍然要求输出。','spark-hint'),button('检查旧协议迁移',reviewMigration));
        const {snapshots}=resolveAnalysisModules(modules,model.modelId,settings().modelTags || [],flow.packState,flow.store());
        for(const [i,module] of modules.entries()) {
            const state=snapshots.find(s=>s.id===module.id), row=el('div',undefined,'spark-module-row');row.dataset.analysisModule=module.id;
            const main=el('div',undefined,'spark-module-main'), label=el('label',module.name), check=el('input');check.type='checkbox';check.checked=module.enabled!==false;
            check.setAttribute('aria-label',`启用分析模块：${module.name}`);
            check.addEventListener('change',async()=>{
                check.disabled=true;
                try{assertBound(original);await world.upsertAnalysisModule({...module,enabled:check.checked},JSON.stringify(module));await refresh();notify('分析模块启用设置已保存');}
                catch(error){check.checked=module.enabled!==false;notify(error.message,true);}finally{check.disabled=false;}
            });
            label.prepend(check);main.append(label,el('small',`${state.packName} · ${state.label?'适用：'+state.label:state.modelReason}${state.reason && state.reason!==state.modelReason?' · '+state.reason:''}${state.warning?' · '+state.warning:''}`,'spark-module-state'));
            if(module.description)main.title=module.description;
            const actions=el('div',undefined,'spark-module-actions');actions.append(button('编辑',()=>edit(module)));
            for(const [text,delta] of [['上移',-1],['下移',1]]) {
                const move=button(text,async()=>{assertBound(original);const ids=modules.map(m=>m.id),j=i+delta;[ids[i],ids[j]]=[ids[j],ids[i]];flow.store().analysisModuleOrder=ids;context().saveMetadataDebounced();await refresh();notify('本聊天的分析模块顺序已保存');});
                move.disabled=i+delta<0 || i+delta>=modules.length;move.setAttribute('aria-label',`${text}分析模块：${module.name}`);actions.append(move);
            }
            actions.append(button('删除',async()=>{
                if(!await context().Popup.show.confirm('删除分析模块',el('p',`删除「${module.name}」？历史规划和请求快照保留。`).outerHTML))return;
                assertBound(original);await world.removeAnalysisModule(module.id);await refresh();notify('分析模块已删除');
            }));row.append(main,actions);list.append(row);
        }
        if(!modules.length)list.append(el('p',settings().world?'暂无分析模块；仍可正常选择 Reasoning Skill 与火花。':'请先绑定世界书。','spark-hint'));
    }};
}
