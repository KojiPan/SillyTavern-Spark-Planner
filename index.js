import { showRequest } from './request-viewer.js';
import { generationModel, resolveVersion, matchTags } from './model-versions.js';
import { KEY, DEFAULT_PROMPTS, migrateDefaults, migrateAnalysisPrompts } from './core.js';
import { Workflow } from './workflow.js';
import { Worldbook } from './worldbook.js';
import { RegenerateRecovery } from './recovery.js';
import { createPanelHost } from './panel-host.js';
import { getViewState } from './view-state.js';
import { installFeatures } from './features.js';
import { NATIVE_FIELDS } from './skill-pack.js';
import { DEFAULT_PLANNER_PRESET } from './planner-context.js';
import { installDiscoverySettings } from './discovery-settings.js';
import { editDialog } from './editor.js';
import { hasEcot } from './ecot.js';

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
<div class="spark-card spark-run-bar"><label class="spark-toggle spark-master"><span><strong>启用规划器</strong></span><input type="checkbox" data-setting="enabled"></label><div class="spark-status" role="status" aria-live="polite"><strong data-phase>未启用</strong><p data-status>关闭面板后仍可正常聊天。</p></div></div>
<div class="spark-card spark-current-content"><label class="spark-section-title">本轮分析<textarea data-discovery rows="5" placeholder="规划完成后查看和编辑本轮分析"></textarea></label><span data-discovery-preview hidden></span><p class="spark-hint" data-plan-summary>本轮尚无已应用规划。</p>
<p class="spark-hint" data-unavailable-summary hidden></p>
<div class="spark-section-title">本轮条目</div><div class="spark-chips" data-selected></div><details class="spark-fold spark-choice-fold"><summary>调整本轮条目</summary><div class="spark-fold-body"><input type="search" data-choice-search aria-label="搜索本轮条目" placeholder="搜索标题或推荐开启"><div data-choices></div></div></details>
<div class="spark-actions spark-main-actions"><button type="button" class="spark-button spark-primary" data-action="apply" hidden>应用修改</button><button type="button" class="spark-button spark-primary" data-action="resume" hidden>继续生成正文</button><button type="button" class="spark-button" data-action="cancel" hidden>停止本次运行</button></div>
<div class="spark-text-actions" data-more><button type="button" class="spark-button spark-small spark-text-button" data-action="only">仅规划</button><button type="button" class="spark-button spark-small spark-text-button" data-action="replan">重新规划</button><button type="button" class="spark-button spark-small spark-text-button" data-action="restore">恢复原选择</button><button type="button" class="spark-button spark-small spark-text-button" data-action="raw">查看原始输出</button></div>
<details class="spark-fold spark-debug" data-current-debug hidden><summary>原始输出与诊断</summary><div class="spark-fold-body"><pre data-raw></pre><p class="spark-hint" data-version-summary></p><pre data-version-debug></pre><button type="button" class="spark-button spark-small spark-text-button" data-action="request">查看实际请求</button></div></details></div></section>
<section id="spark-page-history" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-history" data-page="history" hidden><div class="spark-card"><div class="spark-section-title">历史</div><p class="spark-hint">正在读取当前聊天最近 50 次规划。</p></div></section>
<section id="spark-page-library" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-library" data-page="library" hidden>
<div class="spark-card"><div class="spark-section-title">创作库</div><p class="spark-hint" data-library-summary>请先在设置中绑定世界书。</p></div><div data-library-list></div></section>
<section id="spark-page-settings" class="spark-page" role="tabpanel" aria-labelledby="spark-tab-settings" data-page="settings" hidden>
<details class="spark-card spark-fold"><summary>世界书绑定</summary><div class="spark-fold-body"><label>绑定世界书<select data-world></select></label><div class="spark-actions"><button type="button" class="spark-button" data-action="refresh">刷新列表</button><button type="button" class="spark-button" data-action="open">打开世界书编辑器</button></div><label>新建专用世界书名称<input data-book-name value="火花规划器素材"></label><button type="button" class="spark-button spark-primary" data-action="create">创建并绑定</button><p class="spark-hint">仅管理本插件条目。镜像保持原生禁用，仅在本次生成扫描中启用。</p></div></details>
<details class="spark-card spark-fold"><summary>Planner 参数</summary><div class="spark-fold-body"><label>Planner 上下文模式<select data-setting="contextMode"><option value="native">模式一：沿用酒馆预设（默认）</option><option value="standalone">模式二：独立默认预设</option></select></label><div data-planner-preset-row hidden class="spark-setting-row"><div><strong>独立 Planner 基础预设</strong><p class="spark-text-preview" data-preset-preview></p></div><button type="button" class="spark-button spark-small" data-edit-preset>编辑</button></div><label class="spark-toggle"><span>Planner 后自动继续生成</span><input type="checkbox" data-setting="autoContinue"></label><label>Reasoning Skill 上限<input type="number" min="0" max="50" data-setting="reasoningLimit"></label><label>最大输出 Token<input type="number" min="64" max="52000" data-setting="maxTokens"></label><label>超时（秒）<input type="number" min="5" max="600" data-setting="timeout"></label></div></details>
<details class="spark-card spark-fold"><summary>本轮分析</summary><div class="spark-fold-body"><div class="spark-setting-row"><span>本轮分析插入位置 <small data-discovery-insertion-summary></small></span><button type="button" class="spark-button spark-small" data-discovery-edit>编辑</button></div></div></details>
<details class="spark-card spark-fold"><summary>任务提示词</summary><div class="spark-fold-body"><div data-prompts></div><button type="button" class="spark-button" data-action="defaults">恢复默认文案</button></div></details></section></div>`;
const find = selector => panel.querySelector(selector);
const view = { phase: null, active: false, error: false, notice: '', dirty: false, received: false, execution: 0 };
const notify = (message, error = false) => {
    view.notice = error ? message : ''; view.error = error;
    find('[data-notice]').hidden=true;
    syncView();
    if(message!=='Planner 执行中…')globalThis.toastr?.[error?'error':'success'](message,'',{toastClass:'toast spark-toast',escapeHtml:true,tapToDismiss:false,timeOut:error?3500:1600,extendedTimeOut:600,positionClass:'toast-bottom-right',preventDuplicates:true});
    if (message === '规划已应用' || message === 'Planner 执行中…') void renderPlan().catch(e => notify(e.message, true));
};
const world = new Worldbook(context, settings);
const flow = new Workflow(context, settings, world, notify);
const renderDiscoverySettings = installDiscoverySettings(panel, context, settings, world, flow, notify);
const recovery = new RegenerateRecovery(context, () => flow.chatKey(), () => settings().enabled, notify);
const host = createPanelHost(panel, context, () => {
    switchTab('current'); syncView();
    if (!view.dirty) void renderPlan().catch(e => notify(e.message, true));
});
const features = installFeatures(panel,context,settings,world,flow,renderPlan,notify,async id=>{await host.close();const located=await world.open(id);if(!located)notify('已打开对应世界书；当前原生界面未能定位此条目');});
globalThis.sparkPlannerIntercept = async (...args) => {
    // Observe our interceptor's completion: paused/failed Quiet calls do not always
    // emit another GENERATION_ENDED. Forward abort and return values unchanged.
    let aborted = false;
    const abort = args[2];
    args[2] = (...values) => { aborted = true; return abort(...values); };
    try { return await flow.intercept(...args); }
    finally {
        if (!flow.run && args[3] !== 'quiet') {
            if (aborted || view.phase === 'planning') view.phase = null;
            if (aborted) view.active = false;
            syncView();
        }
    }
};

function renderPrompts() {
    const box = find('[data-prompts]');
    box.replaceChildren();
    const labels = { task: 'Planner 总任务', reasoningBefore: 'Reasoning Skill 目录前置', reasoningAfter: 'Reasoning Skill 目录后置', sparkBefore: '火花目录前置', sparkAfter: '火花目录后置', discovery: '旧心理发现（已迁移）', protocol: '输出总协议', analysisDispatch:'分析模块调度说明', selectionFormat:'Reasoning Skill 与火花选择标记格式', analysisFormatIntro:'分析模块输出总起' };
    for (const key of Object.keys(DEFAULT_PROMPTS)) {
        if(key==='discovery')continue;
        const row=document.createElement('div');row.className='spark-setting-row';row.dataset.promptKey=key;
        const text=document.createElement('div'),title=document.createElement('strong'),preview=document.createElement('p');
        title.textContent=labels[key];preview.className='spark-text-preview';preview.textContent=settings().prompts[key];text.append(title,preview);
        const edit=document.createElement('button');edit.type='button';edit.className='spark-button spark-small';edit.textContent='编辑';edit.setAttribute('aria-label', '编辑'+labels[key]);
        edit.addEventListener('click',()=>void editDialog(context,{title:labels[key],fields:{text:{label:labels[key],type:'textarea',value:settings().prompts[key]}},notify,submit:v=>{settings().prompts[key]=v.text;context().saveSettingsDebounced();preview.textContent=v.text;notify('提示词已保存');}}));
        row.append(text,edit);box.append(row);
    }
}

let planRender = 0, displayedPlanId = null;
function renderModelBadge(model,tags) {
    const hits=matchTags(model.modelId,tags).sort((a,b)=>Number(b.priority || 0)-Number(a.priority || 0) || (a.id<b.id?-1:a.id>b.id?1:0));
    const badge=find('[data-model-badge]');badge.textContent=hits[0]?.name || '通用';badge.title='当前 Generation 模型：'+(hits[0]?.name || '通用')+' · 点击查看匹配详情';
}
find('[data-model-badge]').addEventListener('click',async()=>{
    const model=await generationModel(context),tags=settings().modelTags || [],hits=matchTags(model.modelId,tags);
    renderModelBadge(model,tags);
    await editDialog(context,{title:'当前 Generation 模型',readOnly:true,label:'返回',notify,fields:{
        model:{label:'实际模型 ID',type:'textarea',rows:2,value:model.modelId || model.diagnostic},
        matches:{label:'全部命中标签与匹配规则',type:'textarea',rows:4,value:hits.map(t=>t.name+'（优先级 '+Number(t.priority || 0)+'）\n'+t.groups.map(g=>g.join(' AND ')).join(' OR ')).join('\n\n') || '无命中标签（通用）'},
    }});
});
const choiceExpanded=new Set();
find('[data-choice-search]').addEventListener('input',filterChoices);
function filterChoices(){
    const query=find('[data-choice-search]').value.trim().toLocaleLowerCase();
    for(const group of panel.querySelectorAll('[data-choice-category]')){
        let visible=0;for(const row of group.querySelectorAll('[data-choice-search-text]')){row.hidden=!!query && !row.dataset.choiceSearchText.includes(query);if(!row.hidden)visible++;}
        group.hidden=!!query && !visible;group.open=query?!!visible:choiceExpanded.has(group.dataset.choiceCategory);
        group.firstChild.textContent=`${group.dataset.choiceCategory} · ${group.querySelectorAll('[data-id]').length} 项 · 已选 ${group.querySelectorAll('[data-id]:checked').length}`;
    }
}
async function renderPlan() {
    const render = ++planRender;
    const model=await generationModel(context),tags=settings().modelTags || [];
    if(render!==planRender)return;renderModelBadge(model,tags);
    await flow.loadPackState();
    await renderDiscoverySettings();
    for(const row of panel.querySelectorAll('[data-prompt-key]'))row.querySelector('.spark-text-preview').textContent=settings().prompts[row.dataset.promptKey];
    features.renderHistory();
    const plan = flow.current();
    const preserveDraft=!!plan && view.dirty && displayedPlanId===plan.id;
    const draftText=find('[data-discovery]').value;
    const draftIds=new Set([...panel.querySelectorAll('[data-id]:checked')].map(el=>el.dataset.id));
    displayedPlanId=plan?.id || null;
    view.dirty = preserveDraft;
    find('[data-discovery]').value = preserveDraft ? draftText : plan?.discovery || '';
    find('[data-discovery-preview]').textContent = plan?.discovery || (plan ? '本轮没有分析结果，可在此编辑。' : '规划完成后在这里查看本轮分析。');
    find('[data-plan-summary]').textContent = plan ? `已应用 · Reasoning Skill ${plan.selected.reasoning.length} 项 · 火花 ${plan.selected.spark.length} 项${plan.warnings.length ? ` · ${plan.warnings.length} 条解析警告` : ''}` : '本轮尚无已应用规划。先发送消息或运行仅规划。';
    find('[data-raw]').textContent = plan ? `${plan.raw}\n\n${plan.warnings.join('\n')}` : '本轮尚无已应用规划。';
    syncView();
    const box = find('[data-choices]');
    box.replaceChildren();
    const skills = settings().world ? await world.skills() : [];
    if (render !== planRender) return;
    find('[data-library-summary]').textContent = settings().world ? `${settings().world} · ${skills.length} 项条目` : '请先在设置中绑定世界书。';
    if(render!==planRender)return;
    const currentSkills=skills.filter(s=>!flow.packReason(s.packId) || [...(plan?.selected.reasoning || []),...(plan?.selected.spark || [])].includes(s.id));
    const selectedIds=new Set([...(plan?.selected.reasoning || []),...(plan?.selected.spark || [])]);
    for(const entry of plan?.entries || []) {
        const meta=entry[KEY];
        if(meta?.kind==='skill' && selectedIds.has(meta.id) && !skills.some(s=>s.id===meta.id)) currentSkills.push({id:meta.id,type:meta.type,title:entry.comment || '历史条目',body:entry.content,recommendation:meta.recommendation,versions:meta.versions,category:meta.category || '历史快照',fromSnapshot:true});
    }
    const signature=e=>JSON.stringify([e?.content,e?.[KEY]?.versions,...NATIVE_FIELDS.map(key=>e?.[key])]);
    if(plan) for(const skill of skills.filter(s=>selectedIds.has(s.id))) {
        const snapshot=plan.entries?.find(e=>e[KEY]?.kind==='skill' && e[KEY].id===skill.id);
        if(snapshot && signature(snapshot)!==signature(skill.entry)) view.dirty=true;
    }
    const categoryGroups=new Map();
    const diagnosticEntries=plan?await world.entries():[];
    const effectivePlan=plan?{...plan,entries:flow.effectiveEntries(plan.entries || [],diagnosticEntries)}:null;
    if(render!==planRender)return;
    const diagnostics=plan?flow.resolveEntries(effectivePlan,model,tags,diagnosticEntries).resolution:null;
    const unavailable=diagnostics?.skills.filter(s=>s.reason) || [];
    find('[data-unavailable-summary]').textContent=unavailable.length?'保留当前选择；实际生成将跳过：'+unavailable.map(s=>`${s.title || s.id}（${s.reason}）`).join('；'):'';
    find('[data-unavailable-summary]').hidden=!unavailable.length;
    find('[data-version-summary]').textContent=diagnostics?.skills.filter(s=>s.reason || s.warning || s.tagId).map(s=>`${s.title || s.id}：${s.reason || s.label}${s.warning?'（版本冲突，见高级详情）':''}`).join('；') || '';
    find('[data-version-debug]').textContent=JSON.stringify({current:diagnostics,syncError:flow.syncError || '',planning:plan?.modelResolution,lastGeneration:plan?.lastGeneration},null,2);
    find('[data-action=request]').disabled=!plan?.id;
    for(const source of currentSkills.sort((a,b)=>(a.type==='reasoning'?0:1)-(b.type==='reasoning'?0:1))) {
        const snapshot=selectedIds.has(source.id)?plan?.entries?.find(e=>e[KEY]?.kind==='skill' && e[KEY].id===source.id):null;
        const skill=snapshot?{...source,body:snapshot.content,recommendation:snapshot[KEY].recommendation,versions:snapshot[KEY].versions}:source;
        const r=resolveVersion(skill,model.modelId,tags), unavailable=!r.version || skill.enabled===false || skill.fromSnapshot || !!flow.packReason(skill.packId);
        let group=categoryGroups.get(skill.category || '未分类');
        if(!group){
            group=document.createElement('details');group.className='spark-fold spark-category';group.dataset.choiceCategory=skill.category || '未分类';
            const summary=document.createElement('summary'),items=document.createElement('div');items.className='spark-category-items';group.append(summary,items);box.append(group);categoryGroups.set(group.dataset.choiceCategory,group);
            summary.addEventListener('click',()=>{if(!find('[data-choice-search]').value.trim()){if(group.open)choiceExpanded.delete(group.dataset.choiceCategory);else choiceExpanded.add(group.dataset.choiceCategory);}});
        }
        const row=document.createElement('div');row.className='spark-choice-row';row.dataset.choiceSearchText=[skill.title,r.version?.recommendation].join(' ').toLocaleLowerCase();
        const check=document.createElement('input');check.type='checkbox';check.dataset.id=skill.id;check.dataset.type=skill.type;check.dataset.unavailable=String(unavailable);
        check.checked=preserveDraft?draftIds.has(skill.id):selectedIds.has(skill.id);check.dataset.skillTitle=skill.title;check.setAttribute('aria-label','本轮选择：'+skill.title);
        const title=document.createElement('button');title.type='button';title.className='spark-button spark-title-button';title.textContent=skill.title;title.dataset.skillType=skill.type;
        const reason=skill.fromSnapshot?'条目已删除或不在当前绑定世界书中':flow.packReason(skill.packId) || (skill.enabled===false?'条目已设为不可选':r.reason);
        title.title=[skill.type==='reasoning'?(hasEcot(skill,r.version)?'Reasoning · 含 ECoT':'Reasoning Skill'):'火花',reason || r.label,r.warning].filter(Boolean).join(' · ');
        row.dataset.unavailable=String(unavailable);
        title.addEventListener('click',()=>void editDialog(context,{title:skill.title+(hasEcot(skill,r.version)?' · Reasoning · 含 ECoT':''),readOnly:true,label:'返回',notify,fields:{
            version:{label:'本轮适用版本',value:reason || r.label+(r.warning?' · '+r.warning:'')},
            recommendation:{label:'推荐开启',type:'textarea',value:r.version?.recommendation || ''},
            body:{label:'正文',type:'textarea',value:r.version?.body || ''},
            ...(hasEcot(skill,r.version)?{ecotText:{label:'ECoT 提问',type:'textarea',value:r.version.ecotText},ecotOutlet:{label:'Outlet 锚点',value:r.version.ecotOutlet || 'EcoT'}}:{}),
        }}));
        row.append(check,title);group.lastChild.append(row);
    }
    if(!currentSkills.length){const hint=document.createElement('p');hint.className='spark-hint';hint.textContent='暂无素材，请在创作库中录入。';box.append(hint);}
    filterChoices();
    renderSelected(); syncView(); await features.render(skills);
}

function renderSelected() {
    filterChoices();
    const selected = find('[data-selected]'); selected.replaceChildren();
    for (const check of panel.querySelectorAll('[data-id]:checked')) {
        const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'spark-button spark-chip';
        chip.textContent = check.dataset.skillTitle; chip.title = `${check.dataset.skillTitle} · 点击关闭本轮启用`;
        chip.setAttribute('aria-pressed', 'true');
        chip.addEventListener('click', () => { check.checked = false; check.dispatchEvent(new Event('change', { bubbles: true })); });
        selected.append(chip);
    }
    if (!selected.childElementCount) { const hint = document.createElement('p'); hint.className = 'spark-hint'; hint.textContent = '暂无已选条目'; selected.append(hint); }
}

function syncView() {
    const plan = flow.current();
    const state = getViewState({ enabled: settings().enabled, planning: !!flow.run || view.phase === 'planning', generating: view.phase === 'generating', error: view.error, plan, hasReply: !!context().chat.at(-1) && !context().chat.at(-1).is_user, dirty: view.dirty });
    panel.dataset.viewState = state.phase;
    find('[data-phase]').textContent = state.label;
    find('[data-status]').textContent=view.notice || (state.phase==='planning'?'正在规划…':state.phase==='generating'?'正在生成…':'');
    find('[data-status]').hidden=!find('[data-status]').textContent;
    for (const action of ['apply', 'resume', 'cancel']) find(`[data-action=${action}]`).hidden = !state[action];
    find('[data-more]').hidden = !state.more;
    find('[data-action=restore]').hidden = !plan;
    find('[data-action=replan]').hidden = !context().chat.some(m => m.is_user);
    const retry = find('[data-action=replan]');
    retry.textContent = state.phase === 'failed' ? '重试规划' : '重新规划';
    find('[data-discovery]').disabled = !plan || state.cancel;
    for (const input of panel.querySelectorAll('[data-id], .spark-chip')) input.disabled = !plan || state.cancel || input.dataset.unavailable==='true';
    find('[data-setting=enabled]').checked = settings().enabled;
    find('[data-setting=autoContinue]').checked = settings().autoContinue;
}
panel.addEventListener('input', event => {
    if (event.target.matches('[data-discovery]')) { view.dirty = true; syncView(); }
});
panel.addEventListener('change', event => {
    if (event.target.matches('[data-id]')) {
        const check=event.target, cap=check.dataset.type==='spark'?3:settings().reasoningLimit;
        if(check.checked && (check.dataset.unavailable==='true' || panel.querySelectorAll(`[data-id][data-type="${check.dataset.type}"]:checked`).length>cap)) {
            check.checked=false;notify(`本轮 ${check.dataset.type==='spark'?'火花':'Reasoning Skill'} 最多 ${cap} 项，且只能选择当前模型可用的条目`,true);
        }
        view.dirty = true; renderSelected(); syncView();
    }
});

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
        settings()[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
        if(key==='contextMode') find('[data-planner-preset-row]').hidden=input.value!=='standalone';
        if (key === 'enabled' && !input.checked) flow.cancel();
        context().saveSettingsDebounced();
        notify(settings().enabled ? '已启用' : '已关闭：插件内容退出生成扫描');
    });
}
find('[data-world]').addEventListener('change', async event => {
    flow.cancel(); settings().world = event.target.value; context().saveSettingsDebounced();
    try { if (settings().world) await world.ensureDiscovery(); await renderPlan(); } catch (e) { notify(e.message, true); }
});
find('[data-planner-preset-row]').hidden=settings().contextMode!=='standalone';

panel.addEventListener('click', async event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) { switchTab(tab.dataset.tab); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    try {
        if(action==='raw'){const debug=find('[data-current-debug]');debug.hidden=!debug.hidden;debug.open=!debug.hidden;return;}
        if(action==='request'){const record=flow.store().history.find(r=>r.id===flow.current()?.id);await showRequest(context,record || {},notify);return;}
        if (action === 'cancel') {
            if (flow.run) flow.cancel(); else context().stopGeneration();
            return;
        }
        if (flow.run) throw new Error('请等待 Planner 完成，或点击取消。');
        if (['only', 'replan', 'resume'].includes(action) && document.body.dataset.generating) throw new Error('酒馆正在生成，请等待完成。');
        if (action === 'refresh') { await context().updateWorldInfoList(); refreshBooks(); }
        if (action === 'create') { await world.create(find('[data-book-name]').value.trim()); refreshBooks(); }
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
            if (!context().chat.at(-1)?.is_user || findInput().value.trim()) throw new Error('继续生成只用于已提交玩家输入的待生成轮。已有回复请使用原生 Swipe。');
            await context().generate('regenerate');
        }
        if (action === 'apply' || action === 'restore') {
            const plan = structuredClone(flow.current());
            if (!plan) throw new Error('当前轮没有可编辑规划。');
            if (action === 'restore') Object.assign(plan, structuredClone(plan.original));
            else {
                plan.discovery = find('[data-discovery]').value;
                plan.selected = { reasoning: [], spark: [] };
                for (const check of panel.querySelectorAll('[data-id]:checked')) plan.selected[check.dataset.type].push(check.dataset.id);
            }
            view.dirty=false;
            await flow.apply(plan);
        }
        await renderPlan();
    } catch (error) { if(['apply','restore'].includes(action)) view.dirty=true;flow.only = false; notify(error.message, true); }
});
function findInput() { return document.querySelector('#send_textarea'); }
function switchTab(name) {
    if(name==='settings') void renderDiscoverySettings().catch(e=>notify(e.message,true));
    for (const tab of panel.querySelectorAll('[data-tab]')) {
        const active = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    }
    for (const page of panel.querySelectorAll('[data-page]')) page.hidden = page.dataset.page !== name;
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
c.eventSource.on(events.GENERATION_STARTED, (type, _options, dryRun) => {
    if (!flow.run) { flow.active = null; recovery.start(type, dryRun); }
    if (!dryRun && !['quiet', 'impersonate'].includes(type)) {
        view.execution++; view.phase = ['swipe', 'regenerate', 'continue'].includes(type) ? 'generating' : 'planning';
        view.active = true;
        view.received = false; view.error = false; view.notice = ''; syncView();
    }
});
c.eventSource.on(events.GENERATE_AFTER_DATA, (_data, dryRun) => {
    if (!dryRun && !flow.run && view.active) { view.phase = 'generating'; view.notice = ''; syncView(); }
});
c.eventSource.on(events.GENERATION_ENDED, () => {
    if (flow.run) return;
    const failedStream = context().streamingProcessor?.isStopped === true;
    setTimeout(() => { void recovery.finish(failedStream).catch(e => notify(e.message, true)); }, 0);
    const execution = view.execution;
    setTimeout(() => {
        if (execution !== view.execution) return;
        if (view.phase === 'generating' && (!view.received || failedStream)) {
            view.error = true; view.notice = '正文生成未完成，可查看详情或重新尝试。';
        }
        view.phase = null; view.active = false; syncView();
    }, 0);
});
c.eventSource.on(events.GENERATION_STOPPED, () => { if (flow.run) {flow.run.cancelled = true;flow.run.controller?.abort();} flow.active = null; syncView(); });
c.eventSource.on(events.CHAT_CHANGED, () => {
    recovery.backup = null; flow.cancel(); flow.only = false;
    flow.lastRequest = null;
    view.execution++; view.phase = null; view.active = false; view.error = false; view.notice = ''; view.dirty = false;
    flow.recoverInterrupted();
    void renderPlan().catch(e => notify(e.message, true));
});
c.eventSource.on(events.MESSAGE_RECEIVED, () => { view.received = true; recovery.received(); void renderPlan().catch(e => notify(e.message, true)); });
find('[data-preset-preview]').textContent=settings().plannerPreset;
find('[data-edit-preset]').addEventListener('click',()=>void editDialog(context,{title:'独立 Planner 基础预设',fields:{text:{label:'基础预设',type:'textarea',value:settings().plannerPreset}},notify,submit:v=>{settings().plannerPreset=v.text;context().saveSettingsDebounced();find('[data-preset-preview]').textContent=v.text;notify('基础预设已保存');}}));
for(const name of ['CHATCOMPLETION_MODEL_CHANGED','CHATCOMPLETION_SOURCE_CHANGED','MAIN_API_CHANGED','SETTINGS_UPDATED'])if(events[name])c.eventSource.on(events[name],()=>{if(!flow.run)void renderPlan().catch(e=>notify(e.message,true));});
renderPrompts(); refreshBooks();
void renderPlan().catch(e => notify(e.message, true));
