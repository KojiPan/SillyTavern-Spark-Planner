import { KEY } from './core.js';

export const SKILL_VERSION_FIELDS = ['recommendation', 'body', 'ecotEnabled', 'ecotText', 'ecotOutlet'];
export const versionValue = (key, value) => key === 'ecotEnabled' ? value === true : key === 'ecotOutlet' ? String(value || 'EcoT').trim() || 'EcoT' : String(value || '');
export const hasEcot = (skill, version) => skill.type === 'reasoning' && version?.ecotEnabled === true && !!version.ecotText?.trim();
export const pairedReasoning = skill => skill.type === 'reasoning' && skill.versions?.some(v => v.ecotEnabled === true);

// The parent stable ID is the association; native UIDs remain local to each book.
export const ecotId = id => `ecot:${id}`;
export function ecotEntry(parent, version, companion) {
    return { ...structuredClone(companion), comment: `${parent.comment} · ECoT`, content: version?.ecotText || '',
        disable: true, constant: true, position: 7, order: 100, probability: 100, useProbability: true,
        outletName: versionValue('ecotOutlet', version?.ecotOutlet),
        [KEY]: { owner: KEY, kind: 'ecot', id: ecotId(parent[KEY].id), skillId: parent[KEY].id,
            enabledVersionIds: (parent[KEY].versions || []).filter(v => v.ecotEnabled === true && v.ecotText?.trim()).map(v => v.id) } };
}

export function ecotFields(initial = {}) {
    return {
        ecotEnabled: { label: '开启附加 ECoT 提问', type: 'checkbox', value: initial.ecotEnabled === true, when: v => v.type === 'reasoning' },
        ecotText: { label: 'ECoT 提问', type: 'textarea', rows: 4, value: initial.ecotText || '', when: v => v.type === 'reasoning' && v.ecotEnabled },
        ecotOutlet: { label: 'Outlet 锚点', value: versionValue('ecotOutlet', initial.ecotOutlet), required: true, when: v => v.type === 'reasoning' && v.ecotEnabled },
    };
}

export function ecotEditor({ controls, rows, visibility }) {
    const fold = document.createElement('details'); fold.className = 'spark-ecot-fold';
    const summary = document.createElement('summary'); summary.textContent = '附加 ECoT 提问'; fold.append(summary);
    rows.body.after(fold);
    for (const key of ['ecotEnabled', 'ecotText', 'ecotOutlet']) fold.append(rows[key]);
    controls.ecotText.wrap = 'soft';
    rows.ecotEnabled.classList.add('spark-inline-toggle');
    const refresh = () => { fold.hidden = controls.type.value !== 'reasoning'; visibility(); };
    controls.type.addEventListener('change', refresh); refresh();
}
