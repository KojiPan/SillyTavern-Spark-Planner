import { showRequest } from './request-viewer.js';
import { installModelSettings } from './model-settings.js';
import { installAnalysisSettings } from './analysis-settings.js';
import { KEY } from './core.js';
import { installPackManager } from './pack-manager.js';
import { saveChannelKey, models, send, channelUrl } from './channels.js';
import { action, editDialog } from './editor.js';
import { installLibrary } from './library.js';

const el=(tag,text,cls)=>{ const node=document.createElement(tag); if(text!==undefined) node.textContent=text; if(cls) node.className=cls; return node; };
export function download(name,bytes,type='application/octet-stream') {
    const url=URL.createObjectURL(new Blob([bytes],{type})); const a=el('a'); a.href=url; a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function installFeatures(root,context,settings,world,flow,refresh,notify,openNative) {
    const find=s=>root.querySelector(s);
    const save=()=>context().saveSettingsDebounced();
    const idle=()=>{ if(flow.run || document.body.dataset.generating) throw new Error('请等待当前生成结束后管理素材或渠道'); };
    const button=(label,fn)=>{ const b=el('button',label,'spark-button'); b.type='button'; b.addEventListener('click',()=>{if(b.disabled)return;b.disabled=true;void Promise.resolve().then(()=>{idle();return fn();}).catch(e=>notify(e.message,true)).finally(()=>{b.disabled=false;});}); return b; };
    const confirm=(title,text)=>context().Popup.show.confirm(title,text);
    const dialog=(title,fields,submit,label='保存')=>editDialog(context,{title,fields,submit:async v=>{idle();await submit(v);},label,notify});
    const modelSettings=installModelSettings(root,context,settings,flow,refresh,notify);
    const analysisSettings=installAnalysisSettings(root,context,settings,world,flow,refresh,notify);
    const library=installLibrary(root,context,settings,world,flow,notify,openNative,refresh);
    const packManager=installPackManager(root,context,settings,world,flow,refresh,notify,download);

    const channels=el('details',undefined,'spark-card spark-fold'); channels.append(el('summary','独立 Planner 模型渠道'));
    const channelBody=el('div',undefined,'spark-fold-body'); const channelSelect=el('select'); channelSelect.setAttribute('aria-label','Planner 渠道'); channelBody.append(channelSelect);
    channelSelect.addEventListener('change',()=>{settings().channelId=channelSelect.value; save();});
    async function editChannel(existing) {
        const profile=existing || { id:crypto.randomUUID(),name:'Planner 渠道',url:'',model:'',temperature:.7,stream:false,effort:'',exclude:'' };
        await dialog('Planner 渠道',{
            name:{label:'渠道名称',value:profile.name},url:{label:'OpenAI-compatible API 根地址（如 https://host/v1）',value:profile.url},key:{label:'API Key（留空保留；仅存酒馆服务端密钥库）',type:'password'},
            model:{label:'模型名',value:profile.model},temperature:{label:'温度',type:'number',step:'any',min:0,max:2,value:profile.temperature},timeout:{label:'超时（秒）',type:'number',min:5,max:600,value:profile.timeout || settings().timeout},stream:{label:'流式',type:'checkbox',value:profile.stream},effort:{label:'思考强度（渠道支持时）',value:profile.effort},exclude:{label:'排除参数（逗号分隔）',value:profile.exclude},
        },async values=>{
            let channel={...profile,...values,url:channelUrl(values.url),temperature:Number(values.temperature),timeout:Number(values.timeout)}; const key=channel.key; delete channel.key;
            if(channel.secretId && channel.secretUrl!==channel.url && !key) throw new Error('地址已变更，需重新输入密钥');
            channel=await saveChannelKey(context,channel,key);
            settings().channels=(settings().channels || []).filter(c=>c.id!==channel.id).concat(channel); save(); renderChannels();
        });
    }
    const selectedChannel=()=>settings().channels?.find(c=>c.id===channelSelect.value);
    const channelActions=el('div',undefined,'spark-actions'); channelActions.append(button('新增渠道',()=>editChannel()),button('编辑渠道',()=>{
        const channel=selectedChannel(); if(!channel) throw new Error('请先选择独立渠道'); return editChannel(channel);
    }),button('刷新模型列表',async()=>{
        const channel=selectedChannel(); if(!channel) throw new Error('请选择独立渠道');
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),(channel.timeout || settings().timeout)*1000);
        try {
            const list=await models(context,channel,controller.signal);
            await dialog('选择模型',{model:{label:'模型',value:channel.model,options:list.map(id=>[id,id])}},async values=>{channel.model=values.model;save();});
        } finally { clearTimeout(timeout); }
    }),button('测试渠道',async()=>{
        const channel=selectedChannel(); if(!channel) throw new Error('请选择独立渠道');
        const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),(channel.timeout || settings().timeout)*1000);
        try { await send(context,channel,{...settings(),maxTokens:64},[{role:'user',content:'Reply OK.'}],controller.signal); notify('渠道连接测试成功'); }
        finally { clearTimeout(timeout); }
    }),button('删除渠道',async()=>{
        const channel=selectedChannel(); if(!channel || !await confirm('删除渠道','删除配置，服务端密钥仍保留在酒馆密钥库。')) return;
        settings().channels=settings().channels.filter(c=>c.id!==channel.id); settings().channelId=''; save(); renderChannels();
    })); channelBody.append(channelActions,el('p','继承原生完整上下文。请求仅经过你的酒馆服务端与所选 API，密钥不写入聊天、世界书或条目导出。','spark-hint')); channels.append(channelBody); find('[data-page=settings]').append(channels);
    function renderChannels() {
        channelSelect.replaceChildren(); const option=el('option','继承酒馆主模型'); option.value=''; channelSelect.append(option);
        for(const c of settings().channels || []) { const o=el('option',`${c.name} · ${c.model || '未选模型'}`);o.value=c.id;channelSelect.append(o); }
        channelSelect.value=settings().channelId || '';
    }
    renderChannels();

    const safety=el('details',undefined,'spark-card spark-fold'); safety.append(el('summary','备份 / 发现条目 / 调试'));
    const safetyBody=el('div',undefined,'spark-fold-body');
    const discoverySelect=el('select'); discoverySelect.setAttribute('aria-label','本轮分析条目'); safetyBody.append(el('p','本轮分析写入条目（仅限插件拥有的条目）','spark-hint'),discoverySelect);
    discoverySelect.addEventListener('change',async()=>{
        try {idle();settings().discoveryId=discoverySelect.value;save();await refresh();}
        catch(error) {discoverySelect.value=settings().discoveryId || '';notify(error.message,true);}
    });
    safetyBody.append(button('新建分析结果条目',async()=>{
        const name=(await context().Popup.show.input('新建分析结果条目','标题','本轮分析'))?.trim(); if(!name) return;
        const api=await world.api(); let id;
        await world.mutate(data=>{const entry=api.createWorldInfoEntry(settings().world,data);id=crypto.randomUUID();Object.assign(entry,{comment:name,content:'',disable:true,position:4,role:0,depth:0,order:100,probability:100,useProbability:true,[KEY]:{owner:KEY,kind:'discovery',id}});});
        settings().discoveryId=id;save();await refresh();
    }),button('恢复插件条目备份',async()=>{
        const backups=await world.backups(); if(!backups.length) throw new Error('暂无备份');
        await dialog('恢复插件条目备份',{index:{label:'备份时间（只恢复插件条目，普通条目不受影响）',value:'0',options:backups.map((b,i)=>[String(i),b.time])}},async values=>{
            if(!await confirm('恢复备份','将替换当前世界书中的插件条目。')) throw new Error('已取消恢复');
            await world.restoreBackup(Number(values.index));await refresh();
        },'恢复');
    }));
    const debug=el('pre');safetyBody.append(debug);safety.append(safetyBody);find('[data-page=settings]').append(safety);
    function renderHistory() {
        const page=find('[data-page=history]');page.replaceChildren(el('p','当前聊天 · 最近 50 次规划','spark-hint'));
        for(const record of flow.store().history) {
            const card=el('details',undefined,'spark-fold spark-history-record');card.dataset.historyId=record.id;card.append(el('summary',`${record.time} · ${record.status}`));
            const body=el('div',undefined,'spark-fold-body'), actions=el('div',undefined,'spark-text-actions');
            actions.append(action('查看实际请求',async()=>{try{await showRequest(context,record,notify);}catch(e){notify(e.message,true);}}));
            if(record.plan || record.applied)actions.append(button('应用为当前规划',async()=>{await flow.reuse(record.id);await refresh();notify('历史原始选择已恢复；当前不可用项见当前页诊断，未启用创作包保持关闭');}));
            body.append(el('p','Planner 原始选择：'+JSON.stringify(record.parsed?.selected || record.plan?.original?.selected || record.plan?.selected || {}),'spark-hint'));
            body.append(actions);if(record.error)body.append(el('p',record.error,'spark-editor-error'));
            const result=el('details');result.append(el('summary','分析结果'),el('pre',record.applied?.discovery ?? record.plan?.discovery ?? record.parsed?.discovery ?? '无分析结果'));
            const raw=el('details');raw.append(el('summary','原始输出'),el('pre',record.raw || '无输出'));
            const debug=el('details');debug.append(el('summary','诊断'));
            debug.addEventListener('toggle',()=>{if(debug.open && !debug.querySelector('pre'))debug.append(el('pre',JSON.stringify({turn:record.turn,chat:record.chat,selected:record.applied?.selected || record.parsed?.selected,modelResolution:record.modelResolution,diagnostics:record.requestDiagnostics},null,2)));});
            body.append(result,raw,debug);card.append(body);page.append(card);
        }
    }
    return {
        renderHistory,
        async render(skills) {
            await analysisSettings.render();library.render(skills);packManager.render(skills);renderHistory();renderChannels();await modelSettings.render();
            discoverySelect.replaceChildren();
            if(settings().world) {
                const {data}=await world.read();
                for(const e of Object.values(data.entries)) if(e[KEY]?.owner===KEY && e[KEY].kind==='discovery'){const o=el('option',e.comment || '分析结果');o.value=e[KEY].id;discoverySelect.append(o);}
                discoverySelect.value=settings().discoveryId || discoverySelect.options[0]?.value || '';
            }
            debug.textContent=JSON.stringify({extension:'0.6.0',world:settings().world,channel:settings().channelId || 'inherit',running:!!flow.run,history:flow.store().history.length,skills:skills.length},null,2);
        },
    };
}
