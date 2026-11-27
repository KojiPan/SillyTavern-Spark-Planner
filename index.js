import { generationModel, resolveVersion, matchTags } from './model-versions.js';
import { KEY, DEFAULT_PROMPTS, migrateDefaults, migrateAnalysisPrompts } from './core.js';
import { Workflow } from './workflow.js';
import { Worldbook } from './worldbook.js';
import { RegenerateRecovery } from './recovery.js';
import { createPanelHost } from './panel-host.js';
import { getViewState } from './view-state.js';
import { installFeatures } from './features.js';
import { DEFAULT_PLANNER_PRESET } from './planner-context.js';
import { installDiscoverySettings } from './discovery-settings.js';
import { editDialog } from './editor.js';
import { hasEcot } from './ecot.js';
import { installTextTools } from './text-tools.js';
import { moreMenu, installMenuDismissal } from './ui.js';
import { installCurrentWorkspace } from './current-workspace.js';
import { installRequestObserver } from './request-observer.js';
import { showRunDiagnostics } from './run-diagnostics.js';
import { selectedEntryActions } from './selected-entry.js';
import { installSettingsDirectory } from './settings-directory.js';

const context = () => SillyTavern.getContext();
const settings = () => context().extensionSettings[KEY];
const c = context();
c.extensionSettings[KEY] ??= {};
const config = settings();
const defaultsChanged=migrateDefaults(config);
for (const [key, value] of Object.entries({ enabled: false, autoContinue: true, world: '', reasoningLimit: 5, timeout: 120, maxTokens: 32768, contextMode: 'native', plannerPreset: DEFAULT_PLANNER_PRESET })) {
    config[key] ??= value;
}
config.prompts = { ...DEFAULT_PROMPTS, ...config.prompts };
const analysisPromptsChanged=migrateAnalysisPrompts(config);
if(defaultsChanged || analysisPromptsChanged) c.saveSettingsDebounced();
if(!config.runMode){config.runMode=config.autoContinue===false?'review':'auto';c.saveSettingsDebounced();}

