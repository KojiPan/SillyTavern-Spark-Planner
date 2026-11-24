// Presentation only. No stored state, model requests or generation decisions.
export function getViewState({ enabled, planning, generating, error, plan, hasReply, dirty }) {
    let phase = 'waiting';
    if (!enabled) phase = 'off';
    else if (planning) phase = 'planning';
    else if (generating) phase = 'generating';
    else if (error) phase = 'failed';
    else if (plan) phase = hasReply ? 'generated' : 'planned';
    const busy = phase === 'planning' || phase === 'generating';
    return {
        phase,
        label: { off: '未启用', waiting: '等待发送', planning: '规划中', planned: '已规划待生成', generating: '生成正文中', generated: '已生成', failed: '失败' }[phase],
        apply: enabled && !!plan && !!dirty && !busy,
        resume: enabled && !!plan && !hasReply && !dirty && !busy,
        cancel: busy,
        more: enabled && !busy,
    };
}
