import test from 'node:test';
import assert from 'node:assert/strict';
import { getViewState } from '../view-state.js';
test('seven presentation states and meaningful primary actions', () => {
    for (const [input, phase] of [
        [{ enabled: false }, 'off'], [{ enabled: true }, 'waiting'],
        [{ enabled: true, planning: true }, 'planning'],
        [{ enabled: true, plan: {} }, 'planned'],
        [{ enabled: true, generating: true }, 'generating'],
        [{ enabled: true, plan: {}, hasReply: true }, 'generated'],
        [{ enabled: true, error: true }, 'failed'],
    ]) assert.equal(getViewState(input).phase, phase);
    assert.ok(getViewState({ enabled: true, plan: {} }).resume);
    assert.ok(!getViewState({ enabled: true, plan: {}, dirty: true }).resume);
    assert.ok(getViewState({ enabled: true, plan: {}, dirty: true }).apply);
    assert.ok(!getViewState({ enabled: true, plan: {}, hasReply: true }).resume);
    assert.ok(!getViewState({ enabled: true, planning: true }).more);
    assert.ok(getViewState({ enabled: true, generating: true }).cancel);
});
