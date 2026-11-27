import { validateVersions, versionsOf, resolveVersion } from './model-versions.js';
import { LEGACY_PROMPTS, DEFAULT_PROMPTS } from './core.js';
import { packReason } from './packs.js';

export const ANALYSIS_FIELDS = ['analysis', 'outputFormat'];
export const INJECTION_MODES = { full: '全文注入', guidance: '标签提取', view: '仅供查看' };

export function validateAnalysisModule(raw) {
    for(const key of ['id','name','packId'])if(typeof raw?.[key]!=='string' || !raw[key].trim() || raw[key].length>(key==='name'?512:200))throw new Error(`分析模块 ${key} 缺失或不合法`);
    const order=Number(raw.order ?? 0);
    if(!Number.isFinite(order))throw new Error('分析模块排序必须是有限数值');
    const injectionMode=raw.injectionMode ?? 'full';
    if(!Object.hasOwn(INJECTION_MODES,injectionMode))throw new Error('分析模块输出注入方式无效');
    return {id:raw.id,name:raw.name.trim(),description:String(raw.description || ''),packId:raw.packId,enabled:raw.enabled!==false,order,injectionMode,versions:validateVersions(raw,ANALYSIS_FIELDS)};
}

export function legacyAnalysisModules(settings, packId) {
    const source=settings.analysisModules ?? [{id:'psychology',name:'心理发现',enabled:true,analysis:settings.prompts?.discovery || LEGACY_PROMPTS.discovery,
        outputFormat:[LEGACY_PROMPTS.protocol,DEFAULT_PROMPTS.protocol,undefined].includes(settings.analysisPromptBackup?.protocol ?? settings.prompts?.protocol) ? LEGACY_PROMPTS.discovery : ''}];
    return source.map((m,order)=>{
        const versions=versionsOf(m,ANALYSIS_FIELDS);
        if((settings.analysisPromptBackup?.protocol ?? settings.prompts?.protocol)===LEGACY_PROMPTS.protocol && (m.id==='psychology' || m.name==='心理发现'))for(const v of versions)if(!v.outputFormat.trim())v.outputFormat=LEGACY_PROMPTS.discovery;
        return validateAnalysisModule({...m,packId,order,versions});
    });
}

export function orderedAnalysisModules(modules, order=[]) {
    const positions=new Map((Array.isArray(order)?order:[]).map((id,i)=>[id,i]));
    return [...modules].sort((a,b)=>(positions.get(a.id) ?? Infinity)-(positions.get(b.id) ?? Infinity) || a.order-b.order || a.id.localeCompare(b.id));
}

export function resolveAnalysisModules(modules, modelId, tags, state, store) {
    const effective=[], snapshots=[];
    for(const [index,module] of orderedAnalysisModules(modules,store?.analysisModuleOrder).entries()) {
        const resolved=resolveVersion(module,modelId,tags,ANALYSIS_FIELDS);
        const reason=packReason(module.packId,state,store) || (module.enabled===false?'用户未启用':resolved.reason);
        const assembled=!reason && !!resolved.version;
        const snapshot={id:module.id,name:module.name,description:module.description || '',packId:module.packId,packName:state?.packs.find(p=>p.id===module.packId)?.name || '',order:index+1,
            injectionMode:module.injectionMode ?? 'full',deliveryProtocol:'guidance',enabled:module.enabled!==false,assembled,number:assembled?String(effective.length+1):null,version:structuredClone(resolved.version),label:resolved.label,modelReason:resolved.reason,reason,warning:resolved.warning};
        snapshots.push(snapshot);
        if(assembled)effective.push({...module,...resolved.version,id:module.id});
    }
    return {effective,snapshots};
}