const panel = document.createElement('div');
panel.id = 'spark-planner';
panel.className = 'spark-planner';
// This is constant markup. All model/user text below uses textContent/value.
panel.innerHTML = `<div class="spark-shell"><header class="spark-head"><div><div class="spark-title-line"><strong>火花规划器</strong><button type="button" class="spark-button spark-small spark-model-badge" data-model-badge aria-label="查看当前 Generation 模型匹配详情">通用</button></div></div><button type="button" class="spark-button spark-close" data-close autofocus aria-label="关闭火花规划器">关闭</button></header>
<div class="spark-notice" role="status" aria-live="polite" data-notice hidden></div><div class="spark-tabs" role="tablist" aria-label="火花规划器页面">
<button type="button" class="spark-button" id="spark-tab-current" role="tab" aria-selected="true" aria-controls="spark-page-current" data-tab="current">当前</button>
<button type="button" class="spark-button" id="spark-tab-history" role="tab" aria-selected="false" aria-controls="spark-page-history" tabindex="-1" data-tab="history">历史</button>
<button type="button" class="spark-button" id="spark-tab-library" role="tab" aria-selected="false" aria-controls="spark-page-library" tabindex="-1" data-tab="library">创作库</button>
<button type="button" class="spark-button" id="spark-tab-settings" role="tab" aria-selected="false" aria-controls="spark-page-settings" tabindex="-1" data-tab="settings">设置</button></div>
<section id="spark-page-current" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-current" data-page="current">
<div class="spark-card spark-run-bar"><label class="spark-toggle spark-master"><span><strong>启用规划器</strong></span><input type="checkbox" data-setting="enabled"></label><label>运行模式<select data-setting="runMode"><option value="auto">自动规划</option><option value="review">审核后生成</option><option value="manual">手动编排</option></select></label><div class="spark-status" role="status" aria-live="polite"><strong data-phase>未启用</strong><p data-status>关闭面板后仍可正常聊天。</p></div></div>
<div class="spark-card spark-current-content"><div data-turn-selection><div class="spark-section-title">本轮选材</div><div class="spark-chips" data-selected></div><details class="spark-fold spark-choice-fold"><summary>调整选材</summary><div class="spark-fold-body"><input type="search" data-choice-search aria-label="搜索本轮条目" placeholder="搜索标题、分类或创作包"><div data-choices></div></div></details></div><section data-guidance-workspace></section><p class="spark-hint" data-plan-summary>本轮尚无已应用规划。</p>
<p class="spark-hint" data-unavailable-summary hidden></p>
<div class="spark-actions spark-main-actions"><button type="button" class="spark-button spark-primary" data-action="apply" hidden>应用本轮方案</button><button type="button" class="spark-button spark-primary" data-action="resume" hidden>继续生成正文</button><button type="button" class="spark-button" data-action="cancel" hidden>停止本次运行</button><button type="button" class="spark-button" data-action="clear" hidden>清空本轮方案</button></div>
<div class="spark-text-actions" data-more><button type="button" class="spark-button spark-small spark-text-button" data-action="only">仅规划</button><button type="button" class="spark-button spark-small spark-text-button" data-action="replan">重新规划</button><button type="button" class="spark-button spark-small spark-text-button" data-action="restore">恢复原选择</button><button type="button" class="spark-button spark-small spark-text-button" data-action="raw">查看原始输出</button></div>
<details class="spark-fold spark-debug" data-current-debug hidden><summary>Planner 原始输出</summary><div class="spark-fold-body"><pre data-raw></pre><button type="button" class="spark-button spark-text-button" data-action="copy-raw">复制原始输出</button></div></details></div></section>
<section id="spark-page-history" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-history" data-page="history" hidden><div class="spark-card"><div class="spark-section-title">历史</div><p class="spark-hint">正在读取当前聊天最近 50 次规划。</p></div></section>
<section id="spark-page-library" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-library" data-page="library" hidden>
<div class="spark-card"><div class="spark-section-title">创作库</div><p class="spark-hint" data-library-summary>请先在设置中绑定世界书。</p></div><div data-library-list></div></section>
<section id="spark-page-settings" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-settings" data-page="settings" hidden>
<details class="spark-card spark-fold"><summary>世界书绑定</summary><div class="spark-fold-body"><label>绑定世界书<select data-world></select></label><div class="spark-actions"><button type="button" class="spark-button" data-action="refresh">刷新列表</button><button type="button" class="spark-button" data-action="open">打开世界书编辑器</button></div><label>新建专用世界书名称<input data-book-name value="火花规划器素材"></label><button type="button" class="spark-button spark-primary" data-action="create">创建并绑定</button><p class="spark-hint">仅管理本插件条目。镜像保持原生禁用，仅在本次生成扫描中启用。</p></div></details>
<details class="spark-card spark-fold"><summary>Planner 参数</summary><div class="spark-fold-body"><label>Planner 上下文模式<select data-setting="contextMode"><option value="native">模式一：沿用酒馆预设（默认）</option><option value="standalone">模式二：独立默认预设</option></select></label><div data-planner-preset-row hidden class="spark-setting-row"><div><strong>独立 Planner 基础预设</strong><p class="spark-text-preview" data-preset-preview></p></div><button type="button" class="spark-button spark-small" data-edit-preset>编辑</button></div><label>Reasoning Skill 上限<input type="number" min="0" max="50" data-setting="reasoningLimit"></label><label>最大输出 Token<input type="number" min="64" max="52000" data-setting="maxTokens"></label><label>超时（秒）<input type="number" min="5" max="600" data-setting="timeout"></label></div></details>
<details class="spark-card spark-fold"><summary>本轮分析</summary><div class="spark-fold-body"><div class="spark-setting-row"><span>本轮分析插入位置 <small data-discovery-insertion-summary></small></span><button type="button" class="spark-button spark-small" data-discovery-edit>编辑</button></div></div></details>
<details class="spark-card spark-fold"><summary>任务提示词</summary><div class="spark-fold-body"><div data-prompts></div><button type="button" class="spark-button" data-action="defaults">恢复默认文案</button></div></details></section></div>`;
let selectionContainer;
const find = selector => panel.querySelector(selector) || selectionContainer?.querySelector(selector);
const runFooter=document.createElement('footer');runFooter.className='spark-run-footer';
runFooter.append(find('.spark-main-actions'),find('[data-more]'));find('.spark-shell').append(runFooter);
for(const [action,label] of [['regenerate-story','仅重生成正文'],['replan-generate','重新规划并生成']]){const button=document.createElement('button');button.type='button';button.className='spark-button spark-small spark-text-button';button.dataset.action=action;button.textContent=label;find('[data-more]').append(button);}
const policyBar=document.createElement('div');policyBar.className='spark-text-actions';policyBar.dataset.policyBar='';
const policySummary=document.createElement('small');policySummary.dataset.policySummary='';
const clearPolicy=document.createElement('button');clearPolicy.type='button';clearPolicy.className='spark-button spark-small';clearPolicy.textContent='清空本轮必选 / 排除';clearPolicy.dataset.action='clear-policy';policyBar.append(policySummary,clearPolicy);find('[data-turn-selection]').append(policyBar);
find('[data-world]').closest('details').querySelector('summary').textContent='世界书注入配置';
const bindingNote=document.createElement('p');bindingNote.className='spark-hint';bindingNote.textContent='所有创作包共用这份世界书，资产正文也保存在其中。切换绑定会切换资产来源，原世界书保留；不会自动搬移内容。';find('[data-world]').closest('.spark-fold-body').prepend(bindingNote);
const carrierStatus=document.createElement('p');carrierStatus.className='spark-hint';carrierStatus.dataset.carrierStatus='';find('[data-page=settings]').prepend(carrierStatus);
const view = { phase: null, active: false, error: false, notice: '', dirty: false, received: false, execution: 0 };
let noticeTimer;
const notify = (message, error = false) => {
    view.notice = error ? message : ''; view.error = error;
    find('[data-notice]').hidden=true;
    syncView();
    clearTimeout(noticeTimer);
    if(!error && !['Planner 执行中…','等待审核'].includes(message)){find('[data-notice]').textContent=message;find('[data-notice]').hidden=false;noticeTimer=setTimeout(()=>{find('[data-notice]').hidden=true;},1600);}
    if (['规划已应用','Planner 执行中…','等待审核'].includes(message)) void renderPlan().catch(e => notify(e.message, true));
};
const world = new Worldbook(context, settings);
const flow = new Workflow(context, settings, world, notify);
const renderDiscoverySettings = installDiscoverySettings(panel, context, settings, world, flow, notify);
const workspace=installCurrentWorkspace(panel,context,settings,flow,renderPlan,notify);
installRequestObserver(flow);installMenuDismissal();
const recovery = new RegenerateRecovery(context, () => flow.chatKey(), () => settings().enabled, notify);
const host = createPanelHost(panel, context, () => {
    syncView();
    void renderPlan().catch(e => notify(e.message, true));
});
const features = installFeatures(panel,context,settings,world,flow,renderPlan,notify,async id=>{await host.close();const located=await world.open(id);if(!located)notify('已打开对应世界书；当前原生界面未能定位此条目');});
const settingsDirectory=installSettingsDirectory(panel,settings);
const runMore=moreMenu('更多');runMore.content.append(...find('[data-more]').children);find('[data-more]').replaceWith(runMore.menu);runMore.menu.dataset.more='';
const diagnostics=document.createElement('button');diagnostics.type='button';diagnostics.className='spark-button';diagnostics.dataset.action='request';diagnostics.textContent='本轮运行诊断';runMore.content.append(diagnostics);
find('[data-action=raw]').remove();const clearScheme=find('[data-action=clear]');clearScheme.classList.add('spark-danger');runMore.content.append(clearScheme);
const selectionFold=find('.spark-choice-fold'),selectionBody=selectionFold.querySelector('.spark-fold-body');selectionContainer=selectionBody;selectionFold.hidden=true;
const selectionNodes=selector=>selectionContainer.querySelectorAll(selector);
const adjustSelection=document.createElement('button');adjustSelection.type='button';adjustSelection.className='spark-button spark-text-button';adjustSelection.textContent='调整选材';adjustSelection.dataset.adjustSelection='';
find('[data-turn-selection] > .spark-section-title').append(adjustSelection);
adjustSelection.addEventListener('click',()=>void editDialog(context,{title:'本轮选材',size:'work',readOnly:true,fields:{},notify,setup:({body,popup})=>{popup.dlg.classList.add('spark-selection-dialog');body.append(selectionBody);},}).finally(()=>selectionFold.append(selectionBody)));
globalThis.sparkPlannerIntercept = async (...args) => {
    // Observe our interceptor's completion: paused/failed Quiet calls do not always
    // emit another GENERATION_ENDED. Forward abort and return values unchanged.
    let aborted = false;
    const execution=view.execution;
    const abort = args[2];
    args[2] = (...values) => { aborted = true; return abort(...values); };
    try { return await flow.intercept(...args); }
    finally {
        if (execution===view.execution && !flow.run && args[3] !== 'quiet') {
            if (aborted || view.phase === 'planning') view.phase = null;
            if (aborted) view.active = false;
            syncView();
        }
    }
};

