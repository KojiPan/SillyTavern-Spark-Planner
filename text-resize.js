// One local height preference per editor/field; never persisted into user assets.
const heights=new Map();
export function installTextareaResize(input,key) {
    if(input.readOnly || input.disabled || input.closest('.spark-textarea-wrap'))return {dispose(){}};
    const wrap=document.createElement('div');wrap.className='spark-textarea-wrap';
    input.before(wrap);wrap.append(input);
    const handle=document.createElement('button');handle.type='button';handle.className='spark-resize-handle';
    handle.setAttribute('aria-label','调整文本框高度');handle.title='拖动调整高度；方向键微调';wrap.append(handle);
    if(heights.has(key))input.style.height=`${heights.get(key)}px`;
    const remember=()=>{const h=input.getBoundingClientRect().height;if(input.style.height && h>0)heights.set(key,h);};
    const observer=new ResizeObserver(remember);observer.observe(input);
    let drag;
    const height=value=>{const min=parseFloat(getComputedStyle(input).minHeight) || 80;input.style.height=`${Math.max(min,value)}px`;remember();};
    handle.addEventListener('pointerdown',event=>{
        if(event.button!==0 || !event.isPrimary)return;
        event.preventDefault();event.stopPropagation();drag={y:event.clientY,height:input.getBoundingClientRect().height,id:event.pointerId};handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove',event=>{if(!drag || drag.id!==event.pointerId)return;event.preventDefault();height(drag.height+event.clientY-drag.y);});
    const finish=()=>{drag=null;};handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    handle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();});
    handle.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();height(input.getBoundingClientRect().height+(event.key==='ArrowUp'?-20:20));});
    return {dispose(){observer.disconnect();}};
}
