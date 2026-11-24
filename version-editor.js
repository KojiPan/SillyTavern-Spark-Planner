import { element as el, action } from './editor.js';
import { versionsOf, validateVersions } from './model-versions.js';
import { SKILL_VERSION_FIELDS, versionValue } from './ecot.js';

// Adds version navigation to the existing editor; textarea enlargement remains unchanged.
export function versionEditor({ body, controls, rows, visibility }, item, tags, fields = SKILL_VERSION_FIELDS, readOnly = false) {
    let versions = versionsOf(item, fields), active = versions[0];
    const box = el('div', undefined, 'spark-version-editor'), select = el('select');
    const versionLabel=fields.includes('analysis')?'模型版本':'正文版本';
    select.setAttribute('aria-label', versionLabel);
    const label = el('label', versionLabel); label.append(select);
    const target = el('select'); target.setAttribute('aria-label', '新增版本的模型标签');
    const priority = el('input'); priority.type = 'number'; priority.step = 'any'; priority.setAttribute('aria-label', '版本优先级'); priority.disabled = readOnly;
    const caption = el('label', '优先级');caption.title='版本优先级，数值越大越优先'; caption.append(priority);
    const state = el('input'); state.type = 'hidden'; state.hidden = true; controls.__versions = state; rows.__versions = state;
    const capture = () => {
        for (const key of fields) active[key] = controls[key].type === 'checkbox' ? controls[key].checked : controls[key].value;
        active.priority = Number(priority.value || 0);
        state.value = JSON.stringify(versions);
    };
    const draw = () => {
        select.replaceChildren();
        for (const v of versions) {
            const option = el('option', v.tagId == null ? '默认版本' : tags.find(t => t.id === v.tagId)?.name || `已删除标签：${v.tagId}`);
            option.value = v.id; select.append(option);
        }
        select.value = active.id; priority.value = active.priority || 0;
        for (const key of fields) {
            if (controls[key].type === 'checkbox') controls[key].checked = active[key] === true;
            else controls[key].value = versionValue(key, active[key]);
        }
        visibility?.();
        state.value = JSON.stringify(versions);
        target.replaceChildren();
        for (const [id, name] of [['', '默认版本'], ...tags.map(t => [t.id, t.name])]) {
            const option = el('option', name); option.value = id; target.append(option);
        }
    };
    select.addEventListener('change', () => { capture(); active = versions.find(v => v.id === select.value); draw(); });
    for (const key of fields) controls[key].addEventListener('input', capture);
    priority.addEventListener('input', capture);
    const main=el('div',undefined,'spark-version-main');main.append(label,caption);box.append(main);
    if (!readOnly) {
        const actions = el('div', undefined, 'spark-compact-actions');
        actions.append(target, action('新增版本', () => {
            capture(); const tagId = target.value || null;
            if (tagId == null && versions.some(v => v.tagId == null)) return;
            active = { id: crypto.randomUUID(), tagId, priority: 0, ...Object.fromEntries(fields.map(k => [k, versionValue(k)])) };
            versions.push(active); draw();
        }), action('删除版本', () => {
            if (versions.length <= 1) return;
            versions = versions.filter(v => v !== active); active = versions[0]; draw();
        }));
        box.append(actions);box.title='删除默认版后，仅匹配专用标签的模型可用；至少保留一个有效版本。';
    }
    box.append(state); rows[fields[0]].before(box); draw();
    return () => { capture(); return validateVersions({ versions }, fields); };
}
