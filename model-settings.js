import { element as el, action, editDialog } from './editor.js';
import { generationModel, matchTags, validateTag } from './model-versions.js';

export function installModelSettings(root, context, settings, flow, refresh, notify) {
    const page=root.querySelector('[data-page=settings]');
    const save=()=>context().saveSettingsDebounced();
    const button=(title,fn)=>action(title,async()=>{try{await fn();}catch(e){notify(e.message,true);}});
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
            priority:{label:'匹配优先级（适配版本优先级相同时，数值越大越优先）',type:'number',step:'any',value:tag.priority},
        },setup:existing?({popup,markClean})=>{
            const remove=button('删除模型标签',async()=>{
                if(!await context().Popup.show.confirm('删除模型标签',el('p',`删除「${tag.name}」后，其专用版本将不再匹配；版本内容和历史保留。`).outerHTML))return;
                settings().modelTags=tags().filter(t=>t.id!==tag.id);save();await refresh();markClean();await popup.completeCancelled();
            });remove.classList.add('spark-danger');popup.buttonControls.prepend(remove);
        }:undefined,submit:async v=>{
            const next=validateTag({...tag,...v,groups:v.groups.split(/\r?\n/).filter(x=>x.trim()).map(line=>line.split('+').map(k=>k.trim()))});
            settings().modelTags=tags().filter(t=>t.id!==tag.id).concat(next);save();await refresh();notify('模型标签已保存');
        }});
    }
    body.append(status,button('新增模型标签',()=>editTag()),list,el('p','多个 OR 组任意满足即可；每组所有关键词必须同时包含。匹配 Generation 主模型，不改变酒馆模型设置。','spark-hint'),tester,hits);panel.append(body);page.append(panel);

    let tagsSignature;
    async function render() {
        const model=await generationModel(context);
        status.textContent=model.diagnostic || `Generation：${model.modelId} · 命中：${matchTags(model.modelId,tags()).map(t=>t.name).join('、') || '无'}`;
        test();const signature=JSON.stringify(tags());if(tagsSignature===signature)return;tagsSignature=signature;list.replaceChildren();
        for(const tag of tags()) {
            const row=button(tag.name+'　›',()=>editTag(tag));row.classList.add('spark-settings-entry');list.append(row);
        }
    }
    return {render};
}
