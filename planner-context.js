import { currentTurn } from './core.js';

export const DEFAULT_PLANNER_PRESET = '你是互动叙事的规划者。根据提供的角色、世界信息、用户人设、聊天记录和当前玩家输入，判断本轮适用的 Reasoning Skill 与火花，并提炼心理发现。保持人物的性格、认知和知情边界；缺少的信息保持未知。候选目录中的推荐条件用于选择素材，正文生成由后续任务完成。按照最后一条用户消息的任务与输出格式完成规划。';

// A round starts at a player message and contains all following character replies.
// Orphan greetings and unanswered player messages do not count as complete rounds.
export function recentRounds(chat, count = 10) {
    return roundMessages(chat,count).map(message => ({ role: message.is_user ? 'user' : 'assistant', content: message.mes }));
}

function roundMessages(chat, count) {
    const current = currentTurn(chat);
    const end = chat.lastIndexOf(current);
    const rounds = [];
    let round;
    for (const message of chat.slice(0, end)) {
        if (message.is_system || !message.mes?.trim()) continue;
        if (message.is_user) {
            if (round?.length > 1) rounds.push(round);
            round = [message];
        } else if (round) round.push(message);
    }
    if (round?.length > 1) rounds.push(round);
    return rounds.slice(-count).flat();
}

export async function standaloneContext(context, settings) {
    const c = context(), fields = c.getCharacterCardFields();
    const history = recentRounds(c.chat);
    const player = currentTurn(c.chat), input = player?.mes;
    const wi = await import('/scripts/world-info.js');
    const scan=[...roundMessages(c.chat,10),player].filter(Boolean).map(message=>wi.world_info_include_names && message.name ? `${message.name}: ${message.mes}` : message.mes).reverse();
    const result = await wi.getWorldInfoPrompt(scan, 52000, true, {
        personaDescription: fields.persona, characterDescription: fields.description,
        characterPersonality: fields.personality, characterDepthPrompt: fields.charDepthPrompt,
        scenario: fields.scenario, creatorNotes: fields.creatorNotes, trigger: 'normal',
    });
    const messages = [];
    const add = (label, text) => { if (text?.trim()) messages.push({ role: 'system', content: label ? `${label}\n${text}` : text }); };
    add('', settings.plannerPreset ?? DEFAULT_PLANNER_PRESET);
    add('当前角色信息', [fields.description, fields.personality, fields.scenario, fields.mesExamples, fields.charDepthPrompt].filter(Boolean).join('\n\n'));
    add('当前有效世界书', [result.worldInfoBefore, result.worldInfoAfter,
        ...result.worldInfoExamples.map(e => e.content), ...result.worldInfoDepth.flatMap(e => e.entries),
        ...result.anBefore, ...result.anAfter, ...Object.values(result.outletEntries).flat()].filter(Boolean).map(text => c.substituteParams(text)).join('\n\n'));
    add('用户人设', fields.persona);
    messages.push(...history);
    if (input?.trim()) messages.push({ role: 'user', content: input });
    return messages;
}

export function withPlannerTask(messages, prompt) {
    return [...structuredClone(messages), { role: 'user', content: prompt }];
}

// Snapshot at the native final request boundary, immediately before serialization.
// No keys, channel URLs or other connection settings are included.
export function inspectPlannerRequest(messages, settings, inspect = () => {}, data = {}, boundary = 'native-settings-ready') {
    if (messages.at(-1)?.role !== 'user') throw new Error('Planner 最终消息不是 User，已停止请求');
    // Explicit allowlist: never persist connection URLs, credentials, secret IDs or custom bodies.
    const parameters=Object.fromEntries(['model','chat_completion_source','stream','max_tokens','max_completion_tokens','temperature','top_p','top_k','min_p','seed','frequency_penalty','presence_penalty','repetition_penalty','reasoning_effort','stop','custom_prompt_post_processing'].filter(k=>data[k]!==undefined).map(k=>[k,structuredClone(data[k])]));
    const snapshot = { schemaVersion:1, capturedAt:new Date().toISOString(), boundary,
        boundaryNote:boundary==='native-settings-ready'?'原生 CHAT_COMPLETION_SETTINGS_READY 最后处理器，浏览器序列化前；其他扩展后续处理及服务端供应商适配不在观测范围内。':'ChatCompletionService.sendRequest 调用前；官方接口直接序列化消息，服务端供应商适配不在观测范围内。',
        mode: settings.contextMode || 'native', plannerModelId:typeof data.model==='string'?data.model:null,
        messages: structuredClone(messages), latestRole: messages.at(-1).role, parameters,
        transportNotes:data.custom_include_body || data.custom_exclude_body ? ['存在额外请求体或排除参数配置；内容未保存，其中的服务端处理可能改变供应商最终请求。'] : [] };
    inspect(snapshot);
}
