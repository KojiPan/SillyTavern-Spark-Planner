import { installTextTools } from './text-tools.js';
// Shared native modal shell. Drafts live in controls until a successful save.
export const element=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export function action(text,run) {
    const b=element('button',text,'spark-button spark-small');b.type='button';
    b.addEventListener('click',async()=>{if(b.disabled)return;b.disabled=true;try{await run();}finally{b.disabled=false;}});return b;
}
let modalCount=0, previousOverflow='';
export async function editDialog(context,{title,fields,submit,notify=()=>{},label='保存',readOnly=false,large=false,size='auto',setup,tokenTarget='generation'}) {
    const c=context(), form=element('div',undefined,'spark-feature-form');
    const header=element('header',undefined,'spark-editor-head'), heading=element('h3',title);
    const body=element('div',undefined,'spark-editor-body'), controls={}, rows={};
    let popup;
    const counters=[];
    header.append(heading);form.append(header,body);
    const values=()=>Object.fromEntries(Object.entries(controls).map(([key,input])=>[key,input.type==='checkbox'?input.checked:input.value]));
    const visibility=()=>{
        for(const [key,spec] of Object.entries(fields))rows[key].hidden=!!spec.when && !spec.when(values());
    };
    for(const [key,spec] of Object.entries(fields)) {
        if(readOnly && !submit) {
            const row=element('section',undefined,'spark-readonly-field'),content=element('pre',String(spec.value ?? ''));
            content.dataset.field=key;row.append(element('strong',spec.label),content);body.append(row);rows[key]=row;continue;
        }
        const row=element('div',undefined,'spark-field'), caption=element('label',spec.label);
        let input=element(spec.options?'select':spec.type==='textarea'?'textarea':'input');
        if(spec.options)for(const [value,text] of spec.options){const o=element('option',text);o.value=value;input.append(o);}
        if(input.tagName==='INPUT')input.type=spec.type || 'text';
        if(input.type==='password')input.autocomplete='off';
        if(input.type==='number')input.step=spec.step ?? '1';
        if(spec.min!==undefined)input.min=spec.min;if(spec.max!==undefined)input.max=spec.max;
        input.required=!!spec.required;
        input.setAttribute('aria-label',spec.label);
        if(input.type==='checkbox')input.checked=!!spec.value;else input.value=spec.value ?? '';
        input.dataset.field=key;controls[key]=input;rows[key]=row;
        if(readOnly){if(['INPUT','TEXTAREA'].includes(input.tagName) && input.type!=='checkbox')input.readOnly=true;else input.disabled=true;}
        caption.append(input);row.append(caption);body.append(row);
        if(spec.type==='textarea') {
            const target=spec.tokenTarget || (key==='recommendation'?'planner':tokenTarget);
            input.rows=spec.rows || 5;input.spellcheck=false;
            if(large)input.classList.add('spark-large-text');
            if(!readOnly)counters.push(installTextTools(input,context,{key:`${title}:${key}:${large?'large':'normal'}`,target,stats:spec.tokens!==false && !['description','groups','model','matches','scope','warnings'].includes(key),expand:large?null:async()=>{
                const scroll=body.scrollTop, start=input.selectionStart,end=input.selectionEnd, textScroll=input.scrollTop;
                await editDialog(context,{title:spec.label,readOnly,large:true,tokenTarget:target,fields:{text:{label:spec.label,type:'textarea',value:input.value}},notify,
                    label:readOnly?'返回':'保存并返回',...(readOnly?{}:{submit:v=>{input.value=v.text;input.dispatchEvent(new Event('input',{bubbles:true}));}})});
                input.focus({preventScroll:true});input.setSelectionRange(start,end);input.scrollTop=textScroll;body.scrollTop=scroll;
            }}));
        }
    }
    form.addEventListener('change',visibility);visibility();
    let baseline, busy=false;
    const error=element('p','', 'spark-editor-error');error.setAttribute('role','alert');body.append(error);
    popup=new c.Popup(form,c.POPUP_TYPE.TEXT,'',{okButton:readOnly && !submit?false:label,cancelButton:readOnly?'返回':'取消',allowVerticalScrolling:true,leftAlign:true,animation:'none',onClosing:async p=>{
        if(busy)return false;
        if(p.result!==c.POPUP_RESULT.AFFIRMATIVE) {
            if(!readOnly && JSON.stringify(values())!==baseline) {
                busy=true;
                try{return !!await c.Popup.show.confirm('放弃未保存修改？','已输入的修改尚未保存。',{okButton:'放弃修改',cancelButton:'继续编辑'});}finally{busy=false;}
            }
            return true;
        }
        busy=true;popup.buttonControls.inert=true;header.inert=true;body.inert=true;
        try {
            if(!readOnly)for(const [key,input] of Object.entries(controls))if(!rows[key].hidden && !input.checkValidity()){input.reportValidity();throw new Error('请检查必填项和数值范围');}
            await submit?.(values());return true;
        } catch(e){error.textContent=e.message;notify(e.message,true);return false;}
        finally{busy=false;popup.buttonControls.inert=false;header.inert=false;body.inert=false;}
    }});
    if(!readOnly)header.append(action('关闭',()=>popup.completeCancelled()));
    popup.dlg.classList.add('spark-feature-dialog','spark-editor-dialog');if(large)popup.dlg.classList.add('spark-text-dialog');
    popup.dlg.classList.add(large || size==='work'?'spark-work-dialog':size==='small' || (Object.keys(fields).length<=3 && !Object.values(fields).some(f=>f.type==='textarea'))?'spark-small-dialog':'spark-auto-dialog');
    popup.dlg.setAttribute('aria-label',title);
    await setup?.({form,body,controls,rows,popup,values,visibility,markClean:()=>{baseline=JSON.stringify(values());}});visibility();baseline=JSON.stringify(values());
    const active=document.activeElement, scrollPositions=[];
    const anchor=active?.closest('[data-skill-card],[data-selected-id],[data-history-id],[data-analysis-module]');
    const anchorAttribute=anchor && [...anchor.attributes].find(a=>['data-skill-card','data-selected-id','data-history-id','data-analysis-module'].includes(a.name));
    const activeText=active?.textContent;
    for(let parent=active?.parentElement;parent;parent=parent.parentElement)scrollPositions.push([parent,parent.scrollTop,parent.scrollLeft]);
    const resize=()=>{
        const v=window.visualViewport, height=v?.height || innerHeight, width=v?.width || innerWidth;
        popup.dlg.style.setProperty('--spark-editor-height',`${height*.9}px`);
        popup.dlg.style.setProperty('--spark-view-width',`${width}px`);
        const rect=popup.dlg.getBoundingClientRect(), actualWidth=rect.width || Math.min(620,width-24);
        const work=popup.dlg.classList.contains('spark-work-dialog'),actualHeight=popup.dlg.getBoundingClientRect().height || Math.min(300,height*.9);
        popup.dlg.style.setProperty('--spark-editor-top',`${(v?.offsetTop || 0)+(work?height*.05:Math.max(height*.05,(height-actualHeight)/2))}px`);
        popup.dlg.style.setProperty('--spark-editor-left',`${(v?.offsetLeft || 0)+Math.max(12,(width-actualWidth)/2)}px`);
    };
    popup.onOpen=resize;
    const observer=new ResizeObserver(resize);observer.observe(popup.dlg);
    resize();window.visualViewport?.addEventListener('resize',resize);window.visualViewport?.addEventListener('scroll',resize);window.addEventListener('resize',resize);
    if(modalCount++===0){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';}
    try{return await popup.show();}
    finally {
        for(const counter of counters)counter.dispose();
        observer.disconnect();
        if(--modalCount===0)document.body.style.overflow=previousOverflow;
        window.visualViewport?.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('scroll',resize);window.removeEventListener('resize',resize);
        if(active?.isConnected)active.focus({preventScroll:true});
        else if(anchorAttribute){const replacement=document.querySelector(`[${anchorAttribute.name}="${CSS.escape(anchorAttribute.value)}"]`);const target=[...replacement?.querySelectorAll('button') || []].find(b=>b.textContent===activeText) || replacement?.querySelector('button');target?.focus({preventScroll:true});}
        for(const [parent,top,left] of scrollPositions){parent.scrollTop=top;parent.scrollLeft=left;}
    }
}

// Reuse only the native modal shell; all reading content scrolls as ordinary DOM.
export const readDialog=(context,{title,render,notify,size='work'})=>editDialog(context,{title,readOnly:true,fields:{},notify,size,setup:({body,popup})=>{
    popup.dlg.classList.add('spark-read-dialog');body.tabIndex=0;return render(body,popup);
}});

// Values follow world_info_position and extension_prompt_roles in this host.
export const INSERT_POSITIONS=[['0','角色定义前'],['1','角色定义后'],['2','作者注前'],['3','作者注后'],['4','聊天内（Depth）'],['5','示例前'],['6','示例后'],['7','Outlet']];
export function insertionFields(native={}) {
    return {
        position:{label:'插入位置',value:native.position ?? 4,options:INSERT_POSITIONS},
        role:{label:'角色',value:native.role ?? 0,options:[['0','System'],['1','User'],['2','Assistant']],when:v=>v.position==='4'},
        depth:{label:'深度（Depth）',type:'number',min:0,max:10000,value:native.depth ?? 0,when:v=>v.position==='4'},
        outletName:{label:'Outlet 名称',value:native.outletName ?? '',required:true,when:v=>v.position==='7'},
        order:{label:'顺序（Order）',type:'number',step:'any',required:true,value:native.order ?? 100},
        probability:{label:'触发概率（%）',type:'number',step:'any',min:0,max:100,required:true,value:native.probability ?? 100},
    };
}
export const insertionValues=v=>({position:Number(v.position),role:Number(v.role),depth:Number(v.depth),outletName:v.outletName,order:Number(v.order),probability:Number(v.probability),useProbability:true});
export const insertionSummary=n=>Number(n?.position ?? 4)===4?`${['System','User','Assistant'][n?.role ?? 0]} D${n?.depth ?? 0}`:INSERT_POSITIONS.find(([v])=>Number(v)===Number(n?.position))?.[1] || '未设置';