let promptDisposables=[];
function renderPrompts() {
    for(const item of promptDisposables)item.dispose();promptDisposables=[];
    const box = find('[data-prompts]');
    box.replaceChildren();
    const hint=document.createElement('p');hint.className='spark-hint';hint.textContent='展开后直接编辑，修改自动保存。恢复默认文案前会再次确认。';box.append(hint);
    const labels = { task: 'Planner 总任务', reasoningBefore: 'Reasoning Skill 目录前置', reasoningAfter: 'Reasoning Skill 目录后置', sparkBefore: '火花目录前置', sparkAfter: '火花目录后置', discovery: '旧心理发现（已迁移）', protocol: '输出总协议', analysisDispatch:'分析模块调度说明', selectionFormat:'Reasoning Skill 与火花选择标记格式', analysisFormatIntro:'分析模块输出总起' };
    for (const key of Object.keys(DEFAULT_PROMPTS)) {
        if(key==='discovery')continue;
        const row=document.createElement('details');row.className='spark-prompt-section';row.dataset.promptKey=key;
        const title=document.createElement('summary');title.textContent=labels[key];
        const input=document.createElement('textarea');input.rows=6;input.value=settings().prompts[key];input.setAttribute('aria-label',labels[key]);

        input.addEventListener('input',()=>{settings().prompts[key]=input.value;context().saveSettingsDebounced();});
        row.append(title,input);box.append(row);
        promptDisposables.push(installTextTools(input,context,{target:'planner',key:`prompt:${key}`,expand:()=>void editDialog(context,{title:labels[key],large:true,tokenTarget:'planner',fields:{text:{label:labels[key],type:'textarea',value:input.value}},notify,submit:v=>{input.value=v.text;input.dispatchEvent(new Event('input',{bubbles:true}));}})}));
    }
}

