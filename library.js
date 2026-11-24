import { versionEditor } from './version-editor.js';
import { versionsOf } from './model-versions.js';
import { enabledPackIds } from './packs.js';
import { ecotFields, ecotEditor } from './ecot.js';
import { element as el, action, editDialog, insertionFields, insertionValues } from './editor.js';

export function installLibrary(root,context,settings,world,flow,notify,openNative,refresh) {
    const list=root.querySelector('[data-library-list]'), page=list.closest('[data-page]');
    let skills=[], allSkills=[], selectedPack='', boundWorld='', filtering=false, rendering=false;
    const state=()=>flow.packState;
    const currentPack=()=>state()?.packs.find(p=>p.id===selectedPack);
    const groups=new Map(), cards=new Map(), expanded=new Set();
    const idle=()=>{if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束后管理素材');};
    const button=(label,fn)=>action(label,async()=>{try{idle();await fn();}catch(e){notify(e.message,true);}});
    const categories=(id=selectedPack)=>[...new Set(['未分类',...(state()?.packs.find(p=>p.id===id)?.categories || []),...allSkills.filter(s=>s.packId===id).map(s=>s.category)])];
    const tools=el('div',undefined,'spark-card');
    const selector=el('select');selector.setAttribute('aria-label','浏览创作包');selector.dataset.packBrowse='';
    const info=el('p',undefined,'spark-hint'), toggle=el('input');toggle.type='checkbox';toggle.setAttribute('aria-label','当前聊天启用此创作包');
    const toggleLabel=el('label','当前聊天启用此创作包','spark-inline-toggle');toggleLabel.append(toggle);
    selector.addEventListener('change',()=>{selectedPack=selector.value;category.value='';expanded.clear();render(allSkills);});
    toggle.addEventListener('change',async()=>{try{idle();const ids=enabledPackIds(state(),flow.store());if(toggle.checked)ids.add(selectedPack);else ids.delete(selectedPack);flow.setEnabledPacks([...ids]);await refresh();notify(toggle.checked?'创作包已在当前聊天启用':'创作包已在当前聊天停用，包内条目设置保留');}catch(e){notify(e.message,true);render(allSkills);}});
    const search=el('input');search.placeholder='搜索标题、分类、推荐开启或正文';search.setAttribute('aria-label','搜索条目');
    const category=el('select');category.setAttribute('aria-label','按分类筛选');
    const actions=el('div',undefined,'spark-compact-actions');
    actions.append(button('新增条目',()=>editSkill()),button('分类管理',manageCategories),button('刷新素材',async()=>{await world.reload();await reload();notify('素材已刷新');}));
    tools.append(selector,info,toggleLabel,actions,search,category);list.before(tools);
    async function reload(){await flow.loadPackState();await refresh();}
    async function manageCategories() {
        if(!currentPack())throw new Error('请先在设置中绑定世界书');
        const names=categories().map(n=>[n,n]);
        await editDialog(context,{title:'分类管理',notify,fields:{
            operation:{label:'操作',value:'new',options:[['new','新建分类'],['rename','重命名分类'],['merge','合并分类'],['delete','删除分类（移动条目）']]},
            source:{label:'来源分类',value:category.value || '未分类',options:names,when:v=>v.operation!=='new'},
            target:{label:'目标分类',value:'未分类',options:names,when:v=>v.operation==='merge'},
            name:{label:'分类名称',value:'',required:true,when:v=>['new','rename'].includes(v.operation)},
        },submit:async v=>{
            idle();
            const count=skills.filter(s=>s.category===v.source).length;
            if(v.operation==='new') {
                const name=v.name.trim();if(!name)throw new Error('分类名称不能为空');if(categories().includes(name))throw new Error('分类已存在');
                await world.savePack({...currentPack(),categories:[...categories(),name]});await reload();category.value=name;applyFilter();notify('分类已创建');return;
            }
            if(v.source==='未分类' && v.operation!=='merge')throw new Error('未分类为默认分类，请选择自建分类');
            const target=v.operation==='merge'?v.target:v.operation==='delete'?'未分类':v.name.trim();
            if(!target)throw new Error('分类名称不能为空');
            if(target===v.source)throw new Error('来源和目标分类不能相同');
            if(v.operation==='rename' && categories().includes(target))throw new Error('目标已存在，请使用合并分类');
            if(v.operation==='merge' || v.operation==='delete') {
                const message=`来源：${v.source}\n目标：${target}\n将移动 ${count} 个条目，随后删除来源分类。条目正文和配置全部保留。`;
                if(!await context().Popup.show.confirm(v.operation==='merge'?'确认合并分类':'确认移动并删除分类',el('p',message).outerHTML))throw new Error('已取消，分类未修改');
            }
            await world.category(v.source,target,selectedPack);
            await reload();if(category.value===v.source)category.value=target;applyFilter();notify(v.operation==='merge'?'分类已合并':v.operation==='delete'?'条目已移动，分类已删除':'分类已重命名');
        }});
    }
    async function editSkill(existing,readOnly=false) {
        if(!currentPack())throw new Error('请先在设置中绑定世界书');
        // Always resolve the latest native attributes, including changes in the native editor.
        if(existing)await world.reload();
        const skill=existing?(await world.skills()).find(s=>s.id===existing.id):{id:crypto.randomUUID(),packId:selectedPack,type:'spark',title:'',category:category.value || '未分类',body:'',recommendation:'',enabled:true};
        if(!skill)throw new Error('条目已删除，请刷新素材');
        let editNext=false, getVersions;
        const initial=versionsOf(skill)[0];
        await editDialog(context,{title:readOnly?'条目详情（只读）':existing?'编辑条目':'新增条目',readOnly,label:readOnly?'编辑':'保存',notify,fields:{
            title:{label:'标题',required:true,value:skill.title},
            packId:{label:'所属创作包',value:skill.packId,options:state().packs.map(p=>[p.id,p.name])},
            type:{label:'类型',value:skill.type,options:[['reasoning','Reasoning Skill'],['spark','火花']]},
            category:{label:'所属分类',value:skill.category,options:categories(skill.packId).map(n=>[n,n])},
            recommendation:{label:'推荐开启',type:'textarea',rows:4,value:initial.recommendation},
            body:{label:'正文',type:'textarea',rows:7,required:true,value:initial.body},
            ...ecotFields(initial),
            enabled:{label:'允许 Planner 选择',type:'checkbox',value:skill.enabled},
            ...insertionFields(skill.native),
        },setup:({controls,rows,body,popup,visibility})=>{
            getVersions=versionEditor({controls,rows,body,visibility},skill,settings().modelTags || [],undefined,readOnly);
            ecotEditor({controls,rows,visibility});
            controls.packId.addEventListener('change',()=>{
                controls.category.replaceChildren();for(const name of categories(controls.packId.value)){const option=el('option',name);option.value=name;controls.category.append(option);}controls.category.value='未分类';
            });
            if(!readOnly)rows.category.append(button('新建目标分类',()=>editDialog(context,{title:'新建目标分类',fields:{name:{label:'分类名称',required:true,value:''}},notify,submit:v=>{
                const name=v.name.trim();if(!name)throw new Error('分类名称不能为空');
                if(![...controls.category.options].some(o=>o.value===name)){const option=el('option',name);option.value=name;controls.category.append(option);}controls.category.value=name;
            }})));
            const common=el('div',undefined,'spark-field-grid');rows.type.before(common);common.append(rows.type,rows.category);rows.enabled.classList.add('spark-inline-toggle');
            const insert=el('details',undefined,'spark-insertion-fold');insert.append(el('summary','插入设置'));
            rows.enabled.after(insert);for(const key of Object.keys(insertionFields()))insert.append(rows[key]);
            if(existing)body.append(button('在世界书中编辑',async()=>{await popup.completeCancelled();if(!popup.dlg.isConnected)await openNative(skill.id);}));
            if(existing && !readOnly)body.append(button('删除条目',async()=>{
                if(!await context().Popup.show.confirm('删除条目',el('p',`确认删除「${skill.title}」？可从插件备份恢复。`).outerHTML))return;
                await world.remove(skill.id);await reload();notify('条目已删除');
                // Successful deletion has no draft to save.
                popup.onClosing=()=>true;await popup.completeCancelled();
            }));
        },submit:async v=>{
            if(readOnly){editNext=true;return;}
            idle();await world.upsert({...skill,...v,versions:getVersions(),native:{...skill.native,...insertionValues(v),useProbability:skill.native?.useProbability ?? true}});
            await reload();
            if(category.value && category.value!==v.category){category.value=v.category;applyFilter();}
            const destination=groups.get(v.category);expanded.add(v.category);if(destination)destination.open=true;
            const moved=existing && skill.packId!==v.packId;
            notify((moved?'条目已移动并保存':existing?'条目已保存':'条目已创建')+(flow.packReason(v.packId)?'；'+flow.packReason(v.packId)+'，当前 Planner 与生成将跳过此条目':''));
        }});
        if(editNext)await editSkill(skill);
    }
    function applyFilter() {
        const query=search.value.trim().toLocaleLowerCase(), active=!!(query || category.value);filtering=active;
        for(const [name,group] of groups) {
            let visible=0;
            for(const skill of skills.filter(s=>s.category===name)) {
                const card=cards.get(skill.id);
                card.hidden=!!((category.value && category.value!==name) || (query && ![skill.title,skill.category,...versionsOf(skill).flatMap(v=>[v.recommendation,v.body])].join('\n').toLocaleLowerCase().includes(query)));
                if(!card.hidden)visible++;
            }
            group.hidden=active ? !visible : false;group.open=active?!!visible:expanded.has(name);
        }
    }
    search.addEventListener('input',applyFilter);category.addEventListener('change',applyFilter);
    function render(next) {
        const scroll=page.scrollTop;allSkills=next;rendering=true;
        if(boundWorld!==settings().world){selectedPack='';boundWorld=settings().world;}
        if(!state()?.packs.some(p=>p.id===selectedPack))selectedPack=state()?.packs[0]?.id || '';
        const active=state()?enabledPackIds(state(),flow.store()):new Set();
        selector.replaceChildren();for(const pack of state()?.packs || []){const option=el('option',`${pack.name} · ${next.filter(s=>s.packId===pack.id).length} 项 · ${active.has(pack.id)?'启用':'未启用'}`);option.value=pack.id;selector.append(option);}selector.value=selectedPack;
        info.textContent=currentPack()?.description || (currentPack()?'此包共用绑定世界书；切换浏览不会改变启用状态。':'请先绑定世界书');toggle.checked=active.has(selectedPack);toggle.disabled=!currentPack();
        skills=next.filter(s=>s.packId===selectedPack);
        const chosen=category.value,names=categories();category.replaceChildren();const all=el('option','全部分类');all.value='';category.append(all);
        for(const name of names){const o=el('option',name);o.value=name;category.append(o);}category.value=names.includes(chosen)?chosen:'';
        for(const [name,group] of groups)if(!names.includes(name)){group.remove();groups.delete(name);expanded.delete(name);}
        for(const [id,card] of cards)if(!skills.some(s=>s.id===id)){card.remove();cards.delete(id);}
        for(const name of names) {
            let group=groups.get(name);
            if(!group){group=el('details',undefined,'spark-fold spark-category');group.dataset.categoryGroup=name;group.append(el('summary'),el('div',undefined,'spark-category-items'));groups.set(name,group);list.append(group);
                // toggle events are asynchronous; only user interaction updates the saved expansion state.
                group.firstChild.addEventListener('click',()=>{if(!filtering && !rendering){if(group.open)expanded.delete(name);else expanded.add(name);}});
            }
            const items=skills.filter(s=>s.category===name).sort((a,b)=>(a.type==='reasoning'?0:1)-(b.type==='reasoning'?0:1));group.firstChild.textContent=`${name} · ${items.length} 项 · 可选 ${items.filter(s=>s.enabled!==false).length}`;
            for(const skill of items) {
                let card=cards.get(skill.id);
                if(!card){card=el('div',undefined,'spark-library-row');card.dataset.skillCard=skill.id;cards.set(skill.id,card);}
                const signature=JSON.stringify(skill);
                if(card.dataset.signature!==signature) {
                    card.dataset.signature=signature;card.dataset.category=name;card.replaceChildren();
                    const main=el('div',undefined,'spark-library-main');
                    const title=button(skill.title,()=>editSkill(skill));title.classList.add('spark-title-button');title.dataset.skillTitle=skill.title;
                    title.dataset.skillType=skill.type;title.title=skill.type==='reasoning'?'Reasoning Skill':'火花';main.append(title);
                    const toggle=el('label',undefined,'spark-library-toggle');const check=el('input');check.type='checkbox';check.checked=skill.enabled;check.setAttribute('aria-label',`允许 Planner 选择：${skill.title}`);
                    check.addEventListener('change',async()=>{check.disabled=true;try{idle();const latest=(await world.skills()).find(s=>s.id===skill.id);if(!latest)throw new Error('条目已删除');await world.upsert({...latest,enabled:check.checked});await reload();notify('Planner 选用设置已保存');}catch(e){check.checked=skill.enabled;notify(e.message,true);}finally{check.disabled=false;}});
                    toggle.title='可选：允许 Planner 在候选目录中选择';toggle.append(check,el('span','可选'));const edit=button('编辑',()=>editSkill(skill));edit.setAttribute('aria-label',`编辑条目：${skill.title}`);card.append(toggle,main,edit);
                }
                group.lastChild.append(card);
            }
        }
        root.querySelector('[data-library-summary]').textContent=settings().world?`${currentPack()?.name || ''} · ${skills.length} 项条目`:'请先在设置中绑定世界书。';
        applyFilter();rendering=false;page.scrollTop=scroll;
    }
    return {render};
}
