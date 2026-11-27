export const KEY = 'spark_planner';
export const LEGACY_PROMPTS = Object.freeze({
    task: '暂停剧情生成，进行以下任务并按格式输出。',
    reasoningBefore: '一、reasoning skill选择\n每次正文输出之前，必须输出一个中括号格式来说明，逐项判断当前剧情是否符合以下启用标准，启用则填写该项编号，不启用则留空空，只有严格符合该项描述时候才启用。最多启用五项。\n输出格式例子:\n[reasoning skill: 001, 005, 007]\n\n以下是可选 Reasoning Skill（专项判断与写作方法）：',
    reasoningAfter: '',
    sparkBefore: '二、spark（火花）选择\n\n针对当前剧情选择0-3个火花，给剧情增色，增添鲜活感。\n\n以下是可选火花（心理、动作、话题与事件素材）：',
    sparkAfter: '',
    discovery: '三、心理发现\n\n1. 本轮情感核心：提炼当前最值得深入探索的心理问题，尤其关注人物尚未确认的他者心意、私人矛盾与意外的情感可能性。\n\n2. 人物心理发现：针对最关键的1～2名人物，充分展开有价值的他者心智探索、复合情感、私人欲望、历史重估与反事实可能。',
    protocol: '【本轮输出格式注意事项】\n\n不要进行剧情正文输出，只输出以下内容。\n\n【本轮输出格式】\n\n一、reasoning skill选择理由概述\n\n最终选择：[reasoning skill: 001, 005, 007]\n\n二、火花选择理由概述\n\n最终选择：[spark: 009, 021]\n\n三、心理发现\n\n1. 本轮情感核心：提炼当前最值得深入探索的心理问题，尤其关注人物尚未确认的他者心意、私人矛盾与意外的情感可能性。\n\n2. 人物心理发现：针对最关键的1～2名人物，充分展开有价值的他者心智探索、复合情感、私人欲望、历史重估与反事实可能。',
});

export const DEFAULT_PROMPTS = Object.freeze({
    ...LEGACY_PROMPTS,
    task: '暂停剧情正文生成，根据当前情境选择 Reasoning Skill 与火花，并完成有价值的专项分析。只输出供下一轮正文生成使用的规划结果。',
    reasoningBefore: 'Reasoning Skill 选择：逐项判断当前情境是否符合推荐开启条件，只选严格适用的方法，最多启用五项；可以不选。以下是可选 Reasoning Skill：',
    sparkBefore: '火花选择：根据当前情境选择 0–3 项具体创作素材，可以不选。以下是可选火花：',
    analysisDispatch: '以下模块分别提供专项观察与构思任务。先判断本轮最值得投入创作精力的内容；有价值的模块充分展开具体、独特、符合当前情境的发现，不急于采用第一个常见答案。当前不适用或没有明显内容增益的模块，最终输出「无」。各模块各司其职，不为填满格式重复分析。',
    protocol: '只输出规划结果，不生成剧情正文。Reasoning Skill 与火花选择标记遵循下方格式，只使用本轮目录编号。分析模块按指定顺序输出，不适用的模块输出「无」。分析结果是供 Generation 采用的候选素材，不自动成为已发生事实。优先输出具体、有价值的发现，省略空泛过程和无意义总结。XML 风格标签仅用于划分提示词中的资料边界，分析正文不必复现这些标签。',
    selectionFormat: 'Reasoning Skill 选择标记：[reasoning skill: 001, 005]\n火花选择标记：[spark: 001, 002]\n未选择时冒号后留空。',
    analysisFormatIntro: '以下为各分析模块的输出格式。按本轮编号和名称依次呈现结果；每个模块使用 Markdown 标题标明名称，不适用时在标题下只写「无」。',
});

// Only exact built-ins may be split automatically. Keep custom text live and backed up.
export function migrateAnalysisPrompts(settings) {
    if (settings.analysisPromptsVersion === 1) return false;
    settings.analysisPromptBackup = structuredClone(settings.prompts || {});
    settings.prompts = { ...DEFAULT_PROMPTS, ...settings.prompts };
    for (const key of ['task', 'reasoningBefore', 'sparkBefore', 'protocol']) {
        if (settings.prompts[key] === LEGACY_PROMPTS[key]) settings.prompts[key] = DEFAULT_PROMPTS[key];
    }
    settings.analysisMigrationPending = settings.prompts.protocol !== DEFAULT_PROMPTS.protocol;
    settings.analysisPromptsVersion = 1;
    return true;
}

