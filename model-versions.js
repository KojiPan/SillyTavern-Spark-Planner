import { SKILL_VERSION_FIELDS, versionValue } from './ecot.js';

// Shared by Skills and analysis modules. Identity and insertion remain on the owner.
export function versionsOf(item, fields = SKILL_VERSION_FIELDS) {
    const versions = Array.isArray(item.versions) ? structuredClone(item.versions) : [{ id: 'default', tagId: null, priority: 0, ...Object.fromEntries(fields.map(k => [k, item[k]])) }];
    return versions.map(v => ({ ...v, ...Object.fromEntries(fields.map(k => [k, versionValue(k, v[k])])) }));
}

export function validateVersions(item, fields = SKILL_VERSION_FIELDS) {
    const versions = versionsOf(item, fields);
    if (!versions.length || versions.length > 200) throw new Error('至少保留一个有效版本（最多 200 个）');
    const ids = new Set(); let defaults = 0;
    return versions.map(v => {
        if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) throw new Error('版本 ID 缺失或重复');
        ids.add(v.id);
        if (v.tagId != null && (typeof v.tagId !== 'string' || !v.tagId.trim())) throw new Error('模型标签引用无效');
        if (v.tagId == null && ++defaults > 1) throw new Error('只能有一个默认版本');
        const priority = Number(v.priority || 0);
        if (!Number.isFinite(priority)) throw new Error('版本优先级必须是有限数值');
        const values = Object.fromEntries(fields.map(k => [k, versionValue(k, v[k])]));
        if (fields.includes('body') ? !values.body.trim() : !Object.values(values).some(x => x.trim())) throw new Error('版本内容不能为空');
        return { id: v.id, tagId: v.tagId ?? null, priority, ...values };
    });
}

export function validateTag(tag) {
    if (typeof tag.id !== 'string' || !tag.id.trim() || typeof tag.name !== 'string' || !tag.name.trim()) throw new Error('模型标签需要稳定 ID 和名称');
    if (!Array.isArray(tag.groups) || !tag.groups.length || tag.groups.some(g => !Array.isArray(g) || !g.length || g.some(k => typeof k !== 'string' || !k.trim()))) throw new Error('每个 OR 规则组至少需要一个关键词');
    const priority = Number(tag.priority || 0);
    if (!Number.isFinite(priority)) throw new Error('标签优先级必须是有限数值');
    return { id: tag.id, name: tag.name.trim(), groups: tag.groups.map(g => g.map(k => k.trim())), priority };
}

export function matchTags(modelId, tags = []) {
    if (!modelId) return [];
    const id = modelId.toLowerCase();
    return tags.filter(t => t.groups?.some(g => g.length && g.every(k => typeof k === 'string' && k.trim() && id.includes(k.trim().toLowerCase()))));
}

export function resolveVersion(item, modelId, tags = [], fields) {
    const versions = versionsOf(item, fields), matched = matchTags(modelId, tags);
    const candidates = versions.filter(v => v.tagId && matched.some(t => t.id === v.tagId));
    const rank = v => [Number(v.priority || 0), Number(tags.find(t => t.id === v.tagId)?.priority || 0)];
    candidates.sort((a, b) => rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const version = candidates[0] || versions.find(v => v.tagId == null);
    const conflict = candidates.length > 1 && rank(candidates[0]).every((n, i) => n === rank(candidates[1])[i]);
    const label = version ? version.tagId ? tags.find(t => t.id === version.tagId)?.name || version.tagId : '默认版本' : '';
    return { version, label, reason: version ? '' : '没有匹配的模型专用版本，且无默认版本', warning: conflict ? '版本优先级与标签优先级相同，按版本稳定 ID 字典序选择' : '' };
}

export function resolveSkills(skills, modelId, tags) {
    return skills.flatMap(skill => {
        const r = resolveVersion(skill, modelId, tags);
        return r.version ? [{ ...skill, ...r.version, id: skill.id, resolvedVersion: { id: r.version.id, tagId: r.version.tagId, label: r.label, warning: r.warning } }] : [];
    });
}

export async function generationModel(context) {
    const c = context(); let id;
    try {
        if (c.mainApi === 'openai') id = c.getChatCompletionModel?.();
        else if (c.mainApi === 'textgenerationwebui') {
            // Official export reads the active backend's actual model setting, never its UI alias/status.
            const s = c.textCompletionSettings;
            if (s?.type !== 'huggingface') id = (await import('../../../textgen-settings.js')).getTextGenModel(s);
        } else if (c.mainApi === 'novel') id = (await import('../../../nai-settings.js')).nai_settings.model_novel;
        if (typeof id === 'string' && id.trim()) return { modelId: id.trim(), diagnostic: '' };
    } catch (e) { return { modelId: null, diagnostic: `Generation 模型读取失败：${e.message}` }; }
    return { modelId: null, diagnostic: `无法识别 Generation 主模型 ID（${c.mainApi || '未知 API'}）；按无匹配标签处理` };
}

// Conflicting imported definitions get new IDs, and only imported references are rewritten.
export function mergeImportedTags(local, incoming, skills, newId = () => crypto.randomUUID()) {
    const tags = structuredClone(local || []), records = structuredClone(skills), changes = [], mapping = new Map();
    for (const raw of incoming || []) {
        const tag = validateTag(raw), old = tags.find(t => t.id === tag.id);
        if (old && JSON.stringify(validateTag(old)) === JSON.stringify(tag)) continue;
        if (old || tags.some(t => t.name === tag.name && JSON.stringify(validateTag(t)) !== JSON.stringify(tag))) {
            const id = newId(); mapping.set(tag.id, id); changes.push(`标签「${tag.name}」与本地定义冲突，保留本地并导入为新标签`);
            tag.id = id; tag.name += '（导入）';
        }
        tags.push(tag);
    }
    for (const skill of records) for (const v of skill.versions || []) if (mapping.has(v.tagId)) v.tagId = mapping.get(v.tagId);
    for (const skill of records) for (const v of skill.versions || []) if (v.tagId && !tags.some(t => t.id === v.tagId)) throw new Error(`版本引用的模型标签不存在：${v.tagId}`);
    return { tags, skills: records, changes };
}