let planRender = 0, displayedPlanId = null, displayedChoicesSignature;
function renderModelBadge(model,tags) {
    const hits=matchTags(model.modelId,tags).sort((a,b)=>Number(b.priority || 0)-Number(a.priority || 0) || (a.id<b.id?-1:a.id>b.id?1:0));
    const badge=find('[data-model-badge]');badge.textContent=hits[0]?.name || '通用';badge.title='当前 Generation 模型：'+(hits[0]?.name || '通用')+' · 点击查看匹配详情';
}
find('[data-model-badge]').addEventListener('click',async()=>{
    const model=await generationModel(context),tags=settings().modelTags || [],hits=matchTags(model.modelId,tags);
    renderModelBadge(model,tags);
    await editDialog(context,{title:'当前 Generation 模型',readOnly:true,label:'返回',notify,fields:{
        model:{label:'实际模型 ID',type:'textarea',rows:2,value:model.modelId || model.diagnostic},
        matches:{label:'全部命中标签与匹配规则',type:'textarea',rows:4,value:hits.map(t=>t.name+'（匹配优先级 '+Number(t.priority || 0)+'）\n'+t.groups.map(g=>g.join(' AND ')).join(' OR ')).join('\n\n') || '无命中标签（通用）'},
    }});
});
const choiceExpanded=new Set();
find('[data-choice-search]').addEventListener('input',filterChoices);
function filterChoices(){
    const query=find('[data-choice-search]').value.trim().toLocaleLowerCase();
    for(const group of selectionNodes('[data-choice-category]')){
        let visible=0;for(const row of group.querySelectorAll('[data-choice-search-text]')){row.hidden=!!query && !row.dataset.choiceSearchText.includes(query);if(!row.hidden)visible++;}
        group.hidden=!!query && !visible;group.open=query?!!visible:choiceExpanded.has(group.dataset.choiceCategory);
        group.firstChild.textContent=`${group.dataset.choiceCategory} · ${group.querySelectorAll('[data-id]').length} 项 · 已选 ${group.querySelectorAll('[data-id]:checked').length}`;
    }
}
async function renderPlan() {
    const render = ++planRender;
    const model=await generationModel(context),tags=settings().modelTags || [];
    if(render!==planRender)return;renderModelBadge(model,tags);
    let carrierReady=true;
    try {await flow.loadPackState();await renderDiscoverySettings();}
    catch(e){carrierReady=false;flow.packState=null;carrierStatus.textContent='绑定世界书不存在或无法读取：'+e.message;}
    for(const row of panel.querySelectorAll('[data-prompt-key]')){
        const input=row.querySelector('textarea');if(document.activeElement!==input && input.value!==settings().prompts[row.dataset.promptKey]){input.value=settings().prompts[row.dataset.promptKey];input.dispatchEvent(new Event('spark-text-refresh'));}
    }
    features.renderHistory();
    const plan = flow.current();
    displayedPlanId=plan?.id || null;
    view.dirty = plan?.applied===false;
    workspace.render(plan,flow.store().history.find(r=>r.generation?.chat===flow.chatKey() && r.generation.turn===plan?.turn));
    find('[data-plan-summary]').hidden=true;find('[data-plan-summary]').textContent = plan ? `${plan.applied!==false?'方案已应用':'有未应用修改'}${plan.consumed?' · 已用于正文生成':''} · ${plan.source==='manual'?'手动':'AI'}${plan.frozenInjection?' · 使用历史正文快照':''} · Reasoning Skill ${plan.selected.reasoning.length} 项 · 火花 ${plan.selected.spark.length} 项${plan.requiredIds?.length?' · 原规划必选 '+plan.requiredIds.length+' / AI 自主 '+((plan.original?.selected.reasoning.length || 0)+(plan.original?.selected.spark.length || 0)):''}` : '可直接调整选材或填写指导，创建本轮方案。';
    find('[data-raw]').textContent = plan?.raw || '';
    find('[data-current-debug]').hidden=false;
    syncView();
    const box = find('[data-choices]');
    let skills=[];
    try {skills=settings().world && carrierReady?await world.skills():[];if(carrierReady)carrierStatus.textContent=flow.syncError?'镜像同步异常：'+flow.syncError:settings().world?'注入载体已就绪':'尚未配置注入载体';}
    catch(e){carrierStatus.textContent='绑定世界书不存在或无法读取：'+e.message;flow.packState=null;}
    settingsDirectory.render();
    if (render !== planRender) return;
    find('[data-library-summary]').textContent = settings().world ? `${settings().world} · ${skills.length} 项条目` : '请先在设置中绑定世界书。';
    if(render!==planRender)return;
    const currentSkills=skills.filter(s=>!flow.packReason(s.packId) || [...(plan?.selected.reasoning || []),...(plan?.selected.spark || [])].includes(s.id));
    const selectedIds=new Set([...(plan?.selected.reasoning || []),...(plan?.selected.spark || [])]);
    for(const entry of plan?.entries || []) {
        const meta=entry[KEY];
        if(meta?.kind==='skill' && selectedIds.has(meta.id) && !skills.some(s=>s.id===meta.id)) currentSkills.push({id:meta.id,type:meta.type,title:entry.comment || '历史条目',body:entry.content,recommendation:meta.recommendation,versions:meta.versions,category:meta.category || '历史快照',fromSnapshot:true});
    }
    const categoryGroups=new Map();
    const diagnosticEntries=plan && carrierReady && settings().world?await world.entries():[];
    const effectivePlan=plan?{...plan,entries:flow.effectiveEntries(plan.entries || [],diagnosticEntries)}:null;
    if(render!==planRender)return;
    const diagnostics=plan?.frozenInjection?{...plan.frozenInjection.model,skills:[]}:plan?flow.resolveEntries(effectivePlan,model,tags,diagnosticEntries).resolution:null;
    const unavailable=diagnostics?.skills.filter(s=>s.reason) || [];
    find('[data-unavailable-summary]').textContent=unavailable.length?'保留当前选择；实际生成将跳过：'+unavailable.map(s=>`${s.title || s.id}（${s.reason}）`).join('；'):'';
    find('[data-unavailable-summary]').hidden=!unavailable.length;
    const currentPage=find('[data-page=current]'),scroll=currentPage.scrollTop;
    const choicesSignature=JSON.stringify([flow.chatKey(),settings().world,model.modelId,tags,currentSkills,plan?.id,plan?.revision,plan?.selected,flow.policies(),flow.mode()]);
    if(choicesSignature!==displayedChoicesSignature){displayedChoicesSignature=choicesSignature;box.replaceChildren();
    for(const source of currentSkills.sort((a,b)=>(a.type==='reasoning'?0:1)-(b.type==='reasoning'?0:1))) {
        const skill=source;
        const historical=plan?.frozenInjection?.items.find(i=>i.kind==='skill' && i.id===skill.id);
        const r=historical?{version:{id:historical.versionId,body:historical.content},label:historical.versionLabel}:resolveVersion(skill,model.modelId,tags), unavailable=!historical && (!r.version || skill.enabled===false || skill.fromSnapshot || !!flow.packReason(skill.packId));
        let group=categoryGroups.get(skill.category || '未分类');
        if(!group){
            group=document.createElement('details');group.className='spark-fold spark-category';group.dataset.choiceCategory=skill.category || '未分类';
            const summary=document.createElement('summary'),items=document.createElement('div');items.className='spark-category-items';group.append(summary,items);box.append(group);categoryGroups.set(group.dataset.choiceCategory,group);
            summary.addEventListener('click',()=>{if(!find('[data-choice-search]').value.trim()){if(group.open)choiceExpanded.delete(group.dataset.choiceCategory);else choiceExpanded.add(group.dataset.choiceCategory);}});
        }
        const packName=flow.packState?.packs.find(p=>p.id===skill.packId)?.name || '';
        const row=document.createElement('div');row.className='spark-choice-row';row.dataset.choiceSearchText=[skill.title,r.version?.recommendation,skill.category,packName].join(' ').toLocaleLowerCase();
        const check=document.createElement('input');check.type='checkbox';check.dataset.id=skill.id;check.dataset.type=skill.type;check.dataset.unavailable=String(unavailable);
        check.checked=selectedIds.has(skill.id);check.dataset.skillTitle=skill.title;check.setAttribute('aria-label','本轮选择：'+skill.title);
        const policy=document.createElement('select');policy.dataset.policyId=skill.id;policy.setAttribute('aria-label','本轮选择策略：'+skill.title);
        for(const [value,text] of [['auto','自动'],['required','必选'],['excluded','排除']]){const option=document.createElement('option');option.value=value;option.textContent=text;option.disabled=value==='required' && unavailable;policy.append(option);}
        policy.value=flow.policies()[skill.id] || 'auto';policy.hidden=flow.mode()==='manual';
        policy.addEventListener('change',()=>{flow.setPolicy(skill.id,policy.value);syncView();});
        const title=document.createElement('button');title.type='button';title.className='spark-button spark-title-button';title.textContent=skill.title;title.dataset.skillType=skill.type;
        const reason=skill.fromSnapshot?'条目已删除或不在当前绑定世界书中':flow.packReason(skill.packId) || (skill.enabled===false?'条目已设为不可选':r.reason);
        title.title=[skill.type==='reasoning'?(hasEcot(skill,r.version)?'Reasoning · 含 ECoT':'Reasoning Skill'):'火花',reason || r.label,r.warning].filter(Boolean).join(' · ');
        row.dataset.unavailable=String(unavailable);
        const selection=()=>{
            if(historical)return {used:{content:historical.content},versionId:historical.versionId,version:{id:historical.versionId,body:historical.content},label:historical.versionLabel};
            const editingDraft=!!flow.pending || plan?.applied===false || plan?.next;
            const execution=!editingDraft && flow.lastActivation?.id===plan?.id?flow.lastActivation:null;
            const used=execution?.entries.find(e=>e[KEY]?.kind==='skill' && e[KEY].id===skill.id);
            const resolved=execution?.generationResolution.skills.find(s=>s.id===skill.id);
            const planned=!editingDraft?plan?.modelResolution?.skills?.find(s=>(s.skillId || s.id)===skill.id):null;
            const versionId=resolved?.versionId || planned?.id || r.version?.id;
            const version=(used?.[KEY]?.versions || skill.versions)?.find(v=>v.id===versionId) || r.version;
            return {used,versionId,version,label:resolved?.label || planned?.label || r.label};
        };
        check.sparkActions={
            view:()=>{const {used,version,label}=selection();return editDialog(context,{title:skill.title,readOnly:true,label:'返回',notify,fields:{
                version:{label:'本轮适配版本',value:label || reason},
                recommendation:{label:'启用条件',type:'textarea',value:version?.recommendation || ''},
                body:{label:'正文',type:'textarea',value:used?.content ?? version?.body ?? ''},
                ...(hasEcot(skill,version)?{ecotText:{label:'ECoT 提问',type:'textarea',value:version.ecotText},ecotOutlet:{label:'Outlet 锚点',value:version.ecotOutlet || 'EcoT'}}:{}),
            }});},
            edit:async()=>{try{await features.editSkill(skill.id,selection().versionId);}catch(e){notify(e.message,true);}},
        };
        title.addEventListener('click',()=>void check.sparkActions.view());
        row.append(check,title,policy);group.lastChild.append(row);
    }
    if(!currentSkills.length){const hint=document.createElement('p');hint.className='spark-hint';hint.textContent='暂无素材，请在创作库中录入。';box.append(hint);}
    }
    filterChoices();
    renderSelected(); syncView();currentPage.scrollTop=scroll;await features.render(skills,carrierReady);
}

