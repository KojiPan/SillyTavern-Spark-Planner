import { generationModel, resolveSkills, resolveVersion } from './model-versions.js';
import { KEY, DEFAULT_PROMPTS, currentTurn, freezeCatalog, parsePlanner, plannerSections, overlayLore, analysisOutputProtocol, extractGuidance } from './core.js';
import { independentPlanner, inheritedPlanner } from './channels.js';
import { hasEcot, ecotEntry, versionValue } from './ecot.js';
import { packReason } from './packs.js';
import { legacyAnalysisModules, orderedAnalysisModules, resolveAnalysisModules } from './analysis-modules.js';
import { assembleInjection, snapshotEntries } from './injection.js';
import { evidenceEvent, sanitizedRequest, retainRequestBodies, guidanceCount } from './run-evidence.js';

export class Workflow {
    constructor(context, settings, world, notify = () => {}) {
        Object.assign(this, { context, settings, world, notify });
        this.run = null;
        this.active = null;
        this.only = false;
        this.syncError = '';
    }
    chatKey() {
        const c = this.context();
        return JSON.stringify([c.groupId || null, c.groupId ? null : c.characterId ?? null, c.chatId]);
    }
    store() {
        const c = this.context();
        return c.chatMetadata[KEY] ??= { plans: {}, history: [] };
    }
    async loadPackState() {
        this.packState=this.settings().world && this.world.packState ? await this.world.packState() : null;
        return this.packState;
    }
    packReason(id) { return packReason(id,this.packState,this.store()); }
    async analysisModules() {
        const modules=this.world.analysisModules?await this.world.analysisModules():legacyAnalysisModules(this.settings(),this.packState?.packs[0]?.id || 'default');
        await this.loadPackState();
        return orderedAnalysisModules(modules,this.store().analysisModuleOrder);
    }
    async candidateSkills() {
        const skills=await this.world.skills();
        await this.loadPackState();
        return skills.filter(s=>!this.packReason(s.packId) && s.enabled!==false);
    }
    historyLimit() { return Math.max(1,Math.min(500,Number(this.settings().historyLimit) || 50)); }
    trimHistory() {
        const removed=this.store().history.splice(this.historyLimit()), current=currentTurn(this.context().chat)?.extra?.[KEY];
        for(const record of removed)if(record.turn!==current && record.turn!==this.store().draft?.turn && !this.store().history.some(r=>r.turn===record.turn))delete this.store().plans[record.turn];
    }
    policies() {
        const p=this.store().selectionPolicy;
        return p?.chat===this.chatKey() && p.world===this.settings().world?p.items:{};
    }
    setPolicy(id,value) {
        const items={...this.policies()};
        if(value==='auto')delete items[id];else if(['required','excluded'].includes(value))items[id]=value;
        this.store().selectionPolicy={chat:this.chatKey(),world:this.settings().world,items,revision:crypto.randomUUID()};
        this.context().saveMetadataDebounced();
    }
    clearPolicies() { delete this.store().selectionPolicy;this.context().saveMetadataDebounced(); }
    async plannerMaterial(model,tags) {
        const available=resolveSkills(await this.candidateSkills(),model.modelId,tags), policy=structuredClone(this.policies());
        const required=available.filter(s=>policy[s.id]==='required');
        const missing=Object.entries(policy).filter(([id,value])=>value==='required' && !required.some(s=>s.id===id));
        if(missing.length)throw new Error('本轮必选条目不可用，请检查所属包、可选开关或模型版本：'+missing.map(([id])=>id).join('、'));
        return {catalog:freezeCatalog(available.filter(s=>!policy[s.id])),required,policy,policyRevision:this.store().selectionPolicy?.revision};
    }
    requiredNote(required) {
        return required.length?'本轮玩家已确定使用以下素材（不占自主选材上限，无需在选择标记中重复填写）；请结合它们规划，并从可选目录补充其他素材：\n'+required.map(s=>`${s.type==='reasoning'?'Reasoning Skill':'火花'}：${s.title} — ${s.recommendation || '玩家本轮必选'}`).join('\n'):'';
    }
    async plannerPreview() {
        const model=await generationModel(this.context),tags=this.settings().modelTags || [];
        const material=await this.plannerMaterial(model,tags);
        const {effective:modules}=resolveAnalysisModules(await this.analysisModules(),model.modelId,tags,this.packState,this.store());
        const sections=plannerSections(material.catalog,this.settings().prompts,this.settings().reasoningLimit,modules);
        return {catalog:[sections[1].content,this.requiredNote(material.required)].filter(Boolean).join('\n\n'),
            modules:[sections[2].content,sections[4].content].filter(Boolean).join('\n\n'),
            required:material.required.length,autonomous:[...material.catalog.reasoning,...material.catalog.spark].length};
    }
    setEnabledPacks(ids) {
        if(ids===null)delete this.store().enabledPackIds;
        else this.store().enabledPackIds=[...new Set(ids)];
        this.context().saveMetadataDebounced();
    }
    effectiveEntries(entries, latest) {
        return entries.map(e=>{
            if(e[KEY]?.kind!=='skill')return e;
            const current=latest.find(x=>x[KEY]?.kind==='skill' && x[KEY].id===e[KEY].id);
            const missing=!current;
            return {...structuredClone(current || e),[KEY]:{...(current || e)[KEY],packId:current?.[KEY].packId || e[KEY].packId,
                enabled:current?current[KEY].enabled:false,
                unavailable:missing?'条目已删除或不在当前绑定世界书中':this.packReason(current[KEY].packId)}};
        });
    }
    turn() {
        const user = currentTurn(this.context().chat);
        if (!user) throw new Error('当前没有玩家消息。请先发送输入，或填写输入后使用“仅规划”。');
        user.extra ??= {};
        user.extra[KEY] ??= crypto.randomUUID();
        return user.extra[KEY];
    }
    current() {
        const user = currentTurn(this.context().chat);
        const draft=this.store().draft;
        if(draft && draft.chat===this.chatKey() && draft.world===this.settings().world && !draft.cancelled && (draft.next || (draft.standalone && !user) || (draft.turn===user?.extra?.[KEY] && draft.input===user?.mes)))return this.normalizeGuidance(draft);
        const plan = user?.extra?.[KEY] ? this.store().plans[user.extra[KEY]] : null;
        return plan && plan.input === user?.mes && (!plan.world || plan.world===this.settings().world) && !plan.cancelled ? this.normalizeGuidance(plan) : null;
    }
    normalizeGuidance(plan) {
        // Upgrade only untouched old AI drafts. Explicitly edited guidance and
        // historical reuse are user-confirmed content, never guessed from raw.
        if(plan.source==='ai' && !plan.guidanceProtocol && !plan.guidanceEdited && !plan.reuseMode && !plan.frozenInjection && !plan.revision && typeof plan.raw==='string') {
            plan.discovery=extractGuidance(plan.raw);plan.guidanceProtocol=1;plan.guidanceMissing=!plan.discovery;
            this.context().saveMetadataDebounced();
        }
        return plan;
    }
    mode() { return this.settings().runMode || (this.settings().autoContinue===false?'review':'auto'); }
    fingerprint() {
        const c=this.context(),character=c.characters?.[c.characterId],card=character?.data || character;
        return JSON.stringify([c.chat.map(m=>[m.is_user,m.is_system,m.mes,m.swipe_id,m.extra?.[KEY]]),
            card && [card.description,card.personality,card.scenario,card.first_mes,card.mes_example,card.system_prompt,card.post_history_instructions,card.extensions?.depth_prompt],c.powerUserSettings?.persona_description]);
    }
    ensureDraft() {
        let plan=this.current();
        if(!plan)plan={id:crypto.randomUUID(),chat:this.chatKey(),world:this.settings().world,turn:null,input:null,next:true,selected:{reasoning:[],spark:[]},discovery:'',raw:'',warnings:[],source:'manual',revision:0,applied:false};
        if(this.store().draft!==plan)this.store().draft=structuredClone(plan);
        return this.store().draft;
    }
    editDraft(values) {
        const draft=this.ensureDraft();
        Object.assign(draft,structuredClone(values),{revision:(draft.revision || 0)+1,applied:false,consumed:false,generationFailed:false});
        if(Object.hasOwn(values,'discovery'))draft.guidanceEdited=true;
        if(this.mode()==='manual' && !this.pending){draft.next=true;draft.source='manual';}
        this.context().saveMetadataDebounced();
        return draft;
    }
    clearDraft() { return this.editDraft({selected:{reasoning:[],spark:[]},discovery:'',source:'manual',next:!this.pending}); }
    cancel({stop=true}={}) {
        this.epoch=(this.epoch || 0)+1;
        this.only=false;this.confirmNext=false;this.forceReplan=false;
        const record=this.store().history.find(r=>r.id===this.active?.generationRecordId);
        if(record?.generation){record.status='cancelled';record.generation.status='cancelled';evidenceEvent(record,'cancelled');evidenceEvent(record,'execution-released');this.context().saveMetadataDebounced();}
        this.preparedTransport=null;
        this.active = null;
        this.syncError = '';
        const pending=this.pending;this.pending=null;
        if(pending?.store.draft) {
            pending.store.draft.cancelled=true;
            const record=pending.store.history.find(r=>r.id===pending.store.draft.id);
            if(record?.status==='review')record.status='cancelled';
        }
        pending?.resolve(false);
        const plan=this.current();if(plan){plan.cancelled=true;const stored=this.store().plans[plan.turn];if(stored)stored.cancelled=true;this.context().saveMetadataDebounced();}
        if (this.run) {
            this.run.cancelled = true;
            this.run.controller?.abort();
        }
        if(stop)this.context().stopGeneration();
    }
    stopped() {
        if(this.run?.timedOut){this.active=null;return;} // A timeout is a failure, preserve the editable draft.
        this.cancel({stop:false});
    }
    async apply(plan=this.ensureDraft(), { snapshot = false } = {}) {
        const key = this.chatKey();
        const worldName = this.settings().world;
        const epoch=this.epoch || 0;
        if(plan.source==='ai' && plan.policyRevision && this.store().selectionPolicy?.revision===plan.policyRevision && !plan.frozenInjection) {
            for(const type of ['reasoning','spark']) {
                plan.selected[type]=plan.selected[type].filter(id=>plan.selectionPolicy?.[id]!=='excluded');
                for(const id of plan.requiredIds || [])if(plan.modelResolution?.skills?.some(s=>s.skillId===id && s.type===type))if(!plan.selected[type].includes(id))plan.selected[type].push(id);
            }
        }
        if(plan.frozenInjection) {
            const missing=[...plan.selected.reasoning,...plan.selected.spark].filter(id=>!plan.frozenInjection.items.some(i=>i.kind==='skill' && i.id===id));
            if(missing.length)throw new Error('历史快照不包含新增选择，请改用“使用最新素材”：'+missing.join('、'));
        }
        if(this.settings().enabled===false)throw new Error('请先开启规划器。');
        if(plan.chat && (plan.chat!==key || plan.world!==worldName))throw new Error('聊天或创作包已切换，规划未应用。');
        const revision=plan.revision || 0;
        if(!plan.frozenInjection)await this.syncEcot();
        if (key !== this.chatKey() || worldName !== this.settings().world || epoch!==(this.epoch || 0)) throw new Error('运行已取消、聊天或创作包已切换，规划未应用。');
        if(!plan.frozenInjection)try {await this.world.ensureDiscovery(plan.discovery,worldName);} catch(error){this.syncError=error.message;throw error;}
        if (key !== this.chatKey() || worldName !== this.settings().world || epoch!==(this.epoch || 0)) throw new Error('运行已取消、聊天或创作包已切换，规划未应用。');
        const copy = structuredClone(plan);
        copy.entries = (snapshot || plan.frozenInjection) && Array.isArray(plan.entries) ? structuredClone(plan.entries) : await this.world.entries();
        if (key !== this.chatKey() || worldName !== this.settings().world || epoch!==(this.epoch || 0)) throw new Error('运行已取消、聊天或创作包已切换，规划未应用。');
        if(!plan.frozenInjection)await this.loadPackState();
        const model=await generationModel(this.context);
        if (key !== this.chatKey() || worldName !== this.settings().world || epoch!==(this.epoch || 0)) throw new Error('运行已取消、聊天或创作包已切换，规划未应用。');
        const resolved=plan.frozenInjection?{resolution:{skills:[]}}:this.resolveEntries({...copy,entries:this.effectiveEntries(copy.entries,copy.entries)},model,this.settings().modelTags || [],copy.entries);
        const unavailable=resolved.resolution.skills.filter(s=>s.reason);
        if(unavailable.length && !snapshot && !plan.frozenInjection) {
            const ids=new Set(unavailable.map(s=>s.id));
            const draft=this.ensureDraft();
            draft.selected={reasoning:draft.selected.reasoning.filter(id=>!ids.has(id)),spark:draft.selected.spark.filter(id=>!ids.has(id))};
            draft.revision=(draft.revision || 0)+1;draft.applied=false;
            this.context().saveMetadataDebounced();
            throw new Error('已移除不可用条目，请确认方案后再次应用：'+unavailable.map(s=>s.title || s.id).join('、'));
        }
        const chosen=new Set([...plan.selected.reasoning,...plan.selected.spark]);
        copy.entries=copy.entries.filter(entry=>!entry[KEY] || entry[KEY].kind==='discovery' || chosen.has(entry[KEY].kind==='ecot'?entry[KEY].skillId:entry[KEY].id));
        if (key !== this.chatKey() || worldName !== this.settings().world || epoch!==(this.epoch || 0)) throw new Error('运行已取消、聊天或创作包已切换，规划未应用。');
        if((plan.revision || 0)!==revision)throw new Error('方案在应用期间发生修改，请再次应用。');
        Object.assign(copy,{chat:key,world:worldName,applied:true,cancelled:false});
        if(copy.turn)this.store().plans[plan.turn] = structuredClone(copy);
        this.store().draft=copy;
        const record = this.store().history.find(r => r.id === plan.id);
        if (record) {record.applied = structuredClone(copy);if(record.status==='review')record.status='applied';}
        await this.context().saveChat();
        this.context().saveMetadataDebounced();
        this.notify('规划已应用');
        return copy;
    }
    async plan({apply=this.mode()!=='review'}={}) {
        if(this.mode()==='manual')throw new Error('手动编排模式不调用 Planner，请直接应用本轮方案。');
        if (this.run) throw new Error('Planner 正在执行。');
        const c = this.context();
        const run = { id: crypto.randomUUID(), chat: this.chatKey(), world: this.settings().world, turn: this.turn(), cancelled: false, controller:new AbortController() };
        this.run = run;
        this.active = null;
        this.lastRequest = null;
        const fingerprint=this.fingerprint();
        // Preserve the editable draft on failure; an old applied plan is not silently reused.
        if(this.store().draft?.source==='ai' && !this.store().draft.revision && !this.pending)delete this.store().draft;
        const draftVersion=JSON.stringify([this.store().draft?.id,this.store().draft?.revision]);
        delete this.store().plans[run.turn];
        const record = { id: run.id, turn: run.turn, chat: run.chat, time: new Date().toISOString(), status: 'running', raw: '', error: null };
        evidenceEvent(record,'planner-started');
        this.store().history.unshift(record);
        this.trimHistory();
        c.saveMetadataDebounced();
        let timeout;
        try {
            this.notify('Planner 执行中…');
            const model = await generationModel(this.context), tags = structuredClone(this.settings().modelTags || []);
            const material=await this.plannerMaterial(model,tags), catalog=material.catalog;
            const {effective:modules,snapshots:moduleStates}=resolveAnalysisModules(await this.analysisModules(),model.modelId,tags,this.packState,this.store());
            const modelResolution={...model,tags:structuredClone(tags),skills:[...catalog.reasoning,...catalog.spark,...material.required].map(s=>({skillId:s.id,type:s.type,...s.resolvedVersion})),modules:moduleStates};
            record.modelResolution=structuredClone(modelResolution);
            if (run.cancelled || run.chat !== this.chatKey()) throw new Error('规划已取消或聊天已切换。');
            const sections=plannerSections(catalog, this.settings().prompts, this.settings().reasoningLimit, modules);
            sections[1].content=[sections[1].content,this.requiredNote(material.required)].filter(Boolean).join('\n\n');
            sections[1].source=`目录前后文本与世界书「${run.world}」的本轮冻结候选目录`;
            sections[2].sources=[{source:'全局分析模块调度说明',enabled:!!modules.length,order:0,content:this.settings().prompts.analysisDispatch ?? DEFAULT_PROMPTS.analysisDispatch},...moduleStates.map(m=>({...m,source:`${m.packName} · ${m.name} · ${m.label}`,content:m.assembled?m.version?.analysis || '':''}))];
            sections[4].sources=[{source:'Reasoning Skill / 火花选择格式',enabled:true,order:1,content:this.settings().prompts.selectionFormat ?? DEFAULT_PROMPTS.selectionFormat},
                {source:'分析模块输出总起',enabled:!!modules.length,order:2,content:this.settings().prompts.analysisFormatIntro ?? DEFAULT_PROMPTS.analysisFormatIntro},...moduleStates.map(m=>({...m,source:`${m.packName} · ${m.name} · ${m.label}`,order:m.order+2,content:m.assembled?analysisOutputProtocol({...m,...m.version}):''}))];
            const prompt=sections.map(s=>s.content).filter(Boolean).join('\n\n');
            // Freeze request options as well as the numbered catalog. Live edits belong
            // to the next request; parsing must use this request's original limits.
            run.catalog=catalog;
            run.policy=material.policy;run.policyRevision=material.policyRevision;
            run.reasoningLimit=this.settings().reasoningLimit;
            const requestSettings=structuredClone(this.settings());
            const requestContext=structuredClone({generationModelId:model.modelId,sections,catalog:{reasoning:catalog.reasoning.map(s=>({number:s.number,id:s.id,title:s.title,recommendation:s.recommendation,version:s.resolvedVersion})),spark:catalog.spark.map(s=>({number:s.number,id:s.id,title:s.title,recommendation:s.recommendation,version:s.resolvedVersion}))},modules:moduleStates,diagnostics:{model:model.diagnostic,versions:modelResolution.skills.filter(s=>s.warning)}});
            const channel=requestSettings.channels?.find(x=>x.id===requestSettings.channelId);
            timeout = setTimeout(() => { run.timedOut=true;run.cancelled = true; run.controller.abort(); c.stopGeneration(); }, (channel?.timeout || this.settings().timeout) * 1000);
            if(this.settings().channelId && !channel) throw new Error('选定渠道已不存在，请改为继承或重新选择');
            const inspect = (snapshot,data) => {
                record.request=structuredClone({...snapshot,...requestContext,id:run.id});
                record.request.channelName=channel?.name || '继承酒馆主模型';
                if(data)this.prepareTransport('planner',data,record);
                this.lastRequest=structuredClone(record.request);
                if(run.chat===this.chatKey())c.saveMetadataDebounced();
            };
            const raw = channel ? await independentPlanner(this.context,channel,requestSettings,prompt,run.controller.signal,inspect) : await inheritedPlanner(this.context,requestSettings,prompt,run.controller.signal,inspect);
            record.raw = typeof raw === 'string' ? raw : '';
            evidenceEvent(record,'planner-returned');
            if (run.cancelled || run.chat !== this.chatKey() || run.world !== this.settings().world || !this.settings().enabled || fingerprint!==this.fingerprint()) throw new Error('规划已取消、超时、输入已修改或聊天已切换。');
            const parsed = parsePlanner(raw, catalog, run.reasoningLimit, modules);
            const original=structuredClone(parsed);
            for(const skill of material.required)if(!parsed.selected[skill.type].includes(skill.id))parsed.selected[skill.type].push(skill.id);
            if(draftVersion!==JSON.stringify([this.store().draft?.id,this.store().draft?.revision]))throw new Error('规划期间草稿已修改，已保留人工修改，请重新规划或应用草稿。');
            record.requestDiagnostics={warnings:structuredClone(parsed.warnings)};
            evidenceEvent(record,'parsed',{guidanceCount:guidanceCount(record.raw),warnings:parsed.warnings.length});
            const plan = { id: run.id, turn: run.turn, chat:run.chat,world:run.world,source:'ai',revision:0,applied:false,input: currentTurn(c.chat)?.mes, raw, plannerModel:record.request?.plannerModelId || null,modelResolution, ...parsed, original, selectionPolicy:material.policy,policyRevision:material.policyRevision,requiredIds:material.required.map(s=>s.id) };
            record.parsed = original; record.plan=structuredClone(plan);
            this.store().draft=structuredClone(plan);
            const applied = apply ? await this.apply(plan) : plan;
            if (run.cancelled || run.chat !== this.chatKey() || !this.settings().enabled) throw new Error('规划已取消或聊天已切换。');
            record.status = apply?'applied':'review';
            evidenceEvent(record,apply?'plan-applied':'awaiting-review');
            if(parsed.warnings.length) this.notify(`规划完成 · 解析警告：${parsed.warnings.join('；')}`);
            if(!apply)this.notify('等待审核');
            return applied;
        } catch (error) {
            record.status = run.cancelled && !run.timedOut ? 'cancelled' : 'failed';
            record.error = error.message;
            evidenceEvent(record,record.status==='cancelled'?'cancelled':'planner-failed');
            record.requestDiagnostics={...record.requestDiagnostics,error:error.message};
            if(run.chat===this.chatKey()) this.notify(`Planner 失败：${error.message}`, true);
            throw error;
        } finally {
            clearTimeout(timeout);
            if(this.run===run)this.run = null;
            if(this.preparedTransport?.kind==='planner')this.preparedTransport=null;
            if (run.chat === this.chatKey()) c.saveMetadataDebounced();
        }
    }
    async resume() {
        const pending=this.pending;
        if(!pending)throw new Error('原始生成操作已失效，请通过酒馆重新生成。');
        if(pending.chat!==this.chatKey() || pending.world!==this.settings().world || pending.fingerprint!==this.fingerprint()) {
            this.cancel();throw new Error('聊天、输入或生成目标已变化，已取消旧操作，请重新生成。');
        }
        const applied=await this.apply(this.ensureDraft());
        if(this.pending!==pending || pending.fingerprint!==this.fingerprint()){this.cancel();throw new Error('生成目标已变化，请重新生成。');}
        applied.awaitingReview=false;
        if(this.store().plans[applied.turn])this.store().plans[applied.turn].awaitingReview=false;
        this.context().saveMetadataDebounced();
        this.pending=null;pending.resolve(applied);
    }
    async waitForReview(type) {
        const draft=this.ensureDraft();draft.awaitingReview=true;draft.generationType=type;
        this.context().saveMetadataDebounced();
        return new Promise(resolve=>{
            this.pending={chat:this.chatKey(),world:this.settings().world,fingerprint:this.fingerprint(),type,store:this.store(),resolve};
            this.notify('等待审核');
        });
    }
    captureGeneration(data={}) {
        const active=this.active;
        if(!active || this.run || active.chat!==this.chatKey() || active.world!==this.settings().world || active.generationRecordId)return;
        let record=this.store().history.find(r=>r.id===active.id && !r.generation);
        if(!record) {
            record={id:crypto.randomUUID(),sourceId:active.sourceId || active.id,planId:active.id,turn:active.turn,chat:active.chat,time:new Date().toISOString(),raw:active.raw || '',
                parsed:structuredClone(active.original),plan:{id:active.id,source:active.source,selected:structuredClone(active.selected),discovery:active.discovery}};
            this.store().history.unshift(record);this.trimHistory();
        }
        const snapshot=structuredClone(active.injection || assembleInjection(active,this.packState));
        record.generation={...snapshot,time:new Date().toISOString(),status:'requested',source:active.source || 'ai',
            chat:active.chat,turn:active.turn,type:active.generationType,revision:active.revision || 0,
            targetIndex:this.context().chat.length,plannerModel:active.plannerModel || record.request?.plannerModelId || this.store().history.find(r=>r.id===active.id)?.request?.plannerModelId || null};
        if(typeof data.model==='string')record.generation.model.modelId=data.model;
        record.status='requested';active.generationRecordId=record.id;
        record.generation.actualInjection={state:'unavailable',reason:'no-final-source-map'};
        if(active.activatedMaterials)record.generation.activatedMaterials=structuredClone(active.activatedMaterials);
        evidenceEvent(record,'generation-prepared');
        this.context().saveMetadataDebounced();
    }
    prepareTransport(kind,data,record){
        record ||= this.store().history.find(r=>r.id===this.active?.generationRecordId);
        if(!record)return;
        this.preparedTransport={kind,data,record,chat:this.chatKey()};
    }
    observeTransport(serialized){
        const prepared=this.preparedTransport;
        // Identity is established by an exact serialization of the native request
        // object observed at its hook, never by matching prompt substrings.
        if(!prepared || prepared.chat!==this.chatKey() || JSON.stringify(prepared.data)!==serialized)return null;
        const {record,kind}=prepared,request=sanitizedRequest(JSON.parse(serialized),kind);
        const evidence=evidenceEvent(record,`${kind}-request`,{requestId:request.id});
        evidence.calls[kind]++;evidence.requests[kind]=request;
        retainRequestBodies(this.store().history);this.context().saveMetadataDebounced();
        return {record,kind,id:request.id,chat:prepared.chat};
    }
    observeTransportResult(receipt,status){
        evidenceEvent(receipt.record,`${receipt.kind}-transport`,{requestId:receipt.id,httpStatus:status});
        if(receipt.chat===this.chatKey())this.context().saveMetadataDebounced();
    }
    observeActivated(entries){
        if(this.run || !this.active || this.active.chat!==this.chatKey())return;
        this.active.activatedMaterials=(entries || []).filter(e=>e[KEY]?.owner===KEY).map(e=>({id:e[KEY].id,kind:e[KEY].kind}));
    }
    finishGeneration(success) {
        const active=this.active;this.active=null;
        if(!active || active.chat!==this.chatKey())return;
        const record=this.store().history.find(r=>r.id===active.generationRecordId);
        if(record?.generation) {
            record.generation.status=success?'succeeded':'failed';record.status=record.generation.status;
            record.generation.reply=success?this.context().chat.flatMap((m,index)=>!m.is_user && !m.is_system?[{index,swipeId:m.swipe_id ?? null}]:[]).at(-1) || null:null;
            evidenceEvent(record,success?'generation-completed':'generation-failed');
            evidenceEvent(record,'execution-released');
        }
        if(this.preparedTransport?.kind==='generation')this.preparedTransport=null;
        if(success && this.store().selectionPolicy?.revision===active.policyRevision)this.clearPolicies();
        const plan=this.current();
        if(plan?.id===active.id && (plan.revision || 0)===(active.revision || 0)){plan.consumed=!!success;plan.generationFailed=!success;}
        const stored=this.store().plans[active.turn];
        if(stored?.id===active.id){stored.consumed=!!success;stored.generationFailed=!success;}
        this.context().saveMetadataDebounced();
    }
    async intercept(_chat, _size, abort, type) {
        if (this.run && type === 'quiet') return;
        if (this.run || this.pending) {
            if(this.pending && this.pending.fingerprint!==this.fingerprint()) {
                this.cancel({stop:false});this.notify('输入或生成目标已变化，已取消旧审核，请重新生成。',true);
            } else this.notify('已有规划运行或待审核方案，请先继续或取消。',true);
            abort(true);return;
        }
        this.active=null;
        if (!this.settings().enabled || ['quiet', 'impersonate'].includes(type)) return;
        const epoch=this.epoch || 0, chat=this.chatKey();
        try {
            let plan=this.current();
            const mode=this.mode(),only=this.only,forceReplan=this.forceReplan;this.only=false;this.forceReplan=false;
            const replay=['swipe','regenerate','continue'].includes(type);
            if(plan?.next && plan.applied) {
                const user=currentTurn(this.context().chat);
                plan={...structuredClone(plan),next:false,standalone:!user,turn:user?this.turn():crypto.randomUUID(),input:user?.mes ?? null};
                this.store().draft=plan;this.store().plans[plan.turn]=structuredClone(plan);
            }
            if(mode==='manual') {
                if(plan?.applied===false)throw new Error('本轮方案有未应用修改，请先应用本轮方案。');
                if(plan?.consumed && !replay)plan=null;
                if(plan?.next) {
                    const user=currentTurn(this.context().chat);
                    plan={...structuredClone(plan),next:false,standalone:!user,turn:user?this.turn():crypto.randomUUID(),input:user?.mes ?? null};
                    this.store().draft=plan;this.store().plans[plan.turn]=structuredClone(plan);
                }
                if(!plan)return;
            } else {
                if(!plan || (plan.consumed && !replay)) {
                    if(!replay || mode==='review' || forceReplan)plan=await this.plan({apply:mode==='auto'});
                }
                if(only){abort(true);return;}
                if(mode==='review' && plan && this.confirmNext) {
                    if(!plan.applied)plan=await this.apply(plan);
                } else if(mode==='review' && plan && (!plan.consumed || !plan.applied)) {
                    plan=await this.waitForReview(type);
                    if(!plan){abort(true);return;}
                } else if(plan && plan.applied===false)throw new Error('本轮方案有未应用修改，请先应用或确认。');
            }
            this.confirmNext=false;
            if(plan)plan.generationType=type;
            const active=await this.activation(plan);
            if(epoch!==(this.epoch || 0) || chat!==this.chatKey()){abort(true);return;}
            this.active=active;
            if(plan && !this.active){abort(true);return;}
            this.context().deactivateSendButtons?.();
        } catch(error) {
            if(epoch===(this.epoch || 0) && chat===this.chatKey()) {
                this.only=false;this.confirmNext=false;this.active=null;
                this.notify(error.message,true);
            }
            abort(true);
        }
    }
    async activation(plan) {
        if(!plan) return null;
        const epoch=this.epoch || 0, revision=plan.revision || 0;
        const chat=this.chatKey();
        const worldName=this.settings().world;
        if(plan.frozenInjection) {
            const result=structuredClone({...plan,chat,world:worldName,entries:snapshotEntries(plan.frozenInjection),generationResolution:plan.frozenInjection.model});
            result.generationResolution={...result.generationResolution,...await generationModel(this.context)};
            if(chat!==this.chatKey() || worldName!==this.settings().world || !this.settings().enabled || this.current()?.id!==plan.id || this.current()?.applied===false || epoch!==(this.epoch || 0) || revision!==(this.current()?.revision || 0))return null;
            result.injection=assembleInjection(result,this.packState);
            for(const item of result.injection.items){const old=plan.frozenInjection.items.find(i=>i.id===item.id && i.kind===item.kind);if(old){item.packName=old.packName;item.versionId=old.versionId;item.versionLabel=old.versionLabel;}}
            this.lastActivation=result;return result;
        }
        // Selection IDs stay per-turn; each new Generation resolves the latest material.
        await this.syncEcot();
        const latest=await this.world.entries();
        await this.loadPackState();
        this.liveEntries=latest;
        const discovery=latest.filter(e=>e[KEY]?.kind==='discovery');
        if(chat!==this.chatKey() || worldName!==this.settings().world || !this.settings().enabled || this.current()?.id!==plan.id) return null;
        const model=await generationModel(this.context), tags=this.settings().modelTags || [];
        if(chat!==this.chatKey() || worldName!==this.settings().world || !this.settings().enabled || this.current()?.id!==plan.id)return null;
        const effective={...plan,entries:this.effectiveEntries(plan.entries || [],latest)};
        const resolved=this.resolveEntries(effective,model,tags,latest);
        const unavailable=resolved.resolution.skills.filter(s=>s.reason);
        if(unavailable.some(s=>plan.requiredIds?.includes(s.id)))throw new Error('本轮必选条目已不可用，请调整策略或修复素材后重新规划：'+unavailable.filter(s=>plan.requiredIds.includes(s.id)).map(s=>s.title || s.id).join('、'));
        if(unavailable.length && (this.mode()==='review' || plan.source==='manual')) {
            const ids=new Set(unavailable.map(s=>s.id)),draft=this.ensureDraft();
            draft.selected={reasoning:draft.selected.reasoning.filter(id=>!ids.has(id)),spark:draft.selected.spark.filter(id=>!ids.has(id))};
            draft.applied=false;draft.revision=(draft.revision || 0)+1;
            this.context().saveMetadataDebounced();
            this.notify('已移除不可用条目，请重新确认并应用：'+unavailable.map(s=>s.title || s.id).join('、'),true);return null;
        }
        if(unavailable.length)this.notify('以下条目当前不可用，已跳过：'+unavailable.map(s=>`${s.title || s.id}（${s.reason}）`).join('、'));
        if(resolved.resolution.skills.some(s=>s.syncError)) {
            plan.lastGeneration=structuredClone(resolved.resolution);
            this.context().saveMetadataDebounced();
            this.notify('世界书 ECoT 同步失败：'+resolved.resolution.skills.find(s=>s.syncError).syncError,true);
            return null;
        }
        if(epoch!==(this.epoch || 0) || this.current()?.id!==plan.id || this.current()?.applied===false || revision!==(this.current()?.revision || 0)) {
            this.notify('本轮方案在装配期间发生修改，请重新应用。',true);return null;
        }
        const result=structuredClone({...plan,chat,world:worldName,entries:[...resolved.entries,...discovery],generationResolution:resolved.resolution});
        result.injection=assembleInjection(result,this.packState);
        this.lastActivation=result;
        // Current execution diagnostics do not rewrite the historical planning snapshot.
        plan.lastGeneration=structuredClone(resolved.resolution);
        this.context().saveMetadataDebounced();
        return result;
    }
    async syncEcot() {
        const chat=this.chatKey(), worldName=this.settings().world;
        try { await this.world.syncEcot?.(); this.syncError = ''; }
        catch(error) {
            this.active = null;
            if(chat!==this.chatKey() || worldName!==this.settings().world)throw error;
            this.syncError = error.message;
            const plan = this.current();
            if(plan)plan.lastGeneration={error:`世界书 ECoT 同步失败：${error.message}`,skills:[]};
            this.context().saveMetadataDebounced();
            this.notify(`世界书 ECoT 同步失败：${error.message}`,true);
            throw error;
        }
    }
    resolveEntries(plan, model, tags=this.settings().modelTags || [], companions=plan.entries || []) {
        const resolution={...model,skills:[]}, entries=[];
        const selected=new Set([...(plan.selected?.reasoning || []),...(plan.selected?.spark || [])]);
        for(const entry of plan.entries || []) {
            const meta=entry[KEY];
            if(meta?.kind!=='skill' || !selected.has(meta.id))continue;
            const versions=meta.versions?.map(v=>v.tagId==null?{...v,body:entry.content,recommendation:meta.recommendation || ''}:v);
            const r=resolveVersion({body:entry.content,recommendation:meta.recommendation,versions},model.modelId,tags);
            const reason=meta.unavailable || (meta.enabled===false?'条目已设为不可选':r.reason);
            const mainEnabled=!!r.version && !reason && this.settings().enabled!==false, ecotRequested=hasEcot(meta,r.version);
            const companion=companions.find(e=>e[KEY]?.owner===KEY && e[KEY].kind==='ecot' && e[KEY].skillId===meta.id);
            const ecotAllowed=!companion?.[KEY]?.enabledVersionIds || companion[KEY].enabledVersionIds.includes(r.version?.id);
            const syncError=mainEnabled && ecotRequested && !companion ? `「${entry.comment}」缺少关联 ECoT Outlet 条目，请刷新素材并重新应用规划` : '';
            const outletName=versionValue('ecotOutlet',r.version?.ecotOutlet);
            const macro=`{{outlet::${outletName}}}`;
            // Native WI owns Outlet expansion. A missing consumer must never change placement.
            const preset=this.context().chatCompletionSettings?.prompts;
            const referenced=Array.isArray(preset)?preset.some(p=>[...String(p.content || '').matchAll(/{{outlet::(.+?)}}/gi)].some(m=>m[1].trim()===outletName)):null;
            resolution.skills.push({id:meta.id,title:entry.comment,versionId:r.version?.id,tagId:r.version?.tagId,label:r.label,reason,warning:r.warning,
                mainEnabled:mainEnabled && !syncError,ecotEnabled:mainEnabled && ecotRequested && ecotAllowed && !syncError,outletName:ecotRequested?outletName:'',syncError,
                ecotReason:ecotRequested && !ecotAllowed?'该版本的附加 ECoT 已在创作库关闭或删除':'',
                outletDiagnostic:ecotRequested?`${macro}：${referenced===false?'当前预设文本未找到引用；该 Outlet 不会自动改插其他位置':referenced===true?'预设文本包含引用；请确认对应提示词已启用':'请确认当前预设已启用该 Outlet 引用'}。实际入请求仍受原生世界书预算与预设控制。`:''});
            if(mainEnabled && !syncError) {
                entries.push({...structuredClone(entry),content:r.version.body});
                if(ecotRequested && ecotAllowed)entries.push(ecotEntry(entry,r.version,companion));
            }
        }
        for(const id of selected)if(!resolution.skills.some(s=>s.id===id))resolution.skills.push({id,reason:'本轮快照中没有该条目的素材，已跳过'});
        return {entries,resolution};
    }
    lore(lore) {
        // active is the execution snapshot. Library edits must not mutate an in-flight scan.
        overlayLore(lore, this.active?.entries || [], this.active, this.settings().enabled && !this.run);
    }
    async previewInjection() {
        const plan=this.current() || {selected:{reasoning:[],spark:[]},discovery:'',revision:0}, chat=this.chatKey(), world=this.settings().world,revision=plan.revision || 0;
        if(plan.frozenInjection) {
            const model=await generationModel(this.context);
            if(chat!==this.chatKey() || world!==this.settings().world || plan.id!==this.current()?.id || revision!==(this.current()?.revision || 0))throw new Error('方案已变化，请重新预览');
            const execution={...plan,entries:snapshotEntries(plan.frozenInjection),generationResolution:{...plan.frozenInjection.model,...model}};
            const result=assembleInjection(execution,this.packState);
            for(const item of result.items){const old=plan.frozenInjection.items.find(i=>i.id===item.id && i.kind===item.kind);if(old){item.packName=old.packName;item.versionId=old.versionId;item.versionLabel=old.versionLabel;}}
            return result;
        }
        const latest=await this.world.entries();await this.loadPackState();
        const model=await generationModel(this.context);
        const resolved=this.resolveEntries({...plan,entries:this.effectiveEntries(latest,latest)},model,this.settings().modelTags || [],latest);
        if(chat!==this.chatKey() || world!==this.settings().world || plan.id!==this.current()?.id || revision!==(this.current()?.revision || 0))throw new Error('方案已变化，请重新预览');
        return {...assembleInjection({...plan,entries:[...resolved.entries,...latest.filter(e=>e[KEY]?.kind==='discovery')],generationResolution:resolved.resolution},this.packState),warnings:resolved.resolution.skills.filter(s=>s.reason)};
    }
    async reuse(id,mode='latest') {
        if(this.run || this.active || this.pending)throw new Error('请先结束当前运行再恢复历史方案');
        const store=this.store(),chat=this.chatKey(),world=this.settings().world,epoch=this.epoch || 0,revision=JSON.stringify([store.draft?.id,store.draft?.revision]);
        const source=this.store().history.find(r=>r.id===id), actual=source?.generation;
        if(!source?.applied && !source?.plan && !actual)throw new Error('该记录没有可复用规划');
        if(mode==='snapshot' && !actual)throw new Error('此记录未保存实际正文快照');
        const original=source.applied || source.plan || {}, user=currentTurn(this.context().chat);
        const plan={id:crypto.randomUUID(),sourceId:id,source:actual?.source || original.source || 'ai',
            chat:this.chatKey(),world:this.settings().world,turn:user?this.turn():null,input:user?.mes ?? null,next:!user,
            selected:structuredClone(actual?.selected || original.selected),discovery:actual?.discovery ?? original.discovery ?? '',raw:source.raw || '',
            original:structuredClone(source.parsed || original.original),plannerModel:actual?.plannerModel || source.request?.plannerModelId || original.plannerModel || null,revision:0,applied:false,consumed:false,reuseMode:mode};
        if(mode==='snapshot'){plan.frozenInjection=structuredClone(actual);plan.entries=snapshotEntries(actual);}
        else {
            plan.entries=await this.world.entries();await this.loadPackState();
            const resolved=this.resolveEntries({...plan,entries:this.effectiveEntries(plan.entries,plan.entries)},await generationModel(this.context),this.settings().modelTags || [],plan.entries);
            plan.reuseWarnings=resolved.resolution.skills.filter(s=>s.reason);
            if(plan.reuseWarnings.length)this.notify('历史选材当前不可用，已保留 ID 供检查：'+plan.reuseWarnings.map(s=>s.title || s.id).join('、'),true);
        }
        if(store!==this.store() || chat!==this.chatKey() || world!==this.settings().world || epoch!==(this.epoch || 0) || revision!==JSON.stringify([store.draft?.id,store.draft?.revision]))throw new Error('聊天、绑定或草稿已变化，请重新恢复历史方案');
        this.store().draft=plan;this.context().saveMetadataDebounced();return plan;
    }
    async generateWithPlan({replan=false}={}) {
        if(this.run || this.active || this.pending || this.launching)throw new Error('请先结束或继续当前运行');
        this.launching=true;
        try {
        if(replan) {
            if(this.mode()==='manual')throw new Error('手动模式不调用 Planner');
            const plan=this.current();if(plan?.turn)delete this.store().plans[plan.turn];delete this.store().draft;
            this.forceReplan=true;
        } else {
            if(!this.current())throw new Error('当前没有有效规划');
            await this.apply(this.ensureDraft());this.confirmNext=true;
        }
        return await this.context().generate('regenerate');
        } finally {this.launching=false;}
    }
    recoverInterrupted() {
        let changed=false;
        for(const record of this.store().history) if(['running','requested'].includes(record.status) && record.id!==this.run?.id) {record.status='interrupted';if(record.generation)record.generation.status='interrupted';record.error='页面刷新或离开聊天时中断';changed=true;}
        if(changed) this.context().saveMetadataDebounced();
    }
}
