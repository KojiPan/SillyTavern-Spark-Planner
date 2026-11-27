import test from 'node:test';
import assert from 'node:assert/strict';
import { KEY, DEFAULT_PROMPTS, freezeCatalog, plannerPrompt, parsePlanner, overlayLore } from '../core.js';
import { Workflow } from '../workflow.js';
import { RegenerateRecovery } from '../recovery.js';

const skills = [
    { id: 'r1', type: 'reasoning', title: '视角', body: '判断', enabled: true },
    { id: 's1', type: 'spark', title: '拥抱', body: '正文私有素材XYZ', enabled: true },
    { id: 'hidden', type: 'spark', title: '不可见', enabled: false },
];
function fixture({ autoContinue = true, raw = '[reasoning skill:001]\n[spark:001]\n保持人物视角。' } = {}) {
    const config = { enabled: true, autoContinue, prompts: { ...DEFAULT_PROMPTS }, world: 'book', timeout: 5, maxTokens: 1000, reasoningLimit: 5 };
    let calls = 0;
    const listeners = new Map();
    const c = { mainApi: 'openai', eventTypes: { CHAT_COMPLETION_SETTINGS_READY: 'ready' }, eventSource: {
        makeLast: (event,fn) => listeners.set(event,fn), removeListener: event => listeners.delete(event),
    }, characterId: 0, chatId: 'chat-a', chat: [{ is_user: true, mes: '（抱住哥哥）好喜欢哥哥哦。' }], chatMetadata: {},
        saveChat: async () => {}, saveMetadataDebounced: () => {}, deactivateSendButtons: () => {}, stopGeneration: () => {},
        reloadCurrentChat: async () => {},
        generateQuietPrompt: async () => { calls++; return raw; },
    };
    const entries = skills.filter(s => s.enabled).map((s, uid) => ({ uid, world: 'book', content: s.body, disable: true, position: uid ? 7 : 4, role: 0, depth: 0, outletName: uid ? 'koji_cot' : '', [KEY]: { owner: KEY, kind: 'skill', id: s.id } }));
    entries.push({ uid: 3, world: 'book', content: '', disable: true, position: 4, depth: 0, [KEY]: { owner: KEY, kind: 'discovery' } });
    const world = { skills: async () => structuredClone(skills), ensureDiscovery: async () => {}, entries: async () => structuredClone(entries) };
    const notices = [];
    const flow = new Workflow(() => c, () => config, world, (...args) => notices.push(args));
    return { flow, c, config, world, entries, notices, calls: () => calls() };
}

test('catalog excludes disabled, numbers each type, does not expose internal IDs or bodies', () => {
    const catalog = freezeCatalog(skills);
    skills[0].title = '修改后的标题';
    assert.equal(catalog.reasoning[0].title, '视角');
    assert.equal(catalog.spark.length, 1);
    assert.equal(catalog.spark[0].number, '001');
    const prompt = plannerPrompt(catalog, DEFAULT_PROMPTS, 5);
    assert.ok(!prompt.includes('不可见'));
    assert.ok(!prompt.includes('r1'));
    assert.ok(!prompt.includes('正文私有素材XYZ'));
});

test('parser tolerates fullwidth punctuation, duplicates, bad IDs and enforces caps', () => {
    const catalog = freezeCatalog(Array.from({ length: 8 }, (_, i) => ({ id: String(i), type: 'spark', title: 'x' })));
    const parsed = parsePlanner('［ spark ：001，001,999,abc,002,003,004］\n[Reasoning_Skill: ]\n发现', catalog);
    assert.deepEqual(parsed.selected.spark, ['0', '1', '2']);
    assert.equal(parsed.discovery, '');
    assert.equal(parsed.warnings.length, 4);
});

test('empty choices and missing markers are valid; empty API response is an error', () => {
    const catalog = freezeCatalog(skills);
    assert.deepEqual(parsePlanner('[spark:] [reasoning skill:]指导', catalog).selected, { reasoning: [], spark: [] });
    assert.equal(parsePlanner('只有指导', catalog).discovery, '');
    assert.throws(() => parsePlanner('', catalog));
});

