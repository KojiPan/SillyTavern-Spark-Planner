// Regenerate deletes the old assistant message before interceptors run.
// Keep a pre-deletion copy; native Swipe already performs its own rollback.
export class RegenerateRecovery {
    constructor(context, chatKey, enabled, notify) {
        Object.assign(this, { context, chatKey, enabled, notify });
        this.backup = null;
    }
    start(type, dryRun) {
        if (dryRun || type !== 'regenerate' || !this.enabled()) return;
        const c = this.context();
        const message = c.chat.at(-1);
        if (!message || message.is_user || message.is_system) return;
        this.backup = { key: this.chatKey(), index: c.chat.length - 1, message: structuredClone(message), received: false };
    }
    received() { if (this.backup) this.backup.received = true; }
    async finish(failedStream = false) {
        const backup = this.backup;
        this.backup = null;
        if (!backup || backup.key !== this.chatKey() || (backup.received && !failedStream)) return false;
        const c = this.context();
        // Refuse to overwrite a concurrently appended turn.
        if (c.chat.length > backup.index + 1) return false;
        c.chat.splice(backup.index, 1, backup.message);
        await c.saveChat();
        if (backup.key === this.chatKey()) await c.reloadCurrentChat();
        this.notify('正文生成未完成，已恢复 Regenerate 前的回复与候选。');
        return true;
    }
}
