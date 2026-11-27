// Small shared UI primitives; colors remain entirely owned by the Tavern theme.
export function moreMenu(label='更多'){
    const menu=document.createElement('details');menu.className='spark-more-menu';menu.dataset.moreMenu='';
    const summary=document.createElement('summary');summary.textContent=label;summary.setAttribute('aria-label',label);summary.setAttribute('aria-haspopup','menu');
    const content=document.createElement('div');content.className='spark-menu-items';content.setAttribute('role','menu');menu.append(summary,content);
    content.addEventListener('click',event=>{if(event.target.closest('button') && !event.target.closest('button').disabled)menu.open=false;});
    menu.addEventListener('focusout',event=>{if(event.relatedTarget && !menu.contains(event.relatedTarget))menu.open=false;});
    summary.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp'].includes(event.key))return;event.preventDefault();menu.open=true;const buttons=[...content.querySelectorAll('button:not([hidden]):not(:disabled)')];buttons[event.key==='ArrowDown'?0:buttons.length-1]?.focus();});
    content.addEventListener('keydown',event=>{if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...content.querySelectorAll('button:not([hidden]):not(:disabled)')],index=buttons.indexOf(document.activeElement);buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();});
    return {menu,content};
}
let menusInstalled=false;
export function installMenuDismissal(){
    if(menusInstalled)return;menusInstalled=true;
    document.addEventListener('pointerdown',event=>{for(const menu of document.querySelectorAll('[data-more-menu][open]'))if(!menu.contains(event.target))menu.open=false;});
    document.addEventListener('keydown',event=>{if(event.key!=='Escape')return;const top=[...document.querySelectorAll('dialog[open]')].at(-1);const open=[...document.querySelectorAll('[data-more-menu][open]')].filter(menu=>!top || top.contains(menu));if(!open.length)return;event.preventDefault();event.stopImmediatePropagation();for(const menu of open){menu.open=false;menu.querySelector('summary').focus({preventScroll:true});}},true);
}
export function readingText(text){
    const div=document.createElement('div');div.className='spark-reading';setReadingText(div,text);return div;
}
let markdown;
export function setReadingText(node,text){
    text=String(text || '');if(node.sparkRaw===text)return;node.sparkRaw=text;
    const libs=globalThis.SillyTavern?.libs;
    if(libs?.showdown && libs?.DOMPurify){
        markdown ||= new libs.showdown.Converter({tables:true,strikethrough:true,simpleLineBreaks:true});
        node.innerHTML=libs.DOMPurify.sanitize(markdown.makeHtml(text),{ALLOWED_TAGS:['p','br','h1','h2','h3','h4','h5','h6','ul','ol','li','strong','em','del','blockquote','code','pre','hr','a','table','thead','tbody','tr','td','th'],ALLOWED_ATTR:['href','title']});node.classList.add('spark-markdown');
    }else node.textContent=text;
}
