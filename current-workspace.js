import { element as el, action, editDialog } from './editor.js';
import { readingText, setReadingText } from './ui.js';
import { renderInjection } from './injection-viewer.js';
import { KEY } from './core.js';

export function guidanceView(plan,record,preferred){
    const actual=record?.generation?.actualInjection;
    const confirmed=actual?.state==='confirmed' && typeof actual.discovery==='string';
    const draft=plan?.discovery || '',dirty=plan?.applied===false;
    const differs=confirmed && draft!==actual.discovery;
    const useDraft=!confirmed || preferred==='draft' || (preferred!=='actual' && dirty);
    return {text:useDraft?draft:actual.discovery,kind:useDraft?(dirty?'草稿 · 未应用':'预计指导'):'实际注入指导',switchable:differs,choice:useDraft?'draft':'actual'};
}
export function installCurrentWorkspace(root,context,settings,flow,refresh,notify){
    const place=root.querySelector('[data-guidance-workspace]'),heading=el('div',undefined,'spark-content-heading'),tools=el('div',undefined,'spark-text-actions');
    const title=el('span','本轮创作指导'),status=el('small'),reader=readingText(''),switcher=el('select');
    reader.dataset.guidanceReader='';status.dataset.guidanceStatus='';switcher.setAttribute('aria-label','创作指导视图');switcher.hidden=true;
    for(const [value,text] of [['draft','当前草稿'],['actual','上次实际指导']]){const o=el('option',text);o.value=value;switcher.append(o);}
    let plan,record,preferred,view,lastPlan,materialsRevision=0;
    const binding=()=>JSON.stringify([flow.chatKey(),settings().world,flow.current()?.turn || flow.run?.turn || context().chat.findLast(m=>m.is_user)?.extra?.[KEY] || null]);
    const copy=action('复制',async()=>{try{await navigator.clipboard.writeText(view.text);notify('已复制'+view.kind);}catch{notify('无法访问剪贴板，请选择指导原文复制',true);}});copy.dataset.copyGuidance='';
    const edit=action('编辑',async()=>{
        const original=binding(),text=view?.text || '';
        await editDialog(context,{title:'本轮创作指导',size:'work',notify,fields:{text:{label:'本轮创作指导',type:'textarea',value:text}},submit:async values=>{
            if(binding()!==original)throw new Error('聊天、轮次或资产来源已变化，修改仍保留在此编辑器；返回原轮次后再保存。');
            flow.editDraft({discovery:values.text});preferred='draft';await refresh();notify('创作指导已保存为草稿');
        }});
    });edit.dataset.editGuidance='';tools.append(copy,edit);heading.append(title,tools);place.append(heading,status,switcher,reader);
    switcher.addEventListener('change',()=>{preferred=switcher.value;draw();});
    const materials=el('details',undefined,'spark-fold');materials.dataset.allMaterials='';materials.append(el('summary','全部注入材料'));
    const materialBody=el('div',undefined,'spark-fold-body');materials.append(materialBody);place.after(materials);
    const draw=()=>{
        view=guidanceView(plan,record,preferred);switcher.hidden=!view.switchable;switcher.value=view.choice;
        status.textContent=view.kind;setReadingText(reader,view.text || '本轮尚无创作指导，可点击编辑。');copy.disabled=!view.text;
    };
    async function drawMaterials(){
        if(!materials.open)return;const revision=++materialsRevision,chat=flow.chatKey(),scroll=root.querySelector('[data-page=current]').scrollTop;
        try{
            const snapshot=await flow.previewInjection();if(revision!==materialsRevision || chat!==flow.chatKey())return;
            const signature=JSON.stringify(snapshot);if(materialBody.dataset.signature===signature)return;
            const expanded=new Set([...materialBody.querySelectorAll('[data-material][open]')].map(n=>n.dataset.injectionIndex));
            materialBody.replaceChildren(el('p','预计注入 · 实际注入记录不可用','spark-hint'));materialBody.dataset.signature=signature;
            renderInjection(materialBody,snapshot,{kind:'expected',notify});for(const d of materialBody.querySelectorAll('[data-material]'))d.open=expanded.has(d.dataset.injectionIndex);
            root.querySelector('[data-page=current]').scrollTop=scroll;
        }catch{if(revision===materialsRevision){materialBody.replaceChildren(el('p','预计材料暂不可用，请检查素材来源。','spark-hint'));delete materialBody.dataset.signature;}}
    }
    materials.addEventListener('toggle',()=>{if(materials.open)void drawMaterials();});
    return {edit:()=>edit.click(),render(next,nextRecord){plan=next;record=nextRecord;if(lastPlan!==plan?.id){preferred=undefined;lastPlan=plan?.id;}draw();void drawMaterials();}};
}