let selectedDisposers=[];
function renderSelected() {
    filterChoices();
    const selected = find('[data-selected]'),checksById=new Map([...selectionNodes('[data-id]:checked')].map(check=>[check.dataset.id,check]));
    const signature=JSON.stringify([...checksById.values()].map(check=>[check.dataset.id,check.dataset.type,check.dataset.skillTitle]));
    if(selected.dataset.signature===signature){
        for(const chip of selected.querySelectorAll('[data-selected-id]'))chip.sparkActions=checksById.get(chip.dataset.selectedId).sparkActions;
        return;
    }
    for(const dispose of selectedDisposers)dispose();selectedDisposers=[];
    selected.dataset.signature=signature;selected.replaceChildren();
    for(const [type,name] of [['reasoning','Reasoning Skill'],['spark','火花']]) {
        const checks=[...selectionNodes('[data-id]:checked')].filter(c=>c.dataset.type===type);
        if(!checks.length)continue;
        const group=document.createElement('div');group.className='spark-selected-group';group.dataset.selectedType=type;
        const heading=document.createElement('strong');heading.textContent=name;group.append(heading);selected.append(group);
        for (const check of checks) {
        const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'spark-button spark-chip';
        chip.textContent = check.dataset.skillTitle; chip.title = `${check.dataset.skillTitle} · 点击查看；长按或右键编辑`;
        chip.dataset.selectedId=check.dataset.id;
        chip.sparkActions=check.sparkActions;
        const item=document.createElement('span');item.className='spark-selected-item';item.append(chip);group.append(item);
        selectedDisposers.push(selectedEntryActions(chip,{view:()=>chip.sparkActions.view(),edit:()=>chip.sparkActions.edit()}));

        }
    }
    if (!selected.childElementCount) { const hint = document.createElement('p'); hint.className = 'spark-hint'; hint.textContent = '暂无已选条目'; selected.append(hint); }
}

