import { element as el, action, editDialog } from './editor.js';
import { saveChannelKey, removeChannelKey, models, send, channelUrl, checkChannel } from './channels.js';
import { ModelListLoader } from './model-list.js';

// Only IDs and secret references in memory; never put credentials/model cache in settings.
const cache=new Map(),cacheKey=c=>JSON.stringify([c.id,c.url,c.secretId || '']);
// Provider errors may echo credentials. Map them to fixed, useful explanations.
export function channelTestFailure(error){
    const message=String(error?.message || '');
    if(/401|403|unauthori[sz]ed|forbidden|invalid.*key|authentication/i.test(message))return '认证失败或无访问权限，请检查 API Key。';
    if(/model.*(not found|unavailable|does not exist)|unknown model/i.test(message))return '所选模型不存在或当前密钥无权使用该模型。';
    if(/404|^Not Found$/i.test(message))return '生成接口或模型未找到，请检查 API 根地址与模型 ID。';
    if(/429|quota|rate.limit|credit|balance|Too Many Requests/i.test(message))return '渠道限流或额度不足，请检查服务端账户状态。';
    if(/400|Bad Request/i.test(message))return '生成接口拒绝了请求参数，请检查模型和排除参数。';
    if(/地址已改变/.test(message))return '地址已改变，请重新输入此地址对应的密钥。';
    if(/messages\/model\/stream/.test(message))return '不能排除 messages、model、stream。';
    if(/模型名/.test(message))return '请填写模型 ID。';
    if(/fetch|network|ECONN|Response not OK|50[0234]/i.test(message))return '生成接口请求失败，请检查地址、服务状态及酒馆服务端连接。';
    return '请检查地址、密钥、模型 ID、参数范围及生成接口支持情况。';
}
export function installChannelSettings(root,context,settings,notify){
    const panel=el('details',undefined,'spark-card spark-fold');panel.dataset.settingsSection='channels';panel.append(el('summary','Planner 模型渠道'));
    const body=el('div',undefined,'spark-fold-body'),select=el('select'),list=el('div',undefined,'spark-channel-list');
    select.setAttribute('aria-label','Planner 渠道');list.dataset.channelList='';
    const caption=el('label','当前 Planner 使用的渠道');caption.append(select);body.append(caption,list);
    const save=()=>{context().saveSettingsDebounced();root.dispatchEvent(new Event('spark-settings-refresh'));};
    select.addEventListener('change',()=>{settings().channelId=select.value;save();});
    body.append(action('添加渠道',()=>editChannel()),el('p','仅经酒馆服务端访问渠道；API Key 存在酒馆密钥库。继承主模型时沿用原有行为。','spark-hint'));panel.append(body);root.querySelector('[data-page=settings]').append(panel);
    let renderedChannels;
    function render(){
        const signature=JSON.stringify([settings().channels,settings().channelId]);if(renderedChannels===signature)return;renderedChannels=signature;
        select.replaceChildren();const inherited=el('option','继承酒馆主模型');inherited.value='';select.append(inherited);list.replaceChildren();
        for(const channel of settings().channels || []){
            const option=el('option',channel.name);option.value=channel.id;select.append(option);
            const row=action('',()=>editChannel(channel));row.classList.add('spark-channel-row');row.dataset.channelId=channel.id;
            row.append(el('strong',channel.name),el('small',channel.model || '未选模型'),el('span','›'));list.append(row);
        }
        select.value=settings().channelId || '';
    }
    async function editChannel(existing){
        const profile=structuredClone(existing || {id:crypto.randomUUID(),name:'Planner 渠道',url:'',model:'',temperature:.7,stream:false,effort:'',exclude:''});
        const temporary=new Map();let retained,closed=false,epoch=0,testEpoch=0,debounce,loader,testController,modelStatus;
        let stageQueue=Promise.resolve();
        // New drafts can query/test via a temporary vault reference, without saving a channel.
        const prepare=values=>{
            const draft={...profile,name:values.name,url:channelUrl(values.url),model:values.model,temperature:Number(values.temperature),timeout:Number(values.timeout),stream:values.stream,effort:values.effort,exclude:values.exclude};
            if(!values.key){checkChannel(draft);return Promise.resolve(draft);}
            const fingerprint=JSON.stringify([draft.url,values.key]);
            const pending=stageQueue.then(async()=>{
                if(closed)throw new Error('编辑器已关闭');
                if(!temporary.has(fingerprint))temporary.set(fingerprint,await saveChannelKey(context,draft,values.key));
                return {...draft,secretId:temporary.get(fingerprint).secretId,secretUrl:draft.url};
            });stageQueue=pending.catch(()=>{});return pending;
        };
        try{await editDialog(context,{title:existing?'编辑 Planner 渠道':'添加 Planner 渠道',notify,label:'保存',fields:{
            name:{label:'渠道名称',required:true,value:profile.name},url:{label:'API 根地址（保留所需路径，如 https://host/v1）',required:true,value:profile.url},
            key:{label:profile.secretId?'API Key（已保存，留空保留）':'API Key（仅存酒馆密钥库；无认证接口可留空）',type:'password'},
            model:{label:'模型 ID',required:true,value:profile.model},
            temperature:{label:'温度',type:'number',step:'any',min:0,max:2,required:true,value:profile.temperature ?? .7},
            maxTokens:{label:'最大输出 Token（继承 Planner 参数）',type:'number',value:settings().maxTokens},
            timeout:{label:'超时（秒）',type:'number',min:5,max:600,required:true,value:profile.timeout || settings().timeout},
            effort:{label:'思考强度',value:profile.effort},stream:{label:'流式传输',type:'checkbox',value:profile.stream},exclude:{label:'排除参数（逗号分隔）',value:profile.exclude},
        },submit:async values=>{
            const channel=await prepare(values);checkChannel(channel);
            settings().channels=(settings().channels || []).filter(c=>c.id!==channel.id).concat(channel);retained=channel.secretId;save();render();
        },setup:({body,controls,rows,popup,values,markClean})=>{
            popup.dlg.classList.add('spark-channel-dialog');controls.maxTokens.readOnly=true;controls.maxTokens.tabIndex=-1;
            for(const pair of [['temperature','maxTokens'],['timeout','effort']]){const grid=el('div',undefined,'spark-field-grid');rows[pair[0]].before(grid);for(const key of pair)grid.append(rows[key]);}
            rows.stream.classList.add('spark-inline-toggle');rows.exclude.append(el('small','不支持排除 messages、model、stream。最大输出 Token 始终使用全局 Planner 参数。','spark-hint'));
            const modelRow=rows.model,toolbar=el('div',undefined,'spark-model-toolbar'),refresh=action('刷新模型',()=>refreshModels()),manual=el('input');manual.type='checkbox';manual.checked=true;
            const toggle=el('label','手动输入模型 ID');toggle.append(manual);toolbar.append(refresh,toggle);modelRow.prepend(toolbar);
            const search=el('input');search.type='search';search.placeholder='搜索真实模型 ID';search.setAttribute('aria-label','搜索模型 ID');
            const choices=el('select');choices.setAttribute('aria-label','模型列表');choices.size=5;
            const picker=el('div');picker.append(search,choices);picker.hidden=true;modelRow.append(picker);
            const status=el('p','','spark-hint');status.dataset.modelsStatus='';status.setAttribute('role','status');modelRow.append(status);
            let ids=[];
            const mode=()=>{controls.model.hidden=!manual.checked;picker.hidden=manual.checked;};manual.addEventListener('change',mode);
            const options=()=>{
                const current=controls.model.value,query=search.value.toLocaleLowerCase();choices.replaceChildren();
                const placeholder=el('option',current?`当前：${current}`:'请选择模型');placeholder.value=current;choices.append(placeholder);
                for(const id of ids.filter(id=>id.toLocaleLowerCase().includes(query))){if(id===current)continue;const option=el('option',id);option.value=id;choices.append(option);}
                choices.value=current;
            };
            search.addEventListener('input',options);choices.addEventListener('change',()=>{controls.model.value=choices.value;controls.model.dispatchEvent(new Event('input',{bubbles:true}));options();});controls.model.addEventListener('input',()=>{options();updateStatus();});
            function updateStatus(){
                const state=modelStatus?.state;
                status.textContent=({incomplete:'请填写 API 根地址及必要认证信息；无认证接口可留空 Key。',loading:'正在加载模型…',empty:'未返回可用模型，可手动输入模型 ID。',failed:modelStatus?.message,ready:`已加载 ${ids.length} 个模型${controls.model.value && !ids.includes(controls.model.value)?'；当前模型不在列表中，已保留原值。':'。'}`})[state] || '填写渠道信息后自动获取，也可刷新或手动输入模型 ID。';
                refresh.disabled=state==='loading';
            }
            const changed=result=>{
                modelStatus=result;ids=result.ids;options();updateStatus();
                if(result.state==='ready'){manual.checked=false;mode();}
                else if(result.state!=='loading'){manual.checked=true;mode();}
            };
            loader=new ModelListLoader((channel,signal)=>models(context,channel,signal),result=>{
                changed(result);if(result.state==='ready'){
                    if(cache.size>=32)cache.delete(cache.keys().next().value);
                    cache.set(cacheKey(currentChannel),{ids:result.ids,time:Date.now()});
                }
            });let currentChannel;
            async function refreshModels(){
                clearTimeout(debounce);const revision=++epoch;loader.invalidate();changed({state:'loading',ids:[]});
                try{
                    const channel=await prepare(values());if(closed || revision!==epoch)return;currentChannel=channel;
                    const seconds=Number.isFinite(channel.timeout) && channel.timeout>=5?channel.timeout:Number(settings().timeout) || 20;
                    await loader.refresh(channel,Math.min(30000,seconds*1000));
                }catch{if(!closed && revision===epoch)changed({state:'failed',ids:[],message:'无法加载模型，请检查 API 根地址及密钥；地址变更后需重新输入密钥。可手动填写模型 ID。'});}
            }
            const testStatus=el('p','','spark-hint');testStatus.dataset.channelTestStatus='';testStatus.setAttribute('role','status');body.append(testStatus);
            const test=action('测试渠道',async()=>{
                const revision=testEpoch;testController=new AbortController();let timer;
                testStatus.textContent='测试中：正在检查当前配置的生成接口…';
                try{
                    for(const key of ['url','model','temperature','timeout'])if(!controls[key].checkValidity())throw new Error();
                    const channel=await prepare(values());if(closed || revision!==testEpoch)return;
                    timer=setTimeout(()=>testController.abort(),channel.timeout*1000);
                    const result=await send(context,channel,{...settings(),maxTokens:64},[{role:'user',content:'Reply OK.'}],testController.signal);
                    if(!closed && revision===testEpoch)testStatus.textContent=result?.trim()?'连接成功 · 模型可用性测试通过（生成接口已返回文本）':'连接成功 · 生成接口未返回文本，尚未确认模型可用。';
                }catch(error){if(!closed && revision===testEpoch)testStatus.textContent=testController.signal.aborted?'测试失败：请求超时，请检查超时与渠道配置。':'测试失败：'+channelTestFailure(error);}
                finally{clearTimeout(timer);}
            });
            const footer=el('div',undefined,'spark-channel-footer');
            if(existing)footer.append(action('删除渠道',async()=>{
                if(!await context().Popup.show.confirm('删除渠道','删除渠道配置；已保存密钥仍保留在酒馆密钥库。'))return;
                settings().channels=(settings().channels || []).filter(c=>c.id!==profile.id);if(settings().channelId===profile.id)settings().channelId='';save();render();markClean();await popup.completeCancelled();
            }));footer.append(test);popup.buttonControls.prepend(footer);
            const invalidate=()=>{
                epoch++;loader.invalidate();clearTimeout(debounce);ids=[];search.value='';changed({state:'incomplete',ids:[]});
                testEpoch++;testController?.abort();testStatus.textContent='';
                if(controls.url.value.trim())debounce=setTimeout(()=>void refreshModels(),700);
            };
            for(const key of ['url','key'])controls[key].addEventListener('input',invalidate);
            for(const key of ['model','temperature','timeout','effort','stream','exclude'])controls[key].addEventListener('input',()=>{testEpoch++;testController?.abort();testStatus.textContent='';});
            const cached=cache.get(cacheKey(profile));
            if(cached && Date.now()-cached.time<5*60*1000)changed({state:'ready',ids:cached.ids});
            else if(profile.url)debounce=setTimeout(()=>void refreshModels(),0);
            else changed({state:'incomplete',ids:[]});
        }});}catch{notify('渠道编辑失败，请检查酒馆服务端连接',true);}
        finally{
            closed=true;epoch++;clearTimeout(debounce);loader?.invalidate();testController?.abort();await stageQueue;
            for(const channel of temporary.values())if(channel.secretId!==retained){
                cache.delete(cacheKey(channel));try{await removeChannelKey(context,channel.secretId);}catch{notify('临时密钥清理失败，可在酒馆密钥库删除未保存的 Planner 密钥',true);}
            }
        }
    }
    render();return {render};
}
