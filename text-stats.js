import { generationModel } from './model-versions.js';
// Counts Unicode code points, including punctuation, newlines and whitespace.
export const characterCount = text => {
    let count=0;
    for(let i=0;i<text.length;i++,count++)if(text.codePointAt(i)>0xffff)i++;
    return count;
};
export const estimateTokens = text => Math.ceil(characterCount(text) / 3.35);
const cache = new Map();
const format = n => n.toLocaleString('en-US');
const measured = new Map();
export const tokenLabel = ({count,estimated=true}) => `${estimated?'≈':''}Token：${format(count)}`;

export async function countTextTokens(text, context, target = 'generation') {
    if (!text) return 0;
    const c = context(), settings = c.extensionSettings?.spark_planner || {};
    const channel = target === 'planner' ? settings.channels?.find(x=>x.id===settings.channelId) : null;
    if(target==='planner' && settings.channelId && !channel)throw new Error('Planner channel unavailable');
    const model = channel?.model || (await generationModel(context)).modelId || '';
    const key = JSON.stringify([channel?.id, model, c.mainApi, c.powerUserSettings?.tokenizer, text]);
    if (cache.has(key)) return cache.get(key);
    let count;
    // The host API follows the active Generation model, including non-Chat Completion.
    if (!channel && typeof c.getTokenCountAsync === 'function') count = await c.getTokenCountAsync(text, 0);
    else if (channel?.model) {
        // Same local tokenizer endpoint as ST's text encoder, with the consumer's
        // model explicitly selected. No provider/API-key request is made here.
        const response = await fetch(`/api/tokenizers/openai/encode?model=${encodeURIComponent(channel.model)}`, {
            method:'POST', headers:c.getRequestHeaders(), body:JSON.stringify({text}), signal:AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Tokenizer unavailable');
        const result = await response.json();
        count = result.count ?? result.ids?.length;
    }
    if (!Number.isFinite(count) || count <= 0) throw new Error('Tokenizer unavailable');
    if (cache.size >= 64) cache.delete(cache.keys().next().value);
    cache.set(key, count);
    return count;
}

export async function measureTextTokens(text,context,target='generation') {
    if(!text)return {count:0,estimated:false};
    const c=context(),settings=c.extensionSettings?.spark_planner || {},channel=target==='planner'?settings.channels?.find(x=>x.id===settings.channelId):null;
    if(target==='planner' && settings.channelId && !channel)return {count:estimateTokens(text),estimated:true};
    const model=channel?.model || (await generationModel(context)).modelId || '';
    const key=JSON.stringify([target,channel?.id,model,c.mainApi,c.powerUserSettings?.tokenizer,text]);
    if(measured.has(key))return {...measured.get(key)};
    // Native counters may silently estimate (e.g. Gemini uses a Gemma proxy).
    // Only an explicitly supported OpenAI tokenizer with real IDs is exact here.
    const supported=/^(?:gpt-4o(?:-mini)?|gpt-4(?:-turbo|-32k)?|gpt-3\.5-turbo(?:-16k)?)(?:-\d{4}(?:-\d{2}-\d{2})?)?$/;
    let result;
    if((channel || c.mainApi==='openai') && supported.test(model) && c.getRequestHeaders)try {
        const response=await fetch(`/api/tokenizers/openai/encode?model=${encodeURIComponent(model)}`,{method:'POST',headers:c.getRequestHeaders(),body:JSON.stringify({text}),signal:AbortSignal.timeout(5000)});
        if(!response.ok)throw new Error('Tokenizer unavailable');
        const data=await response.json();
        if(!Array.isArray(data.ids) || !data.ids.length)throw new Error('No exact encoding');
        result={count:data.ids.length,estimated:false};
    } catch { /* Retain an explicitly approximate host count below. */ }
    if(!result)try {result={count:await countTextTokens(text,context,target),estimated:true};}catch {result={count:estimateTokens(text),estimated:true};}
    if(measured.size>=64)measured.delete(measured.keys().next().value);
    measured.set(key,result);return {...result};
}

export function installTextStats(input, context, { target = 'generation' } = {}) {
    const stats = document.createElement('small'); stats.className = 'spark-text-stats extension_token_counter';
    stats.id = `spark-stats-${crypto.randomUUID()}`;
    input.setAttribute('aria-describedby', [input.getAttribute('aria-describedby'),stats.id].filter(Boolean).join(' '));
    input.after(stats);
    let timer, revision = 0, disposed = false, running = false, pending = false;
    const display = result => {stats.textContent = tokenLabel(result);};
    const count = async () => {
        if (disposed) return;
        if (running) { pending = true; return; }
        running = true;
        const version = revision, text = input.value;
        try {
            // Avoid expensive tokenization of multi-megabyte drafts on mobile.
            if (text.length > 200000) return;
            const result = await measureTextTokens(text,context,target);
            if (!disposed && version === revision) display(result);
        } catch { /* Keep the explicitly approximate local estimate. */ }
        finally { running = false; if (pending) {pending = false; clearTimeout(timer);timer = setTimeout(count,650);} }
    };
    const update = () => {
        revision++; clearTimeout(timer);
        display({count:estimateTokens(input.value),estimated:!!input.value});
        timer = setTimeout(count,650);
    };
    input.addEventListener('input',update);input.addEventListener('spark-text-refresh',update);update();
    return { element:stats, update, dispose() { disposed = true;clearTimeout(timer);input.removeEventListener('input',update);input.removeEventListener('spark-text-refresh',update); } };
}
