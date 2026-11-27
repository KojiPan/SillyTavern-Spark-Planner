import { element as el, action } from './editor.js';
import { versionsOf, validateVersions } from './model-versions.js';
import { SKILL_VERSION_FIELDS, versionValue } from './ecot.js';

// Adds version navigation to the existing editor; textarea enlargement remains unchanged.
export function versionEditor({ body, controls, rows, visibility }, item, tags, fields = SKILL_VERSION_FIELDS, readOnly = false, versionId) {
    let versions = versionsOf(item, fields), active = versions.find(v=>v.id===versionId) || versions[0];
    const box = el('details', undefined, 'spark-version-editor'), select = el('select');
    box.append(el('summary','模型适配'));
    const editing=el('small','','spark-editing-version');
    rows[fields.includes('body')?'body':fields[0]].prepend(editing);
    const versionLabel='适配版本';
    select.setAttribute('aria-label', versionLabel);
    const label = el('label', versionLabel); label.append(select);
    const target = el('select'); target.setAttribute('aria-label', '新增适配版本的模型标签');
    const priority = el('input'); priority.type = 'number'; priority.step = 'any'; priority.setAttribute('aria-label', '匹配优先级'); priority.disabled = readOnly;
    const caption = el('label', '匹配优先级');caption.title='匹配优先级，数值越大越优先'; caption.append(priority);
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
        editing.textContent='正在编辑：'+select.selectedOptions[0].textContent;
        if(versionId && !versions.some(v=>v.id===versionId))editing.textContent+='（本轮适配版本已删除，当前为保留版本）';
        visibility?.();
        state.value = JSON.stringify(versions);
        target.replaceChildren();
        for (const [id, name] of [['', '默认版本'], ...tags.map(t => [t.id, t.name])]) {
            const option = el('option', name); option.value = id; target.append(option);
        }
        for (const key of fields) controls[key].dispatchEvent(new Event('spark-text-refresh'));
    };
    select.addEventListener('change', () => { capture(); active = versions.find(v => v.id === select.value); draw(); });
    for (const key of fields) controls[key].addEventListener('input', capture);
    priority.addEventListener('input', capture);
    const main=el('div',undefined,'spark-version-main');main.append(label,caption);box.append(main);
    if (!readOnly) {
        const actions = el('div', undefined, 'spark-compact-actions');
        actions.append(target, action('新增适配版本', () => {
            capture(); const tagId = target.value || null;
            if (tagId == null && versions.some(v => v.tagId == null)) return;
            active = { id: crypto.randomUUID(), tagId, priority: 0, ...Object.fromEntries(fields.map(k => [k, versionValue(k)])) };
            versions.push(active); draw();
        }), action('删除版本', async () => {
            if (versions.length <= 1) return;
            if(!await SillyTavern.getContext().Popup.show.confirm('删除适配版本','将删除当前版本的正文和配置，保存后生效。是否继续？'))return;
            versions = versions.filter(v => v !== active); active = versions[0]; draw();
        }));
        box.append(actions);box.title='删除默认版后，仅匹配专用标签的模型可用；至少保留一个有效版本。';
    }
    box.append(state); rows[fields.at(-1)].after(box); draw();
    return () => { capture(); return validateVersions({ versions }, fields); };
}
