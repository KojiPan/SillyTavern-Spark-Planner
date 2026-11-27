// An editor owns one loader. Invalidation happens on input, before debounce.
export class ModelListLoader {
    constructor(load,changed){this.load=load;this.changed=changed;this.revision=0;}
    invalidate(){this.revision++;this.controller?.abort();clearTimeout(this.timer);}
    async refresh(channel,timeout=20000){
        this.invalidate();const revision=this.revision,controller=this.controller=new AbortController();
        this.changed({state:'loading',ids:[]});
        this.timer=setTimeout(()=>controller.abort(),timeout);
        try {
            const ids=await this.load(channel,controller.signal);
            if(revision===this.revision)this.changed({state:ids.length?'ready':'empty',ids});
        }catch(error){if(revision===this.revision)this.changed({state:'failed',ids:[],message:controller.signal.aborted?'模型列表请求超时，请刷新或手动输入模型 ID':error.message});}
        finally{if(revision===this.revision)clearTimeout(this.timer);}
    }
}
