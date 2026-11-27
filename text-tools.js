import { installTextStats } from './text-stats.js';
import { installTextareaResize } from './text-resize.js';

// One compact footer belongs to each editable long text, independent of its host.
export function installTextTools(input,context,{target='generation',key,expand,stats=true}={}){
    const resize=installTextareaResize(input,key),counter=stats?installTextStats(input,context,{target}):null;
    const toolbar=document.createElement('div');toolbar.className='spark-text-toolbar';
    const actions=document.createElement('span');actions.className='spark-text-tool-actions';toolbar.append(actions);
    const button=(label,run)=>{const b=document.createElement('button');b.type='button';b.className='spark-button spark-text-button';b.textContent=label;b.addEventListener('click',run);actions.append(b);return b;};
    if(expand)button('放大',expand);
    button('清空',()=>{input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});});
    if(counter)toolbar.append(counter.element);
    input.closest('.spark-textarea-wrap').after(toolbar);
    return {update:()=>counter?.update(),dispose(){counter?.dispose();resize.dispose();toolbar.remove();}};
}