test('native quiet called once, original input remains once, outer generation continues', async () => {
    const { flow, c } = fixture();
    let calls = 0, aborted = false;
    c.generateQuietPrompt = async options => {
        calls++;
        assert.equal(options.skipWIAN, false);
        assert.equal(options.quietPrompt, '', 'task must not enter the native System quiet prompt');
        await flow.intercept(c.chat, 8000, () => { throw new Error('quiet aborted'); }, 'quiet');
        return '[reasoning skill:001][spark:001]<guidance>发现</guidance>';
    };
    await flow.intercept(c.chat, 8000, () => { aborted = true; }, 'normal');
    assert.equal(calls, 1); assert.equal(aborted, false);
    assert.equal(c.chat.length, 1); assert.equal(flow.active.discovery, '发现');
    assert.equal(flow.store().history[0].status, 'applied');
});

test('review retains the original generation; only planning aborts and resumes without planning', async () => {
    for (const mode of ['review', 'only']) {
        const { flow, config, c } = fixture();
        config.autoContinue = mode !== 'review'; flow.only = mode === 'only';
        let aborts = 0, calls = 0;
        c.generateQuietPrompt = async () => { calls++; return '[spark:]指导'; };
        const execution=flow.intercept(c.chat, 1, () => { aborts++; }, 'normal');
        if(mode==='review') {
            while(!flow.pending)await new Promise(r=>setImmediate(r));
            assert.equal(flow.active,null);assert.equal(aborts,0);assert.equal(flow.current().applied,false);
            await flow.resume();await execution;assert.ok(flow.active);assert.equal(calls,1);continue;
        }
        await execution;assert.equal(aborts, 1); assert.equal(flow.active, null);
        await flow.intercept(c.chat, 1, () => { aborts++; }, 'regenerate');
        assert.equal(calls, 1); assert.equal(aborts, 1); assert.ok(flow.active);
        assert.equal(c.chat.length, 1);
    }
});

test('swipe reuses snapshot; new user does not inherit prior planning', async () => {
    const { flow, c } = fixture();
    let calls = 0;
    c.generateQuietPrompt = async () => { calls++; return '[spark:001]<guidance>发现</guidance>'; };
    await flow.plan();
    c.chat.push({ mes: '正文', is_user: false, swipes: ['正文'] });
    await flow.intercept(c.chat, 1, assert.fail, 'swipe');
    assert.equal(calls, 1); assert.equal(flow.active.discovery, '发现');
    c.chat.push({ is_user: true, mes: '新的一轮' });
    await flow.intercept(c.chat, 1, assert.fail, 'regenerate');
    assert.equal(flow.active, null);
    c.chat.pop(); c.chat.pop(); c.chat[0].mes = '编辑玩家输入';
    assert.equal(flow.current(), null);
});

test('API failure aborts and invalidates previous snapshot with visible error', async () => {
    const { flow, c, notices } = fixture();
    await flow.plan();
    c.generateQuietPrompt = async () => { throw new Error('network'); };
    await assert.rejects(flow.plan(), /network/);
    assert.equal(flow.current(), null);
    let aborted = false;
    await flow.intercept(c.chat, 1, () => { aborted = true; }, 'normal');
    assert.ok(aborted); assert.ok(notices.some(([s]) => s.includes('network')));
    assert.equal(flow.store().history[0].status, 'failed');
});

test('late reply on chat switch or disable cannot apply', async () => {
    for (const change of ['chat', 'off']) {
        const { flow, c, config } = fixture();
        let resolve;
        c.generateQuietPrompt = () => new Promise(r => { resolve = r; });
        const pending = flow.plan();
        while (!resolve) await new Promise(r => setImmediate(r));
        if (change === 'chat') { c.chatId = 'chat-b'; c.chatMetadata = {}; } else config.enabled = false;
        flow.cancel(); resolve('[spark:001]过期输出');
        await assert.rejects(pending, /取消/);
        assert.equal(flow.current(), null);
        assert.equal(flow.active, null);
    }
});

