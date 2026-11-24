import { element as el, action, editDialog } from './editor.js';
import { generationModel, matchTags, validateTag } from './model-versions.js';

export function installModelSettings(root, context, settings, flow, refresh, notify) {
    const page=root.querySelector('[data-page=settings]');
    const save=()=>context().saveSettingsDebounced();
    const idle=()=>{if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束');};
    const button=(title,fn)=>action(title,async()=>{try{idle();await fn();}catch(e){notify(e.message,true);}});
    const tags=()=>settings().modelTags ||= [];
    const panel=el('details',undefined,'spark-card spark-fold');panel.append(el('summary','模型匹配'));
    const body=el('div',undefined,'spark-fold-body'), list=el('div'), status=el('p','','spark-hint');
    const tester=el('input');tester.placeholder='输入任意模型 ID 测试';tester.setAttribute('aria-label','测试模型匹配');
    const hits=el('p','','spark-hint');
    function test(){hits.textContent='命中标签：'+(matchTags(tester.value,tags()).map(t=>t.name).join('、') || '无');}
    tester.addEventListener('input',test);
    async function editTag(existing) {
        const tag=existing || {id:crypto.randomUUID(),name:'',groups:[],priority:0};
        await editDialog(context,{title:existing?'编辑模型标签':'新增模型标签',notify,fields:{
            name:{label:'显示名称',required:true,value:tag.name},
            groups:{label:'匹配规则：每行一个 OR 组；同行关键词用 + 分隔（AND，忽略大小写）',type:'textarea',required:true,value:tag.groups.map(g=>g.join(' + ')).join('\n')},
            priority:{label:'标签优先级（版本优先级相同时，数值越大越优先）',type:'number',step:'any',value:tag.priority},
        },submit:async v=>{
            idle();const next=validateTag({...tag,...v,groups:v.groups.split(/\r?\n/).filter(x=>x.trim()).map(line=>line.split('+').map(k=>k.trim()))});
            settings().modelTags=tags().filter(t=>t.id!==tag.id).concat(next);save();await refresh();notify('模型标签已保存');
        }});
    }
    body.append(status,button('新增模型标签',()=>editTag()),list,el('p','多个 OR 组任意满足即可；每组所有关键词必须同时包含。匹配 Generation 主模型，不改变酒馆模型设置。','spark-hint'),tester,hits);panel.append(body);page.append(panel);

    async function render() {
        const model=await generationModel(context);
        status.textContent=model.diagnostic || `Generation：${model.modelId} · 命中：${matchTags(model.modelId,tags()).map(t=>t.name).join('、') || '无'}`;
        list.replaceChildren();test();
        for(const tag of tags()) {
            const row=el('div',undefined,'spark-setting-row');row.append(el('span',tag.name),button('编辑',()=>editTag(tag)),button('删除',async()=>{
                if(!await context().Popup.show.confirm('删除模型标签',el('p',`删除「${tag.name}」后，引用它的专用版本将不再匹配；版本内容和历史记录保留。`).outerHTML))return;
                settings().modelTags=tags().filter(t=>t.id!==tag.id);save();await refresh();
            }));list.append(row);
        }
    }
    return {render};
}
