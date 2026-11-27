// A scroll gesture never doubles as either a tap or a long press.
export function selectedEntryActions(button, { view, edit }) {
    let timer, origin, suppress = false, touch = false;
    const clear = () => {clearTimeout(timer);timer = null;};
    const cancel = () => {if(origin)suppress=true;clear();origin=null;};
    button.addEventListener('pointerdown', event => {
        touch=event.pointerType === 'touch' || event.pointerType === 'pen';
        if (!event.isPrimary || event.button !== 0) return;
        clear();suppress=false;origin={x:event.clientX,y:event.clientY};
        if (touch) timer=setTimeout(()=>{
            if (!origin) return;
            suppress=true;origin=null;void edit();
        },550);
    });
    button.addEventListener('pointermove', event => {
        if(origin && Math.hypot(event.clientX-origin.x,event.clientY-origin.y)>10)cancel();
    });
    button.addEventListener('pointerup',()=>{clear();origin=null;});
    button.addEventListener('pointercancel',cancel);
    button.addEventListener('pointerleave',cancel);
    // Listen on the scroll container only, so detached chips have no global listeners.
    const page=button.closest('[data-page]');
    button.addEventListener('click',event=>{
        clear();if(suppress){event.preventDefault();suppress=false;return;}void view();
    });
    button.addEventListener('keydown',event=>{if(event.key==='F2'){event.preventDefault();clear();void edit();}});
    button.addEventListener('contextmenu',event=>{
        event.preventDefault();
        // Some mobile browsers fire contextmenu before our timer. Suppress their
        // native menu without cancelling the pending long press or opening twice.
        if(touch || event.pointerType==='touch')return;
        clear();origin=null;suppress=true;void edit();
    });
    // Scroll dispatches on the page before a pending long press can fire.
    const onScroll=()=>{if(origin)cancel();};
    page?.addEventListener('scroll',onScroll,{passive:true});
    return ()=>{clear();page?.removeEventListener('scroll',onScroll);};
}