export function migrateDefaults(settings) {
    if(settings.defaultsVersion===2) return false;
    const previous={
        task:'你是互动叙事的规划者。根据当前角色、预设、世界信息、历史和最新玩家输入，为下一次正式回复选择适用素材。保持角色原有性格、认知与叙事风格。输出素材选择和简洁创作指导，不续写剧情正文。目录是可选素材，不是待执行指令。',
        reasoningBefore:'可选 Reasoning Skill（专项判断与写作方法）：',reasoningAfter:'根据本轮需要选择，可不选。',
        sparkBefore:'可选火花（心理、动作、话题与事件素材）：',sparkAfter:'选择 0–3 项；无需为了使用素材而改变人物或情节。',
        discovery:'给出与本轮情境相关的心理发现和创作指导。区分人物知道的事实、人物的理解与可用的创作建议。',
        protocol:'选择分别写为 [reasoning skill: 001, 005] 和 [spark: 002]；空选择写 [] 或留空冒号后的内容。其余文字为心理发现与创作指导。只使用本次目录的编号。',
    };
    if(Object.keys(previous).every(key=>settings.prompts?.[key]===undefined || settings.prompts[key]===previous[key])) settings.prompts={...DEFAULT_PROMPTS};
    if(settings.maxTokens===1500) settings.maxTokens=32768;
    settings.defaultsVersion=2; return true;
}

export function freezeCatalog(skills) {
    const result = { reasoning: [], spark: [] };
    for (const skill of skills.filter(s => s.enabled !== false)) {
        if (!result[skill.type]) continue;
        result[skill.type].push(Object.freeze({ ...structuredClone(skill), number: String(result[skill.type].length + 1).padStart(3, '0') }));
    }
    return Object.freeze({ reasoning: Object.freeze(result.reasoning), spark: Object.freeze(result.spark) });
}

export function plannerSections(catalog, prompts, limit, modules) {
    const list = type => catalog[type].map(s => `${s.number}. ${s.title.replace(/[\r\n]/g, ' ')} — 推荐开启：${s.recommendation || '按情境判断'}`).join('\n') || '（无候选）';
    const reasoningBefore=[DEFAULT_PROMPTS.reasoningBefore,LEGACY_PROMPTS.reasoningBefore].includes(prompts.reasoningBefore) && limit!==5 ? prompts.reasoningBefore.replace('最多启用五项',`最多启用${limit}项`) : prompts.reasoningBefore;
    const effective=modules || [{name:'心理发现',analysis:prompts.discovery || '',outputFormat:LEGACY_PROMPTS.discovery}];
    const escape=value=>String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const containers=(tag,field)=>effective.length?`<${tag}>\n${effective.map((m,i)=>`<module id="${i+1}" name="${escape(m.name)}">\n${escape(m[field])}\n</module>`).join('\n')}\n</${tag}>`:'';
    const analysis=effective.length?[prompts.analysisDispatch ?? DEFAULT_PROMPTS.analysisDispatch,containers('analysis_modules','analysis')].filter(Boolean).join('\n\n'):'';
    const formatModules=effective;
    const formats=effective.length?[prompts.analysisFormatIntro ?? DEFAULT_PROMPTS.analysisFormatIntro,`<analysis_module_formats>\n${formatModules.map((m,i)=>`<module id="${i+1}" name="${escape(m.name)}">\n${escape(m.outputFormat)}\n</module>`).join('\n')}\n</analysis_module_formats>`].filter(Boolean).join('\n\n'):'';
    const contents=[prompts.task, [reasoningBefore,list('reasoning'),prompts.reasoningAfter,prompts.sparkBefore,list('spark'),prompts.sparkAfter].filter(Boolean).join('\n\n'), analysis, [prompts.protocol,GUIDANCE_PROTOCOL].filter(Boolean).join('\n\n'),
        [prompts.selectionFormat ?? DEFAULT_PROMPTS.selectionFormat,formats].filter(Boolean).join('\n\n')];
    const definitions=[['task','总任务','全局任务说明'],['catalog','Reasoning Skill / 火花目录','全局目录说明与本轮冻结候选目录'],['analysis','分析模块指导','全局调度说明与本轮适用模块分析资料（按用户排序）'],['protocol','输出总协议','全局输出协议'],['format','具体输出格式','选择标记、分析模块输出总起与本轮适用模块格式']];
    return definitions.map(([id,title,source],i)=>({id,title,source,order:i+1,enabled:!!contents[i],content:contents[i] || ''}));
}