test('WI scan preserves ordinary entries, placement and real Outlet; no persisted enable mutation', () => {
    const { entries } = fixture();
    const ordinary = { uid: 77, content: '普通世界书', position: 1 };
    const lore = { chatLore: [], globalLore: [ordinary, structuredClone(entries[0])], characterLore: [], personaLore: [] };
    const plan = { selected: { reasoning: ['r1'], spark: ['s1'] }, discovery: '本轮发现' };
    overlayLore(lore, entries, plan, true);
    assert.equal(lore.globalLore.length, 1); assert.equal(lore.globalLore[0], ordinary);
    assert.equal(lore.chatLore.length, 3);
    assert.equal(lore.chatLore[1].position, 7); assert.equal(lore.chatLore[1].outletName, 'koji_cot');
    assert.equal(lore.chatLore[0].depth, 0); assert.equal(lore.chatLore[0].role, 0);
    assert.ok(entries.every(e => e.disable));
    overlayLore(lore, entries, plan, false);
    assert.equal(lore.chatLore.length, 0); assert.equal(lore.globalLore.length, 1);
});

test('failed regenerate restores all old swipes; success and switched chats are untouched', async () => {
    const { c } = fixture();
    const original = { is_user: false, mes: '旧正文', swipes: ['旧正文', '旧候选'], swipe_id: 0, extra: { arbitrary: 'keep' } };
    c.chat.push(structuredClone(original));
    let key = 'a';
    const recovery = new RegenerateRecovery(() => c, () => key, () => true, () => {});
    recovery.start('regenerate', false); c.chat.pop();
    assert.equal(await recovery.finish(), true); assert.deepEqual(c.chat[1], original);
    recovery.start('regenerate', false); c.chat[1] = { mes: '新正文' }; recovery.received();
    assert.equal(await recovery.finish(), false); assert.equal(c.chat[1].mes, '新正文');
    recovery.start('regenerate', false); key = 'b'; c.chat = [];
    assert.equal(await recovery.finish(), false); assert.deepEqual(c.chat, []);
});

test('manual apply accepts selections above the AI cap', async () => {
    const { flow, entries } = fixture();
    for(let i=0;i<4;i++)entries.push({...structuredClone(entries[1]),[KEY]:{owner:KEY,kind:'skill',id:'manual-'+i}});
    flow.editDraft({selected:{reasoning:[],spark:['manual-0','manual-1','manual-2','manual-3']}});
    const plan=await flow.apply();assert.equal(plan.selected.spark.length,4);
});

test('chat switch during native discovery refresh cannot reactivate the previous chat plan',async()=>{
    const {flow,c,world,entries}=fixture();await flow.plan();
    let resolve;
    world.entries=()=>new Promise(r=>{resolve=r;});
    let aborted=false;
    const pending=flow.intercept(c.chat,1,()=>{aborted=true;},'swipe');
    while(!resolve)await new Promise(r=>setImmediate(r));
    c.chatId='other-chat';c.chatMetadata={};flow.cancel();resolve(structuredClone(entries));
    await pending;assert.equal(flow.active,null);assert.equal(aborted,true);
});

test('Planner parses the sent catalog and limit after live material and configuration edits',async()=>{
    const {flow,c,config,world,entries}=fixture();
    let finish;
    c.generateQuietPrompt=()=>new Promise(resolve=>{finish=resolve;});
    const pending=flow.plan();while(!finish)await new Promise(resolve=>setImmediate(resolve));
    assert.equal(flow.run.catalog.reasoning[0].id,'r1');
    config.reasoningLimit=0;config.prompts.task='EDITED_TASK';
    world.skills=async()=>[{id:'inserted',type:'reasoning',title:'插入到目录开头',body:'new'},...skills];
    entries[0].content='NEW_BODY';
    finish('[reasoning skill:001][spark:]分析');
    const plan=await pending;
    assert.deepEqual(plan.selected.reasoning,['r1']);
    await flow.intercept(c.chat,1,assert.fail,'swipe');assert.equal(flow.active.entries[0].content,'NEW_BODY');
});
