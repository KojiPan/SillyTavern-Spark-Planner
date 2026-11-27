import { element as el, action } from './editor.js';

export function installSettingsDirectory(root,settings){
    const page=root.querySelector('[data-page=settings]'),directory=el('div');directory.dataset.settingsDirectory='';
    const definitions=[
        ['模型与运行',[
            ['Planner 模型渠道','Planner 模型渠道',()=>settings().channelId?(settings().channels?.find(c=>c.id===settings().channelId)?.name || '渠道不可用'):'继承酒馆主模型'],
            ['Planner 参数','Planner 参数',()=>`${settings().contextMode==='standalone'?'独立默认预设':'沿用酒馆预设'} · ${settings().maxTokens} tokens`],
            ['模型匹配','模型匹配',()=>`${settings().modelTags?.length || 0} 个模型标签`],
        ]],
        ['提示词与注入',[
            ['任务提示词','Planner 任务提示词',()=> '编辑各段提示词与恢复默认文案'],
            ['本轮分析','创作指导插入位置',()=>root.querySelector('[data-discovery-insertion-summary]')?.textContent || '读取中'],
        ]],
        ['高级设置',[
            ['世界书注入配置','世界书注入配置',()=>`${settings().world || '未绑定'}${settings().world?' · '+(/不存在|异常/.test(root.querySelector('[data-carrier-status]')?.textContent || '')?'需检查':'已就绪'):''}`],
            ['备份与恢复','备份与恢复',()=> '恢复插件条目备份'],
            ['调试与诊断','调试与诊断',()=> '分析条目、镜像修复及运行诊断'],
            ['历史保留与清理','历史保留与清理',()=> `保留最近 ${settings().historyLimit || 50} 条`],
        ]],
    ];
    const summaries=[];
    for(const [group,items] of definitions){
        const section=el('section',undefined,'spark-settings-group');section.append(el('h3',group));directory.append(section);
        for(const [original,title,summary] of items){
            const content=[...page.querySelectorAll(':scope > details')].find(d=>d.querySelector(':scope > summary')?.textContent===original);
            if(!content)continue;
            const detail=el('section',undefined,'spark-settings-detail');detail.hidden=true;detail.dataset.settingsDetail=title;
            const back=action('‹ 返回设置',()=>{detail.hidden=true;directory.hidden=false;page.scrollTop=0;entry.focus();});
            detail.append(back,el('h3',title),content);content.open=true;
            const entry=action('',()=>{directory.hidden=true;detail.hidden=false;page.scrollTop=0;back.focus();});entry.classList.add('spark-settings-entry');
            const copy=el('span'),value=el('small');copy.append(el('strong',title),value);entry.append(copy,el('span','›'));section.append(entry);page.append(detail);
            summaries.push(()=>{value.textContent=summary();});
        }
    }
    const carrier=root.querySelector('[data-carrier-status]');if(carrier)page.querySelector('[data-settings-detail="世界书注入配置"]').append(carrier);
    page.prepend(directory);const render=()=>summaries.forEach(update=>update());render();
    root.addEventListener('spark-settings-refresh',render);root.addEventListener('change',render);return {render};
}
