// Official wand mount pattern (Gallery/Token Counter), and getContext().Popup.
export function createPanelHost(panel, context, beforeOpen) {
    const parking = document.createElement('div');
    parking.id = 'spark-panel-store'; parking.hidden = true;
    parking.append(panel); document.body.append(parking);
    let popup = null;
    let closing = null;
    const resize = () => {
        if (!popup) return;
        const viewport = window.visualViewport;
        const center = document.querySelector('#sheld')?.getBoundingClientRect();
        const top = Math.max((viewport?.offsetTop || 0) + 8, center?.top || 0);
        const bottom = Math.min((viewport?.offsetTop || 0) + (viewport?.height || innerHeight), document.querySelector('#form_sheld')?.getBoundingClientRect().top || innerHeight - 64) - 8;
        popup.dlg.style.setProperty('--spark-panel-top', `${top}px`);
        popup.dlg.style.setProperty('--spark-panel-bottom', `${Math.max(8, innerHeight - bottom)}px`);
        popup.dlg.style.setProperty('--spark-panel-height', `${Math.max(80, (bottom - top) * .7)}px`);
        const width = Math.min(center?.width || innerWidth, innerWidth);
        popup.dlg.style.setProperty('--spark-panel-width', `${width}px`);
        popup.dlg.style.setProperty('--spark-panel-left', `${Math.max(0, Math.min(center?.left || 0, innerWidth - width))}px`);
    };
    const observer = new ResizeObserver(resize);
    const compose = document.querySelector('#form_sheld');
    if (compose) observer.observe(compose);
    const center = document.querySelector('#sheld');
    if (center) observer.observe(center);
    window.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('resize', resize);
    window.visualViewport?.addEventListener('scroll', resize);

    async function open() {
        if (popup || closing) return;
        beforeOpen();
        const c = context();
        popup = new c.Popup(panel, c.POPUP_TYPE.DISPLAY, '', {
            allowVerticalScrolling: true, leftAlign: true, animation: 'none',
            onClose: () => {
                parking.append(panel); popup = null;
                document.querySelector('#send_textarea')?.focus({ preventScroll: true });
            },
        });
        popup.dlg.classList.add('spark-dialog');
        popup.dlg.setAttribute('aria-label', '火花规划器');
        resize();
        void popup.show();
    }
    async function close() {
        if (closing) return closing;
        if (!popup) return;
        closing = popup.completeCancelled();
        try { await closing; } finally { closing = null; }
    }
    const entry = document.createElement('div');
    entry.id = 'spark-planner-wand';
    entry.className = 'list-group-item flex-container flexGap5';
    entry.setAttribute('role', 'button'); entry.tabIndex = 0;
    const icon = document.createElement('span');
    icon.className = 'fa-solid fa-wand-magic-sparkles extensionsMenuExtensionButton';
    icon.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = '火花规划器';
    entry.append(icon, title);
    entry.addEventListener('click', open);
    entry.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); entry.click(); }
    });
    // ST initializes the wand before loading UI extensions. APP_READY also covers deferred hosts.
    const mount = () => { if (!entry.isConnected) document.querySelector('#extensionsMenu')?.append(entry); };
    mount(); context().eventSource.on(context().eventTypes.APP_READY, mount);
    const shortcut = document.createElement('div');
    shortcut.id = 'spark-planner-shortcut';
    const hint = document.createElement('p'); hint.textContent = '火花规划器：从聊天左下角魔法棒菜单打开。';
    const button = document.createElement('button'); button.type = 'button'; button.textContent = '打开火花规划器';
    button.addEventListener('click', open); shortcut.append(hint, button);
    document.querySelector('#extensions_settings2, #extensions_settings')?.append(shortcut);
    panel.querySelector('[data-close]').addEventListener('click', close);
    return { open, close };
}
