// Presentation only. No stored state, model requests or generation decisions.
export function getViewState({ enabled, planning, generating, error, plan, hasReply, dirty, reviewing=false,mode='auto' }) {
    let phase = 'waiting';
    if (!enabled) phase = 'off';
    else if (planning) phase = 'planning';
    else if (reviewing) phase = 'review';
    else if (generating) phase = 'generating';
    else if (error) phase = 'failed';
    else if (plan) phase = plan.applied===false ? 'draft' : hasReply && !plan.next ? 'generated' : 'planned';
    const busy = phase === 'planning' || phase === 'generating';
    return {
        phase,
        label: { off: '未启用', waiting: '空闲', planning: '规划中', review:'等待审核',draft:'有未应用修改',planned: '方案已应用', generating: '正文生成中', generated: '已生成', failed: '失败' }[phase],
        apply: enabled && mode!=='review' && (mode==='manual' || (!!plan && !!dirty)) && !busy,
        resume: enabled && mode!=='manual' && !!plan && (reviewing || ((!hasReply || plan.generationFailed) && (!dirty || mode==='review'))) && !busy,
        cancel: busy || reviewing,
        clear:enabled && mode==='manual' && !busy,
        more: enabled && !busy && mode!=='manual',
    };
}