function syncView() {
    const plan = flow.current();
    find('[data-policy-bar]').hidden=flow.mode()==='manual';
    const policyValues=Object.values(flow.policies());find('[data-policy-summary]').textContent=`必选 ${policyValues.filter(v=>v==='required').length} · 排除 ${policyValues.filter(v=>v==='excluded').length}`;find('[data-policy-bar]').hidden=flow.mode()==='manual' || !policyValues.length;
    find('[data-action=regenerate-story]').hidden=!plan || !!flow.pending;
    find('[data-action=replan-generate]').hidden=flow.mode()==='manual' || !!flow.pending || !context().chat.some(m=>m.is_user);
    const state = getViewState({ enabled: settings().enabled, mode:flow.mode(),reviewing:!!flow.pending,planning: !!flow.run || (!flow.pending && view.phase === 'planning'), generating: !flow.pending && view.phase === 'generating', error: view.error || plan?.generationFailed, plan, hasReply: !!context().chat.at(-1) && !context().chat.at(-1).is_user, dirty: view.dirty });
    panel.dataset.viewState = state.phase;
    find('[data-phase]').textContent = state.label;
    find('[data-status]').textContent=view.notice || (state.phase==='planning'?'正在规划…':state.phase==='generating'?'正在生成…':'');
    find('[data-status]').hidden=!find('[data-status]').textContent;
    for (const action of ['apply', 'resume', 'cancel','clear']) find(`[data-action=${action}]`).hidden = !state[action];
    find('[data-action=cancel]').textContent=flow.pending?'取消本次运行':'停止本次运行';
    find('[data-more]').hidden = false;
    find('[data-action=restore]').hidden = !plan?.original || flow.mode()==='manual';
    find('[data-action=only]').hidden=flow.mode()==='manual' || !!flow.pending;
    find('[data-action=replan]').hidden = flow.mode()==='manual' || !context().chat.some(m => m.is_user);
    const retry = find('[data-action=replan]');
    retry.textContent = state.phase === 'failed' ? '重试规划' : '重新规划';
    for (const input of selectionNodes('[data-id]')) input.disabled = !settings().enabled || input.dataset.unavailable==='true';
    find('[data-setting=enabled]').checked = settings().enabled;
    find('[data-setting=runMode]').value = flow.mode();
}
function saveDraftFromControls() {
    planRender++; // A late asset-list refresh must not overwrite a newer edit.
    const selected={reasoning:[],spark:[]};
    for(const check of selectionNodes('[data-id]:checked'))selected[check.dataset.type].push(check.dataset.id);
    const draft=flow.editDraft({selected,discovery:flow.current()?.discovery || ''});
    displayedPlanId=draft.id;view.dirty=true;syncView();
}

function handleSelectionChange(event) {
    if (event.target.matches('[data-id]')) {
        const check=event.target;
        if(check.checked && check.dataset.unavailable==='true') {
            check.checked=false;notify('只能选择当前可用的条目',true);
        }
        saveDraftFromControls();renderSelected();
    }
}
panel.addEventListener('change',handleSelectionChange);selectionContainer.addEventListener('change',event=>{if(!panel.contains(event.target))handleSelectionChange(event);});

