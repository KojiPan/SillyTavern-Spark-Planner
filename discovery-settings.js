import { KEY } from './core.js';
import { editDialog, insertionFields, insertionValues, insertionSummary } from './editor.js';

export function installDiscoverySettings(panel, context, settings, world, flow, notify) {
    const button=panel.querySelector('[data-discovery-edit]'), summary=panel.querySelector('[data-discovery-insertion-summary]');
    let rendering=0;
    async function render() {
        const version=++rendering;
        const entry=settings().world?(await world.entries()).find(e=>e[KEY]?.kind==='discovery'):null;
        if(version!==rendering)return;
        button.disabled=!entry || !!flow.run;
        summary.textContent=entry?insertionSummary(entry):'请先绑定世界书';
    }
    button.addEventListener('click',()=>void (async()=>{
        if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束');
        await world.reload();
        const entry=(await world.entries()).find(e=>e[KEY]?.kind==='discovery');
        if(!entry)throw new Error('本轮分析条目不存在，请重新绑定世界书');
        await editDialog(context,{title:'本轮分析插入设置',fields:insertionFields(entry),notify,submit:async v=>{
            if(flow.run || document.body.dataset.generating)throw new Error('请等待当前生成结束');
            await world.discoveryInsertion(insertionValues(v));await render();notify('本轮分析插入设置已保存到原生世界书条目');
        }});
    })().catch(e=>notify(e.message,true)));
    return render;
}
