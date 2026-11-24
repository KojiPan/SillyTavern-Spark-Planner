import { generationModel, resolveSkills, resolveVersion } from './model-versions.js';
import { KEY, DEFAULT_PROMPTS, currentTurn, freezeCatalog, parsePlanner, plannerSections, overlayLore } from './core.js';
import { independentPlanner, inheritedPlanner } from './channels.js';
import { hasEcot, ecotEntry, versionValue } from './ecot.js';
import { packReason } from './packs.js';
import { legacyAnalysisModules, orderedAnalysisModules, resolveAnalysisModules } from './analysis-modules.js';

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
    setEnabledPacks(ids) {
        this.active=null;
        if(ids===null)delete this.store().enabledPackIds;
        else this.store().enabledPackIds=[...new Set(ids)];
        this.context().saveMetadataDebounced();
    }
    effectiveEntries(entries, latest) {
        return entries.map(e=>{
            if(e[KEY]?.kind!=='skill')return e;
            const current=latest.find(x=>x[KEY]?.kind==='skill' && x[KEY].id===e[KEY].id);
            const missing=!current;
            return {...e,[KEY]:{...e[KEY],packId:current?.[KEY].packId || e[KEY].packId,
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
        const plan = user?.extra?.[KEY] ? this.store().plans[user.extra[KEY]] : null;
        return plan?.input === user?.mes ? plan : null;
    }
    cancel() {
        this.active = null;
        this.syncError = '';
        if (this.run) {
            this.run.cancelled = true;
            this.run.controller?.abort();
            this.context().stopGeneration();
        }
    }
    async apply(plan, { snapshot = false } = {}) {
        if (plan.selected.reasoning.length > this.settings().reasoningLimit || plan.selected.spark.length > 3) {
            throw new Error(`当前选择超限：Reasoning Skill 最多 ${this.settings().reasoningLimit} 项，火花最多 3 项。`);
        }
        this.active = null;
        const key = this.chatKey();
        const worldName = this.settings().world;
        await this.syncEcot();
        if (key !== this.chatKey() || worldName !== this.settings().world) throw new Error('聊天或创作包已切换，规划未应用。');
        await this.world.ensureDiscovery(plan.discovery,worldName);
        if (key !== this.chatKey() || worldName !== this.settings().world) throw new Error('聊天或创作包已切换，规划未应用。');
        const copy = structuredClone(plan);
        copy.entries = snapshot && Array.isArray(plan.entries) ? structuredClone(plan.entries) : await this.world.entries();
        if(!snapshot) {
            const selected=new Set([...plan.selected.reasoning,...plan.selected.spark]);
            for(const entry of plan.entries || []) if(entry[KEY]?.kind==='skill' && selected.has(entry[KEY].id) && !copy.entries.some(e=>e[KEY]?.kind==='skill' && e[KEY].id===entry[KEY].id)) copy.entries.push(structuredClone(entry));
        }
        const chosen=new Set([...plan.selected.reasoning,...plan.selected.spark]);
        copy.entries=copy.entries.filter(entry=>!entry[KEY] || entry[KEY].kind==='discovery' || chosen.has(entry[KEY].kind==='ecot'?entry[KEY].skillId:entry[KEY].id));
        if (key !== this.chatKey() || worldName !== this.settings().world) throw new Error('聊天或创作包已切换，规划未应用。');
        this.store().plans[plan.turn] = copy;
        const record = this.store().history.find(r => r.id === plan.id);
        if (record) record.applied = structuredClone(copy);
        await this.context().saveChat();
        this.context().saveMetadataDebounced();
        this.notify('规划已应用');
        return copy;
    }
    async plan() {
        if (this.run) throw new Error('Planner 正在执行。');
        const c = this.context();
        const run = { id: crypto.randomUUID(), chat: this.chatKey(), world: this.settings().world, turn: this.turn(), cancelled: false, controller:new AbortController() };
        this.run = run;
        this.active = null;
        this.lastRequest = null;
        // Invalidate this turn before requesting. Failed calls must never reuse an old plan.
        delete this.store().plans[run.turn];
        const record = { id: run.id, turn: run.turn, chat: run.chat, time: new Date().toISOString(), status: 'running', raw: '', error: null };
        this.store().history.unshift(record);
        this.store().history.splice(50);
        c.saveMetadataDebounced();
        let timeout;
        try {
            this.notify('Planner 执行中…');
            const model = await generationModel(this.context), tags = structuredClone(this.settings().modelTags || []);
            const catalog = freezeCatalog(resolveSkills(await this.candidateSkills(), model.modelId, tags));
            const {effective:modules,snapshots:moduleStates}=resolveAnalysisModules(await this.analysisModules(),model.modelId,tags,this.packState,this.store());
            const modelResolution={...model,tags:structuredClone(tags),skills:[...catalog.reasoning,...catalog.spark].map(s=>({id:s.id,...s.resolvedVersion})),modules:moduleStates};
            record.modelResolution=structuredClone(modelResolution);
            if (run.cancelled || run.chat !== this.chatKey()) throw new Error('规划已取消或聊天已切换。');
            const sections=plannerSections(catalog, this.settings().prompts, this.settings().reasoningLimit, modules);
            sections[1].source=`目录前后文本与世界书「${run.world}」的本轮冻结候选目录`;
            sections[2].sources=[{source:'全局分析模块调度说明',enabled:!!modules.length,order:0,content:this.settings().prompts.analysisDispatch ?? DEFAULT_PROMPTS.analysisDispatch},...moduleStates.map(m=>({...m,source:`${m.packName} · ${m.name} · ${m.label}`,content:m.assembled?m.version?.analysis || '':''}))];
            sections[4].sources=[{source:'Reasoning Skill / 火花选择格式',enabled:true,order:1,content:this.settings().prompts.selectionFormat ?? DEFAULT_PROMPTS.selectionFormat},
                {source:'分析模块输出总起',enabled:!!modules.length,order:2,content:this.settings().prompts.analysisFormatIntro ?? DEFAULT_PROMPTS.analysisFormatIntro},...moduleStates.map(m=>({...m,source:`${m.packName} · ${m.name} · ${m.label}`,order:m.order+2,content:m.assembled?m.version?.outputFormat || '':''}))];
            const prompt=sections.map(s=>s.content).filter(Boolean).join('\n\n');
            const requestContext=structuredClone({generationModelId:model.modelId,sections,catalog:{reasoning:catalog.reasoning.map(s=>({number:s.number,id:s.id,title:s.title,recommendation:s.recommendation,version:s.resolvedVersion})),spark:catalog.spark.map(s=>({number:s.number,id:s.id,title:s.title,recommendation:s.recommendation,version:s.resolvedVersion}))},modules:moduleStates,diagnostics:{model:model.diagnostic,versions:modelResolution.skills.filter(s=>s.warning)}});
            const channel=this.settings().channels?.find(x=>x.id===this.settings().channelId);
            timeout = setTimeout(() => { run.cancelled = true; run.controller.abort(); c.stopGeneration(); }, (channel?.timeout || this.settings().timeout) * 1000);
            if(this.settings().channelId && !channel) throw new Error('选定渠道已不存在，请改为继承或重新选择');
            const inspect = snapshot => {
                record.request=structuredClone({...snapshot,...requestContext,id:run.id});
                this.lastRequest=structuredClone(record.request);
                if(run.chat===this.chatKey())c.saveMetadataDebounced();
            };
            const raw = channel ? await independentPlanner(this.context,channel,this.settings(),prompt,run.controller.signal,inspect) : await inheritedPlanner(this.context,this.settings(),prompt,run.controller.signal,inspect);
            record.raw = typeof raw === 'string' ? raw : '';
            if (run.cancelled || run.chat !== this.chatKey() || run.world !== this.settings().world || !this.settings().enabled) throw new Error('规划已取消、超时或聊天已切换。');
            const parsed = parsePlanner(raw, catalog, this.settings().reasoningLimit, modules);
            record.requestDiagnostics={warnings:structuredClone(parsed.warnings)};
            const plan = { id: run.id, turn: run.turn, input: currentTurn(c.chat)?.mes, raw, modelResolution, ...parsed, original: structuredClone(parsed) };
            record.parsed = structuredClone(parsed); record.plan=structuredClone(plan);
            const applied = await this.apply(plan);
            if (run.cancelled || run.chat !== this.chatKey() || !this.settings().enabled) throw new Error('规划已取消或聊天已切换。');
            record.status = 'applied';
            if(parsed.warnings.length) this.notify(`规划已应用 · 解析警告：${parsed.warnings.join('；')}`);
            return applied;
        } catch (error) {
            record.status = run.cancelled ? 'cancelled' : 'failed';
            record.error = error.message;
            record.requestDiagnostics={...record.requestDiagnostics,error:error.message};
            if(run.chat===this.chatKey()) this.notify(`Planner 失败：${error.message}`, true);
            throw error;
        } finally {
            clearTimeout(timeout);
            this.run = null;
            if (run.chat === this.chatKey()) c.saveMetadataDebounced();
        }
    }
    async intercept(_chat, _size, abort, type) {
        if (this.run && type === 'quiet') return; // Only our nested quiet generation bypasses.
        if (this.run) { abort(true); return; }
        this.active = null;
        if (!this.settings().enabled || ['quiet', 'impersonate'].includes(type)) return;
        try {
            let plan = this.current();
            if (['swipe', 'regenerate', 'continue'].includes(type)) {
                // No snapshot means no planning context, never another turn's plan.
                this.active = await this.activation(plan);
                if(plan && !this.active) abort(true);
                return;
            }
            const turn = this.turn();
            if (!plan || plan.turn !== turn) plan = await this.plan();
            const only = this.only;
            this.only = false;
            if (only || !this.settings().autoContinue) { abort(true); return; }
            this.active = await this.activation(plan);
            if(!this.active) { abort(true); return; }
            // Quiet's finally unlocks ST's shared UI. Restore the outer generation lock.
            this.context().deactivateSendButtons();
        } catch {
            this.only = false;
            this.active = null;
            abort(true); // ST catches interceptor exceptions, so explicitly abort.
        }
    }
    async activation(plan) {
        if(!plan) return null;
        const chat=this.chatKey();
        const worldName=this.settings().world;
        // Skills keep their per-turn snapshot; discovery placement follows its real WI entry.
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
        if(resolved.resolution.skills.some(s=>s.syncError)) {
            plan.lastGeneration=structuredClone(resolved.resolution);
            this.context().saveMetadataDebounced();
            this.notify('世界书 ECoT 同步失败：'+resolved.resolution.skills.find(s=>s.syncError).syncError,true);
            return null;
        }
        const result={...plan,entries:[...resolved.entries,...discovery],generationResolution:resolved.resolution};
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
        const entries=(this.active?.entries || []).filter(e=>{
            const meta=e[KEY];if(!['skill','ecot'].includes(meta?.kind))return true;
            const parent=this.liveEntries?.find(x=>x[KEY]?.kind==='skill' && x[KEY].id===(meta.kind==='ecot'?meta.skillId:meta.id));
            return !this.packReason(parent?.[KEY].packId || meta.packId);
        });
        overlayLore(lore, entries, this.active, this.settings().enabled && !this.run);
    }
    async reuse(id) {
        const source=this.store().history.find(r=>r.id===id);
        if(!source?.applied && !source?.plan) throw new Error('该记录没有可回用规划');
        const plan=structuredClone(source.applied || source.plan);
        plan.id=crypto.randomUUID(); plan.turn=this.turn(); plan.input=currentTurn(this.context().chat).mes;
        const record={id:plan.id,sourceId:id,turn:plan.turn,chat:this.chatKey(),time:new Date().toISOString(),status:'reused',raw:source.raw,parsed:structuredClone(source.parsed),plan:structuredClone(plan)};
        this.store().history.unshift(record);this.store().history.splice(50);
        return this.apply(plan,{snapshot:true});
    }
    recoverInterrupted() {
        let changed=false;
        for(const record of this.store().history) if(record.status==='running' && record.id!==this.run?.id) {record.status='interrupted';record.error='页面刷新或离开聊天时中断';changed=true;}
        if(changed) this.context().saveMetadataDebounced();
    }
}