function refreshBooks() {
    const select = find('[data-world]'); select.replaceChildren();
    for (const name of ['', ...context().getWorldInfoNames()]) {
        const option = document.createElement('option'); option.value = name; option.textContent = name || '请选择世界书'; select.append(option);
    }
    select.value = settings().world;
}

for (const input of panel.querySelectorAll('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'checkbox') input.checked = settings()[key]; else input.value = settings()[key];
    input.addEventListener('change', () => {
        if (input.type === 'number' && !input.checkValidity()) { input.reportValidity(); return; }
        if(key==='runMode' && (flow.run || flow.pending || flow.active))flow.cancel();
        settings()[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        if(key==='contextMode') find('[data-planner-preset-row]').hidden=input.value!=='standalone';
        if (key === 'enabled' && !input.checked) flow.cancel();
        context().saveSettingsDebounced();
        notify(key==='enabled'?(settings().enabled?'已启用':'已关闭：插件内容退出生成扫描'):'设置已保存');
    });
}
find('[data-world]').addEventListener('change', async event => {
    const selected=event.target.value,previous=settings().world;
    if(selected===previous)return;
    if(previous && !await context().Popup.show.confirm('切换创作资产来源','绑定变更会切换创作包和素材来源，原世界书保留且不会自动搬移。是否继续？')){event.target.value=previous;return;}
    flow.cancel(); settings().world = event.target.value;settings().discoveryId=''; context().saveSettingsDebounced();
    try { if (settings().world) await world.ensureDiscovery(); await renderPlan(); } catch (e) { notify(e.message, true); }
});
find('[data-planner-preset-row]').hidden=settings().contextMode!=='standalone';

panel.addEventListener('click', async event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { switchTab(tab.dataset.tab); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    try {
        if(action==='clear-policy'){flow.clearPolicies();await renderPlan();return;}
        if(['regenerate-story','replan-generate'].includes(action)) {
            if(document.body.dataset.generating)throw new Error('请先结束当前运行');
            if(findInput().value.trim())throw new Error('输入框有新内容，请清空后重生成');
            await flow.generateWithPlan({replan:action==='replan-generate'});await renderPlan();return;
        }
        if(action==='raw'){const debug=find('[data-current-debug]');debug.hidden=false;debug.open=!debug.open;return;}
        if(action==='copy-raw'){await navigator.clipboard.writeText(flow.current()?.raw || '');notify('原始输出已复制');return;}
        if(action==='request'){const plan=flow.current(),record=flow.store().history.find(r=>r.id===flow.active?.generationRecordId) || flow.store().history.find(r=>r.generation?.turn===plan?.turn && r.generation.chat===flow.chatKey()) || flow.store().history.find(r=>r.id===plan?.id);await showRunDiagnostics(context,record || {},notify,{editSkill:features.editSkill});return;}
        if (action === 'cancel') {
            flow.cancel();view.phase=null;view.active=false;await renderPlan();
            return;
        }
        if (['only','replan','resume','apply','restore','clear'].includes(action) && (flow.run || (document.body.dataset.generating && !flow.pending))) throw new Error('请等待当前运行完成，或点击停止。');
        if (action === 'refresh') { await context().updateWorldInfoList(); refreshBooks(); }
        if (action === 'create') { flow.cancel({stop:false});await world.create(find('[data-book-name]').value.trim()); refreshBooks(); }
        if (action === 'open') { await host.close(); await world.open(); }
        if (action === 'defaults' && await context().Popup.show.confirm('恢复默认文案', '将覆盖全局 Planner 提示词，分析模块内容保留。是否继续？')) { settings().prompts = { ...DEFAULT_PROMPTS }; settings().analysisMigrationPending=false; context().saveSettingsDebounced(); renderPrompts(); await renderPlan(); }
        if (['only', 'resume', 'replan'].includes(action) && !settings().enabled) throw new Error('请先开启总开关。');
        if (action === 'only') {
            if (findInput().value.trim()) {
                flow.only = true;
                await context().generate('normal');
            } else await flow.plan();
        }
        if (action === 'replan') await flow.plan();
        if (action === 'resume') {
            if (!flow.current()) throw new Error('当前轮没有有效规划，请先规划。');
            if(flow.current().awaitingReview && !flow.pending)throw new Error('原始生成操作已失效，请通过酒馆重新发起生成，重新审核后继续。');
            if(findInput().value.trim())throw new Error('输入框有新的内容，请清空后继续，或取消本次运行并重新发送。');
            if(flow.pending)await flow.resume();
            else {
                await flow.apply(flow.ensureDraft());flow.confirmNext=true;
                await context().generate(flow.current().generationType || 'regenerate');
            }
        }
        if(action==='clear'){flow.clearDraft();view.dirty=false;await flow.apply();}
        if (action === 'apply' || action === 'restore') {
            if (action === 'restore') flow.editDraft(structuredClone(flow.current()?.original || {}));
            else if(flow.mode()==='manual')saveDraftFromControls();
            view.dirty=false;
            await flow.apply(flow.ensureDraft());
        }
        await renderPlan();
    } catch (error) {
        if(['apply','restore'].includes(action))view.dirty=true;
        flow.only=false;notify(error.message,true);
        if(['apply','resume','restore','replan'].includes(action))await renderPlan().catch(e=>notify(e.message,true));
    }
});
function findInput() { return document.querySelector('#send_textarea'); }
function switchTab(name) {
    runFooter.hidden=name!=='current';
    if(name==='settings') void renderDiscoverySettings().catch(e=>notify(e.message,true));
    for (const tab of panel.querySelectorAll('[data-tab]')) {
        const active = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    for (const page of panel.querySelectorAll('[data-page]')) {if(!page.hidden)page.sparkScroll=page.scrollTop;page.hidden = page.dataset.page !== name;if(!page.hidden)page.scrollTop=page.sparkScroll || 0;}
}
find('[role=tablist]').addEventListener('keydown', event => {
    const tabs = [...panel.querySelectorAll('[data-tab]')];
    const index = tabs.indexOf(document.activeElement);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    switchTab(tabs[next].dataset.tab); tabs[next].focus();
});

const events = c.eventTypes;
const required = ['WORLDINFO_ENTRIES_LOADED', 'GENERATION_STARTED', 'CHAT_CHANGED'];
if (required.some(key => !events[key]) || typeof c.generateQuietPrompt !== 'function') {
    settings().enabled = false;
    notify('缺少必需接口。请使用官方 SillyTavern 1.18.0 或更新版本。', true);
}
c.eventSource.on(events.WORLDINFO_ENTRIES_LOADED, lore => flow.lore(lore));
if(events.WORLD_INFO_ACTIVATED)c.eventSource.on(events.WORLD_INFO_ACTIVATED,entries=>flow.observeActivated(entries));
if(events.CHAT_COMPLETION_SETTINGS_READY)c.eventSource.makeLast(events.CHAT_COMPLETION_SETTINGS_READY,data=>{if(!flow.run && flow.active)flow.prepareTransport('generation',data);});
c.eventSource.on(events.GENERATION_STARTED, (type, _options, dryRun) => {
    if (!flow.run && !flow.pending && !flow.active) recovery.start(type, dryRun);
    if (!dryRun && !['quiet', 'impersonate'].includes(type) && !flow.pending) {
        view.execution++; view.phase = ['swipe', 'regenerate', 'continue'].includes(type) ? 'generating' : 'planning';
        view.active = true;
        view.received = false; view.error = false; view.notice = ''; syncView();
    }
});
c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => {
    if (!dryRun && !flow.run && view.active) { flow.captureGeneration(_data);if(context().mainApi!=='openai')flow.prepareTransport('generation',_data);view.phase = 'generating'; view.notice = ''; syncView(); }
});
c.eventSource.on(events.GENERATION_ENDED, () => {
    if (flow.run || flow.pending) return;
    const failedStream = context().streamingProcessor?.isStopped === true;
    const execution = view.execution;
    setTimeout(() => {
        if (execution !== view.execution) return;
        if (view.phase === 'generating' && (!view.received || failedStream)) {
            view.error = true; view.notice = '正文生成未完成，可查看详情或重新尝试。';
        }
        view.phase = null; view.active = false; syncView();
        flow.finishGeneration(view.received && !failedStream);
        void renderPlan().catch(e=>notify(e.message,true));
        // Persist the retryable plan before recovery saves and reloads the chat.
        void recovery.finish(failedStream).catch(e => notify(e.message, true));
    }, 0);
});
c.eventSource.on(events.GENERATION_STOPPED, () => { if(flow.run && flow.run.chat!==flow.chatKey())return;if(flow.run || flow.pending || flow.active || view.active)flow.stopped();view.phase=null;view.active=false;syncView(); });
c.eventSource.on(events.CHAT_CHANGED, () => {
    recovery.backup = null;
    // Do not cancel a draft in the newly selected chat.
    flow.active=null;const pending=flow.pending;flow.pending=null;pending?.resolve(false);
    flow.epoch=(flow.epoch || 0)+1;
    if(flow.run){flow.run.cancelled=true;flow.run.controller?.abort();context().stopGeneration();}
    flow.only = false;
    flow.lastRequest = null;
    view.execution++; view.phase = null; view.active = false; view.error = false; view.notice = ''; view.dirty = false;
    flow.recoverInterrupted();
    void renderPlan().catch(e => notify(e.message, true));
});
c.eventSource.on(events.MESSAGE_RECEIVED, () => { view.received = true; recovery.received(); void renderPlan().catch(e => notify(e.message, true)); });
find('[data-preset-preview]').textContent=settings().plannerPreset;
find('[data-edit-preset]').addEventListener('click',()=>void editDialog(context,{title:'独立 Planner 基础预设',tokenTarget:'planner',fields:{text:{label:'基础预设',type:'textarea',value:settings().plannerPreset}},notify,submit:v=>{settings().plannerPreset=v.text;context().saveSettingsDebounced();find('[data-preset-preview]').textContent=v.text;notify('基础预设已保存');}}));
for(const name of ['CHATCOMPLETION_MODEL_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','MAIN_API_CHANGED','SETTINGS_UPDATED'])if(events[name])c.eventSource.on(events[name],()=>{if(!flow.run)void renderPlan().catch(e=>notify(e.message,true));});
renderPrompts(); refreshBooks();flow.recoverInterrupted();
void renderPlan().catch(e => notify(e.message, true));
