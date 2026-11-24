import { KEY } from './core.js';
import { validateSkill, NATIVE_FIELDS } from './skill-pack.js';
import { ecotEntry } from './ecot.js';
import { versionsOf } from './model-versions.js';
import { migratePacks, validatePack } from './packs.js';
import { legacyAnalysisModules, validateAnalysisModule } from './analysis-modules.js';

export class Worldbook {
    constructor(context, settings) { this.context = context; this.settings = settings; }
    async api() {
        // Compatibility boundary: exported WI helpers, absent from getContext().
        return import('/scripts/world-info.js');
    }
    async read() {
        const name = this.settings().world;
        if (!name) throw new Error('请先绑定或创建世界书。');
        const data = await this.context().loadWorldInfo(name);
        if (!data?.entries) throw new Error('绑定世界书不存在或无法读取。');
        return { name, data: structuredClone(data) };
    }
    async fresh(name = this.settings().world) {
        if (!name) throw new Error('请先绑定世界书');
        const response = await fetch('/api/worldinfo/get', { method:'POST', headers:this.context().getRequestHeaders(), body:JSON.stringify({name}), cache:'no-store' });
        if (!response.ok) throw new Error(`世界书读取失败 (${response.status})`);
        const data = await response.json();
        if (!data?.entries || typeof data.entries !== 'object') throw new Error('世界书数据无效');
        return { name, data };
    }
    async mutate(change, expected, name = this.settings().world) {
        const transaction = async () => {
            const { data } = await this.fresh(name);
            const cached=await this.context().loadWorldInfo(name);
            if(cached && JSON.stringify(cached)!==JSON.stringify(data)) throw new Error('世界书缓存与磁盘不同，可能存在未保存编辑；请等待原生保存后刷新素材');
            if (expected && JSON.stringify(data) !== expected) throw new Error('世界书已变化，请重新加载预览后再操作');
            const original = JSON.stringify(data);
            migratePacks(data, this.settings().categories || []);
            const result = await change(data);
            const storage = this.context().accountStorage;
            if (storage) {
                const backups = await this.backups(name);
                backups.unshift({ time:new Date().toISOString(), packs:structuredClone(JSON.parse(original)[KEY]), entries:Object.fromEntries(Object.entries(JSON.parse(original).entries).filter(([,e])=>e[KEY]?.owner === KEY)) });
                await this.backupStore(name,backups.slice(0,3));
            }
            if (JSON.stringify((await this.fresh(name)).data) !== original) throw new Error('检测到并发编辑，已中止写入');
            const response = await fetch('/api/worldinfo/edit', { method:'POST', headers:this.context().getRequestHeaders(), body:JSON.stringify({name,data}) });
            if (!response.ok) throw new Error(`世界书保存失败 (${response.status})`);
            const api = await this.api(); api.worldInfoCache.set(name, structuredClone(data));
            await this.context().eventSource.emit(this.context().eventTypes.WORLDINFO_UPDATED, name, structuredClone(data));
            return result;
        };
        return navigator.locks ? navigator.locks.request(`spark-world:${name}`, transaction) : transaction();
    }
    async entries() {
        await this.packState();
        const { name, data } = await this.read();
        const entries = Object.values(data.entries).filter(e => e[KEY]?.owner === KEY);
        const discovery = entries.find(e=>e[KEY].kind==='discovery' && (!this.settings().discoveryId || e[KEY].id===this.settings().discoveryId));
        return entries.filter(e=>e[KEY].kind !== 'discovery' || e === discovery).map(e => ({ ...e, world: name }));
    }
    async skills() {
        const skills=(await this.entries()).filter(e => e[KEY].kind === 'skill').map(e => ({
            id: e[KEY].id, packId:e[KEY].packId, type: e[KEY].type, title: e.comment || '未命名',
            recommendation: e[KEY].recommendation || '', enabled: e[KEY].enabled !== false,
            versions:e[KEY].versions ? e[KEY].versions.map(v=>v.tagId==null?{...v,body:e.content,recommendation:e[KEY].recommendation || ''}:v) : undefined,
            category: e[KEY].category || '未分类', body: e.content, entry: e, native:Object.fromEntries(NATIVE_FIELDS.filter(k=>e[k]!==undefined).map(k=>[k,e[k]])),
        }));
        if(new Set(skills.map(s=>s.id)).size!==skills.length)throw new Error('创作库存在重复条目 ID，请先检查世界书条目');
        return skills;
    }
    async create(name) {
        if (!name.trim()) throw new Error('世界书名称不能为空。');
        const api = await this.api();
        if (this.context().getWorldInfoNames().includes(name)) throw new Error('同名世界书已存在，请直接绑定。');
        if (!await api.createNewWorldInfo(name)) throw new Error('创建世界书失败。');
        this.settings().world = name;
        this.context().saveSettingsDebounced();
        await this.ensureDiscovery();
    }
    async addSkill(input) {
        return this.upsert({ ...input, id:input.id || crypto.randomUUID() });
    }
    syncEcotEntries(data, api, name) {
        const owned = Object.values(data.entries).filter(e => e[KEY]?.owner === KEY);
        const parents = owned.filter(e => e[KEY].kind === 'skill');
        for (const parent of parents) {
            const meta = parent[KEY];
            const versions = versionsOf({ versions: meta.versions, body: parent.content, recommendation: meta.recommendation });
            const children = owned.filter(e => e[KEY].kind === 'ecot' && e[KEY].skillId === meta.id);
            const needed = meta.type === 'reasoning' && versions.some(v => v.ecotEnabled);
            if (!needed && !children.length) continue;
            let child = children[0];
            if (!child) {
                child = api.createWorldInfoEntry(name, data);
                if (!child) throw new Error(`无法创建「${parent.comment}」的 ECoT Outlet 条目`);
            }
            // One companion per logical entry. The scan resolves its actual version with the parent.
            Object.assign(child, ecotEntry(parent, versions.find(v => v.tagId == null), child));
            for (const duplicate of children.slice(1)) delete data.entries[duplicate.uid];
        }
        for (const child of owned.filter(e => e[KEY].kind === 'ecot')) {
            if (!parents.some(e => e[KEY].id === child[KEY].skillId)) delete data.entries[child.uid];
        }
    }
    async syncEcot() {
        const { name, data } = await this.read(), api = await this.api();
        const original = JSON.stringify(data);
        this.syncEcotEntries(data, api, name);
        if (JSON.stringify(data) !== original) await this.mutate(latest => this.syncEcotEntries(latest, api, name), original, name);
    }
    async upsert(input, expected) {
        const skill = validateSkill(input);
        const api = await this.api();
        const name = this.settings().world;
        return this.mutate(data => {
            let entry = Object.values(data.entries).find(e=>e[KEY]?.owner===KEY && e[KEY].kind==='skill' && e[KEY].id===skill.id);
            skill.packId ||= entry?.[KEY].packId || data[KEY].packs[0].id;
            const pack=data[KEY].packs.find(p=>p.id===skill.packId);
            if(!pack)throw new Error('目标创作包不存在，请重新打开编辑器');
            pack.categories=[...new Set([...pack.categories,skill.category])];
            entry ||= api.createWorldInfoEntry(name, data);
            if (!entry) throw new Error('无法创建条目');
            Object.assign(entry, skill.native, { comment:skill.title, content:skill.body, disable:true,
                [KEY]:{ ...entry[KEY],owner:KEY,kind:'skill',id:skill.id,packId:skill.packId,type:skill.type,category:skill.category,recommendation:skill.recommendation,enabled:skill.enabled,versions:skill.versions } });
            this.syncEcotEntries(data, api, name);
            return skill.id;
        }, expected, name);
    }
    async remove(id) {
        return this.mutate(data => {
            for (const [uid, entry] of Object.entries(data.entries)) if (entry[KEY]?.owner === KEY &&
                (entry[KEY].kind === 'skill' && entry[KEY].id === id || entry[KEY].kind === 'ecot' && entry[KEY].skillId === id)) delete data.entries[uid];
        });
    }
    async category(source, target, packId) {
        return this.mutate(data => {
            const pack=data[KEY].packs.find(p=>p.id===(packId || data[KEY].packs[0].id));
            if(!pack)throw new Error('创作包不存在');
            for (const e of Object.values(data.entries)) if(e[KEY]?.owner===KEY && e[KEY].kind==='skill' && e[KEY].packId===pack.id && (e[KEY].category || '未分类')===source) e[KEY].category=target || '未分类';
            pack.categories=[...new Set(['未分类',...pack.categories.filter(c=>c!==source),target || '未分类'])];
        });
    }
    async importSkills(skills, expected, overwrite = true, newPack, modules = []) {
        const validated = skills.map(validateSkill), api=await this.api();
        const validatedModules=modules.map(validateAnalysisModule);
        const name = this.settings().world;
        return this.mutate(data => {
            if(newPack) {
                const pack=validatePack(newPack);
                if(data[KEY].packs.some(p=>p.id===pack.id) || data[KEY].retiredPackIds?.includes(pack.id))throw new Error('包 ID 已存在或已被删除，请重新预览导入');
                data[KEY].packs.push(pack);
            }
            data[KEY].analysisModules ||= [];
            for(const module of validatedModules) {
                if(!data[KEY].packs.some(p=>p.id===module.packId))throw new Error('分析模块目标创作包不存在');
                const index=data[KEY].analysisModules.findIndex(m=>m.id===module.id);
                if(index>=0 && newPack)throw new Error('分析模块 ID 已存在，请重新预览导入');
                if(index>=0 && !overwrite)continue;
                if(index<0)data[KEY].analysisModules.push(module);else data[KEY].analysisModules[index]=module;
            }
            for(const s of validated) {
                let entry=Object.values(data.entries).find(e=>e[KEY]?.owner===KEY && e[KEY].kind==='skill' && e[KEY].id===s.id);
                if(entry && newPack)throw new Error('条目 ID 已存在，请重新预览导入');
                if(entry && !overwrite) continue;
                s.packId ||= entry?.[KEY].packId || data[KEY].packs[0].id;
                const pack=data[KEY].packs.find(p=>p.id===s.packId);if(!pack)throw new Error('导入目标创作包不存在');
                pack.categories=[...new Set([...pack.categories,s.category])];
                entry ||= api.createWorldInfoEntry(name,data);
                if (!entry) throw new Error('无法创建条目');
                Object.assign(entry,s.native,{comment:s.title,content:s.body,disable:true,[KEY]:{owner:KEY,kind:'skill',id:s.id,packId:s.packId,type:s.type,category:s.category,recommendation:s.recommendation,enabled:s.enabled,versions:s.versions}});
            }
            this.syncEcotEntries(data, api, name);
        },expected,name);
    }
    async packState() {
        const {data}=await this.read(), before=JSON.stringify(data);
        const state=migratePacks(data,this.settings().categories || []);
        if(JSON.stringify(data)!==before)await this.mutate(()=>{},before);
        return structuredClone(state);
    }
    async analysisModules() {
        await this.packState();
        const {name,data}=await this.read();
        if(!data[KEY].analysisModulesMigrated && !this.settings().analysisModulesMigratedWorld) {
            const modules=legacyAnalysisModules(this.settings(),data[KEY].packs[0].id);
            await this.mutate(latest=>{
                if(latest[KEY].analysisModulesMigrated)return;
                latest[KEY].analysisModules ||= [];
                for(const module of modules)if(!latest[KEY].analysisModules.some(m=>m.id===module.id))latest[KEY].analysisModules.push(module);
                latest[KEY].analysisModulesMigrated=true;
            },JSON.stringify(data),name);
        }
        if(this.settings().world!==name)throw new Error('绑定世界书已变化，请重试');
        const current=(await this.read()).data[KEY];
        if(current.analysisModulesMigrated && !this.settings().analysisModulesMigratedWorld) {
            this.settings().analysisModulesMigratedWorld=name;
            this.context().saveSettingsDebounced();
        }
        return structuredClone(current.analysisModules || []);
    }
    async upsertAnalysisModule(raw, expected) {
        const module=validateAnalysisModule(raw);
        await this.mutate(data=>{
            if(!data[KEY].packs.some(p=>p.id===module.packId))throw new Error('目标创作包不存在，请重新打开编辑器');
            const modules=data[KEY].analysisModules ||= [], index=modules.findIndex(m=>m.id===module.id);
            if(expected && JSON.stringify(modules[index])!==expected)throw new Error('分析模块已变化，请重新打开编辑器');
            if(index<0)modules.push(module);else modules[index]=module;
        });
    }
    async removeAnalysisModule(id) {
        await this.mutate(data=>{data[KEY].analysisModules=(data[KEY].analysisModules || []).filter(m=>m.id!==id);});
    }
    async savePack(raw) {
        const pack=validatePack(raw);
        await this.mutate(data=>{
            const index=data[KEY].packs.findIndex(p=>p.id===pack.id);
            if(index<0 && data[KEY].retiredPackIds?.includes(pack.id))throw new Error('该包 ID 已被删除，请使用新 ID');
            if(index<0)data[KEY].packs.push(pack);else data[KEY].packs[index]=pack;
        });
    }
    async defaultPacks(ids) {
        await this.mutate(data=>{data[KEY].defaultEnabledPackIds=[...new Set(ids)].filter(id=>data[KEY].packs.some(p=>p.id===id));});
    }
    async removePack(id) {
        await this.mutate(data=>{
            if(data[KEY].packs.length<=1)throw new Error('至少保留一个创作包');
            const ids=new Set(Object.values(data.entries).filter(e=>e[KEY]?.owner===KEY && e[KEY].kind==='skill' && e[KEY].packId===id).map(e=>e[KEY].id));
            data[KEY].retiredPackIds=[...new Set([...(data[KEY].retiredPackIds || []),id])];
            for(const [uid,e] of Object.entries(data.entries))if(e[KEY]?.owner===KEY && (e[KEY].kind==='skill' && ids.has(e[KEY].id) || e[KEY].kind==='ecot' && ids.has(e[KEY].skillId)))delete data.entries[uid];
            data[KEY].packs=data[KEY].packs.filter(p=>p.id!==id);
            data[KEY].analysisModules=(data[KEY].analysisModules || []).filter(m=>m.packId!==id);
            data[KEY].defaultEnabledPackIds=data[KEY].defaultEnabledPackIds.filter(x=>x!==id);
        });
    }
    backupKey(name) {
        const storage=this.context().accountStorage;
        let scope=storage.getItem('spark-backup-scope');
        if(!scope){scope=crypto.randomUUID();storage.setItem('spark-backup-scope',scope);}
        return `spark-backup:${scope}:${name}`;
    }
    async backups(name=this.settings().world) {
        if(!this.context().accountStorage) return [];
        const key=this.backupKey(name), store=globalThis.SillyTavern?.libs?.localforage;
        return store ? (await store.getItem(key) || []) : JSON.parse(this.context().accountStorage.getItem(key) || '[]');
    }
    async backupStore(name,values) {
        const key=this.backupKey(name), store=globalThis.SillyTavern?.libs?.localforage;
        if(store) await store.setItem(key,values); else this.context().accountStorage.setItem(key,JSON.stringify(values));
    }
    async reload() { const result=await this.fresh();(await this.api()).worldInfoCache.set(result.name,structuredClone(result.data));return result; }
    async restoreBackup(index) {
        const backup=(await this.backups())[index]; if(!backup) throw new Error('备份不存在');
        return this.mutate(data => {
            // Restore owned records only; ordinary entries always keep the latest version.
            for(const [uid,e] of Object.entries(data.entries)) if(e[KEY]?.owner===KEY) delete data.entries[uid];
            for(const source of Object.values(backup.entries)) {
                let uid=Number(source.uid); while(Object.hasOwn(data.entries,uid)) uid++;
                data.entries[uid]={...structuredClone(source),uid,disable:true};
            }
            if(backup.packs)data[KEY]=structuredClone(backup.packs);
            migratePacks(data,this.settings().categories || []);
        });
    }
    async ensureDiscovery(text, name = this.settings().world) {
        const target=this.settings().discoveryId;
        const api = await this.api();
        const id=await this.mutate(data => {
        let entry = Object.values(data.entries).find(e => e[KEY]?.owner === KEY && e[KEY]?.kind === 'discovery' && (!target || e[KEY].id === target));
        if (!entry) {
            entry = api.createWorldInfoEntry(name, data);
            if (!entry) throw new Error('无法创建规划提示条目。');
            Object.assign(entry, { comment: '火花规划器 · 心理发现（镜像）', position: 4, role: 0, depth: 0, order: 100, probability: 100, useProbability: true,
                [KEY]: { owner: KEY, kind: 'discovery', id: crypto.randomUUID() } });
        }
        entry.disable = true;
        if (text !== undefined) entry.content = text;
        return entry[KEY].id;
        },undefined,name);
        if(this.settings().world===name){this.settings().discoveryId=id;this.context().saveSettingsDebounced();}
    }
    async discoveryInsertion(values) {
        const {position,role,depth,order,probability,outletName}=values;
        for(const [key,value,max] of [['position',position,7],['role',role,2],['depth',depth,10000]]) {
            if(!Number.isInteger(value) || value<0 || value>max) throw new Error(`心理发现 ${key} 不合法`);
        }
        if(!Number.isFinite(probability) || probability<0 || probability>100)throw new Error('心理发现 Probability 不合法');
        if(!Number.isFinite(order)) throw new Error('心理发现 Order 不合法');
        if(position===7 && !outletName.trim()) throw new Error('请填写 Outlet 名称');
        await this.mutate(data=>{
            const entry=Object.values(data.entries).find(e=>e[KEY]?.owner===KEY && e[KEY].kind==='discovery' && e[KEY].id===this.settings().discoveryId);
            if(!entry) throw new Error('心理发现条目不存在，请重新绑定世界书');
            Object.assign(entry,{position,role,depth,order,probability,useProbability:true,outletName,disable:true});
        });
    }
    async open(id) {
        const api=await this.api(), name=this.settings().world;
        // Resolve by plugin ID within the bound book. A duplicate comment is never a locator.
        const entry=id?(await this.entries()).find(e=>e[KEY]?.kind==='skill' && e[KEY].id===id):null;
        if(id && !entry)throw new Error('对应条目已不存在，请刷新素材');
        api.openWorldInfoEditor(name);
        if(!entry)return true;
        if(typeof api.showWorldEditor!=='function')return false;
        await api.showWorldEditor(name);
        const jq=globalThis.jQuery;
        if(jq && api.sortWorldInfoEntries && api.worldInfoFilter) {
            const {data}=await this.read();
            const sorted=api.sortWorldInfoEntries(api.worldInfoFilter.applyFilters(Object.values(data.entries)));
            const index=sorted.findIndex(e=>e.uid===entry.uid);
            const perPage=Number(this.context().accountStorage?.getItem('WI_PerPage')) || 25;
            if(index>=0)jq('#world_info_pagination').pagination('go',Math.floor(index/perPage)+1);
        }
        const locate=()=>{
            if(document.querySelector('#world_editor_select option:checked')?.textContent!==name)return null;
            return [...document.querySelectorAll('#world_popup_entries_list [uid]')].find(n=>n.getAttribute('uid')===String(entry.uid));
        };
        let node=locate();
        const entryList=document.querySelector('#world_popup_entries_list');
        if(!node && entryList)node=await new Promise(resolve=>{
            const observer=new MutationObserver(()=>{const found=locate();if(found){clearTimeout(timer);observer.disconnect();resolve(found);}});
            const timer=setTimeout(()=>{observer.disconnect();resolve(null);},2000);observer.observe(entryList,{childList:true,subtree:true});
        });
        if(node){const toggle=node.querySelector('.inline-drawer-toggle');if(toggle && !node.querySelector('.inline-drawer-content')?.checkVisibility())toggle.click();node.scrollIntoView({block:'center'});node.querySelector('textarea[name="comment"]')?.focus({preventScroll:true});}
        return !!node;
    }
}
