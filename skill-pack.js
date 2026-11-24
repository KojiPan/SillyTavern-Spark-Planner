import { validateVersions, validateTag } from './model-versions.js';
import { zipSync, unzipSync, strToU8, strFromU8 } from './vendor/fflate.js';
import { validatePack } from './packs.js';
import { validateAnalysisModule } from './analysis-modules.js';
export const NATIVE_FIELDS = ['key','keysecondary','constant','vectorized','selective','selectiveLogic','addMemo','order','position','ignoreBudget','excludeRecursion','preventRecursion','matchPersonaDescription','matchCharacterDescription','matchCharacterPersonality','matchCharacterDepthPrompt','matchScenario','matchCreatorNotes','delayUntilRecursion','probability','useProbability','depth','outletName','group','groupOverride','groupWeight','scanDepth','caseSensitive','matchWholeWords','useGroupScoring','automationId','role','sticky','cooldown','delay','triggers','characterFilter'];
export function validateSkill(input) {
    const s = structuredClone(input);
    for (const key of ['id','title']) if (typeof s[key] !== 'string' || !s[key].trim()) throw new Error(`条目缺少 ${key}`);
    if (s.id.length > 200 || !['reasoning','spark'].includes(s.type)) throw new Error('条目 ID 或类型不合法');
    const versions = validateVersions(s, s.type === 'reasoning' ? undefined : ['recommendation', 'body']);
    const defaultVersion = versions.find(v=>v.tagId==null);
    const native = {};
    for (const key of NATIVE_FIELDS) if (s.native?.[key] !== undefined) native[key] = s.native[key];
    for (const [key, fallback, max] of [['position',4,7],['role',0,2],['depth',0,10000]]) {
        const n = Number(native[key] ?? s[key] ?? fallback);
        if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(`条目 ${key} 不合法`);
        native[key] = n;
    }
    for(const [key,fallback,max] of [['order',100,Infinity],['probability',100,100]]) {
        const value=Number(native[key] ?? fallback);
        if(!Number.isFinite(value) || (key==='probability' && (value<0 || value>max)))throw new Error(`条目 ${key} 不合法`);
        native[key]=value;
    }
    native.useProbability ??= true;
    native.outletName = String(native.outletName ?? s.outletName ?? (native.position === 7 ? 'koji_cot' : ''));
    if(s.packId!==undefined && (typeof s.packId!=='string' || !s.packId.trim() || s.packId.length>200))throw new Error('条目所属包 ID 不合法');
    return { id:s.id, ...(s.packId?{packId:s.packId}:{}), type:s.type, title:s.title, body:defaultVersion?.body || '', versions, category:String(s.category || '未分类'), recommendation:defaultVersion?.recommendation || '', enabled:s.enabled !== false, native };
}
export function toMarkdown(skill, tags = [], pack) {
    const { body, recommendation: _legacyRecommendation, ...metadata } = validateSkill(skill);
    for(const v of metadata.versions)if(v.tagId && !tags.some(t=>t.id===v.tagId))throw new Error(`导出缺少模型标签定义：${v.tagId}，请先修复版本引用`);
    return `---\n${JSON.stringify({...metadata,...(pack?{pack:validatePack(pack)}:{}),modelTags:tags.filter(t=>metadata.versions.some(v=>v.tagId===t.id)).map(validateTag)},null,2)}\n---\n${body}`;
}
export function fromMarkdown(text, yamlParse = JSON.parse) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text.replace(/^\uFEFF/,''));
    if (!match) throw new Error('Markdown 缺少 YAML Frontmatter');
    const data=yamlParse(match[1]);
    if(data.versions){const v=data.versions.find(v=>v.tagId==null);if(v)v.body=match[2];}
    const skill=validateSkill({ ...data, body:match[2] });
    if(data.modelTags?.length)skill.modelTags=data.modelTags.map(validateTag);
    if(data.pack)Object.defineProperty(skill,'pack',{value:validatePack(data.pack)});
    return skill;
}
export function exportPack(skills, categories = [], tags = [], pack, analysisModules = []) {
    const modules=analysisModules.map(validateAnalysisModule);
    if(new Set(modules.map(m=>m.id)).size!==modules.length)throw new Error('分析模块存在重复稳定 ID');
    if(pack && modules.some(m=>m.packId!==pack.id))throw new Error('只能导出所选创作包中的分析模块');
    for(const m of modules)for(const v of m.versions)if(v.tagId && !tags.some(t=>t.id===v.tagId))throw new Error(`导出缺少模型标签定义：${v.tagId}，请先修复版本引用`);
    if(new Set(skills.map(s=>s.id)).size !== skills.length) throw new Error('创作库存在重复稳定 ID，请先检查世界书条目');
    if(pack && skills.some(s=>s.packId!==pack.id))throw new Error('只能导出所选创作包中的条目');
    const files = { 'manifest.json': strToU8(JSON.stringify({ format:'spark-planner-skills', version:pack?3:2, ...(pack?{pack:validatePack(pack)}:{}), ...(modules.length?{analysisModules:modules}:{}), categories:pack?.categories || categories, modelTags:tags.filter(t=>[...skills,...modules].some(s=>s.versions?.some(v=>v.tagId===t.id))).map(validateTag) },null,2)) };
    for (const s of skills) {
        const folder=(s.category || '未分类').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80) || '未分类';
        files[`${folder}/${encodeURIComponent(s.id)}.md`] = strToU8(toMarkdown(s,tags,pack));
    }
    return zipSync(files);
}
export function importPack(bytes, yamlParse) {
    if (bytes.length > 10 * 1024 * 1024) throw new Error('导入文件超过 10MB');
    let total = 0, count = 0;
    const files = unzipSync(bytes, { filter: file => {
        total += file.originalSize; count++;
        if (total > 30 * 1024 * 1024 || count > 3000 || /(^|[/\\])\.\.([/\\]|$)|^[/\\]/.test(file.name)) throw new Error('ZIP 路径或解压规模不合法');
        return /\.md$/i.test(file.name) || file.name==='manifest.json';
    } });
    const metadata=files['manifest.json'] ? JSON.parse(strFromU8(files['manifest.json'])) : {};
    if(metadata.analysisModules!==undefined && (!Array.isArray(metadata.analysisModules) || metadata.analysisModules.length>1000))throw new Error('分析模块列表无效或过大');
    const modules=(metadata.analysisModules || []).map(validateAnalysisModule);
    if(new Set(modules.map(m=>m.id)).size!==modules.length)throw new Error('导入包包含重复分析模块 ID');
    if(metadata.format && metadata.format!=='spark-planner-skills') throw new Error('不支持的创作包格式');
    if(metadata.version && ![1,2,3].includes(metadata.version))throw new Error('不支持的创作包版本');
    const skills = Object.entries(files).filter(([name])=>/\.md$/i.test(name)).map(([,file]) => fromMarkdown(strFromU8(file), yamlParse));
    if (!skills.length && !modules.length && !metadata.categories?.length && !metadata.pack) throw new Error('未找到条目 Markdown 文件');
    if(metadata.pack) {
        const pack=validatePack(metadata.pack);
        if(skills.some(s=>s.packId && s.packId!==pack.id))throw new Error('条目归属与创作包元数据不一致');
        if(modules.some(m=>m.packId!==pack.id))throw new Error('分析模块归属与创作包元数据不一致');
        Object.defineProperty(skills,'pack',{value:pack});
    }
    if (new Set(skills.map(s=>s.id)).size !== skills.length) throw new Error('导入包包含重复稳定 ID');
    Object.defineProperty(skills,'categories',{value:Array.isArray(metadata.categories)?metadata.categories.filter(x=>typeof x==='string' && x.length<512).slice(0,1000):[]});
    const definitions=[...(metadata.modelTags || []),...skills.flatMap(s=>s.modelTags || [])];
    const unique=new Map();for(const raw of definitions){const t=validateTag(raw);if(unique.has(t.id) && JSON.stringify(unique.get(t.id))!==JSON.stringify(t))throw new Error('导入包模型标签 ID 定义冲突');unique.set(t.id,t);}
    for(const skill of skills)delete skill.modelTags;
    Object.defineProperty(skills,'modelTags',{value:[...unique.values()]});
    for(const m of modules)for(const v of m.versions)if(v.tagId && !unique.has(v.tagId))throw new Error(`分析模块引用的模型标签不存在：${v.tagId}`);
    Object.defineProperty(skills,'analysisModules',{value:modules});
    return skills;
}