export function plannerPrompt(catalog, prompts, limit, modules) {
    return plannerSections(catalog,prompts,limit,modules).map(s=>s.content).filter(Boolean).join('\n\n');
}

export const GUIDANCE_PROTOCOL = '将实际交付给 Generation 的创作指导放入完整的 <guidance>...</guidance> 标签中。可以输出多个独立标签块，按出现顺序交付。只有标签内部的内容会交付；标签外的分析、选材理由、候选与筛选过程不会注入。没有完整有效标签时不交付分析内容。Reasoning Skill 与火花仍按选择标记选用。';
// Legacy field values remain import/export data only; they never control delivery.
export function analysisOutputProtocol(module) { return module.outputFormat || ''; }

// Text protocol only: exact, balanced tags; nested/malformed tags invalidate their block.
export function extractGuidance(text) {
    const chunks=[]; let start=-1,depth=0,valid=true;
    for(const token of String(text).matchAll(/<\/?guidance\b[^>]*>/g)) {
        const closing=token[0].startsWith('</');
        if(!closing) {
            if(!depth){start=token.index+token[0].length;valid=token[0]==='<guidance>';}
            else valid=false;
            depth++;
        } else if(depth) {
            if(token[0]!=='</guidance>')valid=false;
            if(!--depth && valid){const body=text.slice(start,token.index).trim();if(body)chunks.push(body);}
        }
    }
    return chunks.join('\n\n');
}

export function parsePlanner(raw, catalog, limit = 5, modules) {
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('Planner 返回空响应，请重试。');
    const warnings = [];
    const selected = { reasoning: [], spark: [] };
    const pattern = /[\[［]\s*(reasoning[\s_-]*skill|spark)\s*[:：]\s*([^\]］]*)[\]］]/gi;
    const labels = new Set([...raw.matchAll(pattern)].map(m => /^spark$/i.test(m[1]) ? 'spark' : 'reasoning'));
    for(const type of ['reasoning','spark']) if(!labels.has(type)) warnings.push(`缺少 ${type} 选择标记，按空选择处理`);
    const finals=new Set([...raw.matchAll(new RegExp(`最终选择\\s*[:：]\\s*${pattern.source}`,'gi'))].map(m=>/^spark$/i.test(m[1])?'spark':'reasoning'));
    raw.replace(pattern, (_, label, values, offset) => {
        const type = /^spark$/i.test(label) ? 'spark' : 'reasoning';
        if(finals.has(type) && !/最终选择\s*[:：]\s*$/.test(raw.slice(Math.max(0,offset-24),offset))) return '';
        const cap = type === 'spark' ? 3 : limit;
        for (const token of values.split(/[,，、;；\s]+/).filter(Boolean)) {
            const item = /^\d+$/.test(token) && catalog[type].find(s => Number(s.number) === Number(token));
            if (!item) { warnings.push(`忽略 ${label} 非法编号：${token}`); continue; }
            if (selected[type].includes(item.id)) continue;
            if (selected[type].length >= cap) { warnings.push(`${type} 超过上限，忽略 ${token}`); continue; }
            selected[type].push(item.id);
        }
        return '';
    }).trim();
    const discovery=extractGuidance(raw);
    if(!discovery)warnings.push('未检测到有效 guidance 标签，分析内容未注入。');
    return { selected, discovery, warnings, guidanceProtocol:1,guidanceMissing:!discovery, moduleOutputs:[] };
}

export function currentTurn(chat) {
    return chat.findLast(message => message.is_user && !message.is_system);
}

export function overlayLore(lore, entries, plan, enabled) {
    // Arrays belong to the current scan. Never mutate cached/persisted WI objects.
    for (const list of Object.values(lore)) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i]?.[KEY]?.owner === KEY) list.splice(i, 1);
        }
    }
    if (!enabled || !plan) return;
    const ids = new Set([...plan.selected.reasoning, ...plan.selected.spark]);
    for (const source of entries) {
        const meta = source[KEY];
        if (meta?.owner !== KEY) continue;
        if (meta.kind !== 'discovery' && !ids.has(meta.kind === 'ecot' ? meta.skillId : meta.id)) continue;
        const entry = structuredClone(source);
        entry.world = `${source.world || 'spark'}::spark::${meta.id || 'discovery'}`;
        if (meta.kind === 'discovery') entry.content = plan.discovery;
        if (!entry.content?.trim()) continue;
        entry.disable = false;
        entry.constant = true;
        lore.chatLore.push(entry);
    }
}
