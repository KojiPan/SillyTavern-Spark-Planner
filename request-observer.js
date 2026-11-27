// Observe the serialized browser→Tavern boundary without modifying arguments,
// response consumption, cancellation or any Tavern core code.
export function installRequestObserver(flow,target=globalThis){
    const original=target.fetch;
    const wrapped=function(input,init){
        let receipt;
        try{
            const path=new URL(typeof input==='string'?input:input.url || input.href,target.location?.href || 'http://localhost').pathname;
            if(init?.method?.toUpperCase()==='POST' && typeof init.body==='string' && /^\/api\/(?:backends\/(?:chat-completions|text-completions|kobold)|novelai)\/generate$/.test(path))receipt=flow.observeTransport(init.body);
        }catch{ /* Observation must never affect transport. */ }
        const pending=original.call(this,input,init);
        if(receipt)Promise.resolve(pending).then(response=>{try{flow.observeTransportResult(receipt,response.status);}catch{}},()=>{try{flow.observeTransportResult(receipt,null);}catch{}});
        return pending;
    };
    target.fetch=wrapped;
    return ()=>{if(target.fetch===wrapped)target.fetch=original;};
}
