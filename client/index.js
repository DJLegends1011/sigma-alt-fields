// Alt Fields, the client half: the card's Alt Fields tab, the alt-fields.use / alt-fields.list
// commands and the settings switches. Every write goes through the app's own character.update, so
// the change feed, the details pane and other tabs see it like any edit.
import {
    FIELDS, fieldOf, readAlternates, activeIndex, nextTitle, pickAlternate, approxTokens, switchPatch, listPatch,
} from './core/alt.js';


export default {
    init(ctx) {
        const { CoreAPI } = ctx;
        const esc = (s) => CoreAPI.escapeHtml(String(s ?? ''));
        let currentCharId = null;
        const mounts = new Set();
        ctx.events.on('character.updated', ({ ids, all }) => {
            for (const m of [...mounts]) {
                if (!m.root.isConnected) { mounts.delete(m); continue; }
                if (!(all || ids?.includes(m.id)) || m.quiet()) continue;
                const a = document.activeElement;
                if (a && m.root.contains(a) && a.matches?.('input,textarea')) continue;
                m.reload();
            }
        });

        async function loadChar(id) {
            let char = CoreAPI.getCharacterById?.(id) || await CoreAPI.ensureCharacterById?.(id);
            if (char?._slim) char = (await CoreAPI.hydrateCharacter?.(char)) || char;
            return char || null;
        }
        const dataOf = (char) => char?.data || char || {};

        async function write(char, fields) {
            const done = await ctx.commands.run('character.update', { id: char.id, fields, source: 'alt-fields' });
            if (done?.ok === false) throw new Error(done.error || 'the card write was refused');
        }

        // the details pane and Edit form paint a field only when the card opens: bring them up to the new text
        // in place, leaving an Edit box alone that holds the reader's own typing
        function showLive(field, was, now, char) {
            if (field.shownId) {
                const shown = document.getElementById(field.shownId);
                if (shown && CoreAPI.safePurify && CoreAPI.formatRichText) shown.innerHTML = CoreAPI.safePurify(CoreAPI.formatRichText(now, dataOf(char).name));
            }
            const box = document.getElementById(field.editId);
            if (box && box.value !== now) {
                if (box.value === was) box.value = now;
                else CoreAPI.showToast(`The Edit tab holds unsaved ${field.label} text: re-open the card before saving it`, 'warning');
            }
        }

        /** Switch one field to an alternate: snapshot first (Versions can undo it), keep unsaved live text, write. */
        async function useAlternate(char, fieldKey, index) {
            const field = FIELDS.find(f => f.key === fieldKey);
            const data = dataOf(char);
            const was = data[fieldKey] ?? '';
            const stamp = new Date().toLocaleString();
            const { fields, kept } = switchPatch(data, fieldKey, index, { keepUnsaved: ctx.settings.get('keepUnsaved') !== false, stamp });
            if (ctx.settings.get('snapshotOnSwitch') !== false) await CoreAPI.autoSnapshotBeforeChange?.(char, 'alt field');
            await write(char, fields);
            showLive(field, was, fields[fieldKey], char);
            return { kept, title: readAlternates(data).lists[fieldKey][index]?.title };
        }

        // ---------- the details tab ----------
        function mountTab(pane, character) {
            const root = document.createElement('div');
            root.className = 'altf-root';
            // a fresh wrapper each paint: the host reuses the pane, so listeners on it would stack
            pane.innerHTML = '';
            pane.appendChild(root);
            let char = null;
            let open = new Set();       // fields whose drawer is open
            let editing = new Set();    // "field:index" content drawers open
            let busy = false;
            let seeded = false;

            async function reload() {
                char = await loadChar(character.id);
                paint();
            }

            function paint() {
                if (!char) { root.innerHTML = '<div class="altf-empty">Could not load this character.</div>'; return; }
                const data = dataOf(char);
                const { lists, legacy } = readAlternates(data);
                const total = FIELDS.reduce((n, f) => n + lists[f.key].length, 0);
                // fields with alternates start open, once: after that only the reader's toggles count
                if (!seeded) { seeded = true; for (const f of FIELDS) if (lists[f.key].length) open.add(f.key); }
                root.innerHTML = `
                    <div class="altf-intro">
                        <i class="fa-solid fa-code-branch"></i>
                        <div>Keep several versions of a field on this card and switch the live one. ${total
                            ? `<span class="altf-muted">${total} alternate${total === 1 ? '' : 's'} saved.</span>`
                            : '<span class="altf-muted">Open a field and press <b>Save live text</b> to keep what it says now.</span>'}
                            ${legacy ? '<div class="altf-muted">Old-style (ST 0.1) description alternates found: they move to the new format on the next save.</div>' : ''}
                        </div>
                    </div>
                    ${FIELDS.map(f => fieldCard(f, lists[f.key], data[f.key] ?? '')).join('')}`;
                for (const t of root.querySelectorAll('textarea[data-autosize]')) autosize(t);
            }

            function fieldCard(f, list, live) {
                const cur = activeIndex(list, live);
                const unsaved = String(live).trim() && cur < 0;
                const isOpen = open.has(f.key);
                return `
                <section class="altf-field${isOpen ? ' open' : ''}" data-field="${f.key}">
                    <button type="button" class="altf-head" data-act="toggle">
                        <i class="fa-solid ${f.icon} altf-ficon"></i>
                        <span class="altf-flabel">${esc(f.label)}</span>
                        ${list.length ? `<span class="altf-pill">${list.length}</span>` : ''}
                        <span class="altf-live">${cur >= 0 ? `<i class="fa-solid fa-circle-check"></i> ${esc(list[cur].title)}`
                            : unsaved && list.length ? '<i class="fa-solid fa-triangle-exclamation"></i> Live text not saved' : ''}</span>
                        <i class="fa-solid fa-chevron-down altf-chev"></i>
                    </button>
                    ${isOpen ? `<div class="altf-body">
                        ${list.map((a, i) => altRow(f, a, i, i === cur)).join('') || '<div class="altf-muted altf-none">No alternates yet.</div>'}
                        <div class="altf-actions">
                            <button type="button" class="altf-btn" data-act="save-live" ${String(live).trim() ? '' : 'disabled'}><i class="fa-solid fa-floppy-disk"></i> Save live text</button>
                            <button type="button" class="altf-btn" data-act="add-blank"><i class="fa-solid fa-plus"></i> Blank</button>
                            ${list.length > 1 ? '<button type="button" class="altf-btn" data-act="random"><i class="fa-solid fa-shuffle"></i> Random</button>' : ''}
                        </div>
                    </div>` : ''}
                </section>`;
            }

            function altRow(f, a, i, isLive) {
                const key = `${f.key}:${i}`;
                const ed = editing.has(key);
                return `
                <div class="altf-alt${isLive ? ' live' : ''}" data-index="${i}">
                    <div class="altf-row">
                        <input class="glass-input altf-title" data-act="title" value="${esc(a.title)}" maxlength="120" aria-label="Alternate name">
                        <span class="altf-tok" title="About ${approxTokens(a.content)} tokens">~${approxTokens(a.content)} tok</span>
                        ${isLive ? '<span class="altf-badge"><i class="fa-solid fa-check"></i> Live</span>'
                            : '<button type="button" class="altf-btn primary" data-act="use" title="Make this the live text"><i class="fa-solid fa-arrow-right-to-bracket"></i> Use</button>'}
                        <button type="button" class="altf-icon" data-act="edit" title="${ed ? 'Hide text' : 'Show and edit text'}"><i class="fa-solid ${ed ? 'fa-eye-slash' : 'fa-pen'}"></i></button>
                        <button type="button" class="altf-icon" data-act="up" title="Move up" ${i === 0 ? 'disabled' : ''}><i class="fa-solid fa-arrow-up"></i></button>
                        <button type="button" class="altf-icon" data-act="copy" title="Duplicate"><i class="fa-solid fa-clone"></i></button>
                        <button type="button" class="altf-icon danger" data-act="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
                    </div>
                    ${ed ? `<textarea class="glass-input altf-text" data-act="content" data-autosize rows="4" placeholder="Empty">${esc(a.content)}</textarea>
                        ${isLive ? '<div class="altf-muted altf-hint">This is the live text: editing it here saves the alternate only. Press Use again to apply the edit.</div>' : ''}` : ''}
                </div>`;
            }

            function autosize(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight + 2, 420) + 'px'; }

            async function act(fn, okMsg) {
                if (busy) return;
                busy = true;
                try {
                    const msg = await fn();
                    if (msg || okMsg) CoreAPI.showToast(msg || okMsg, 'success');
                } catch (e) {
                    console.error('[alt-fields]', e);
                    CoreAPI.showToast(`Alt Fields: ${e?.message || e}`, 'error');
                } finally {
                    busy = false;
                    await reload();
                }
            }

            async function saveList(fieldKey, mutate) {
                const fresh = await loadChar(character.id);
                const data = dataOf(fresh);
                const list = readAlternates(data).lists[fieldKey].slice();
                mutate(list, data);
                await write(fresh, listPatch(data, fieldKey, list));
            }

            root.addEventListener('click', (e) => {
                const btn = e.target.closest('[data-act]');
                if (!btn || btn.disabled || btn.tagName === 'INPUT' || btn.tagName === 'TEXTAREA') return;
                const section = btn.closest('[data-field]');
                const fieldKey = section?.dataset.field;
                const field = FIELDS.find(f => f.key === fieldKey);
                const row = btn.closest('[data-index]');
                const i = row ? Number(row.dataset.index) : -1;
                switch (btn.dataset.act) {
                    case 'toggle':
                        open.has(fieldKey) ? open.delete(fieldKey) : open.add(fieldKey);
                        paint();
                        break;
                    case 'edit': {
                        const k = `${fieldKey}:${i}`;
                        editing.has(k) ? editing.delete(k) : editing.add(k);
                        paint();
                        break;
                    }
                    case 'save-live':
                        act(() => saveList(fieldKey, (list, data) => list.push({ title: nextTitle(list, field.label), content: String(data[fieldKey] ?? '') })), `Saved the live ${field.label} as an alternate`);
                        break;
                    case 'add-blank':
                        act(() => saveList(fieldKey, (list) => {
                            list.push({ title: nextTitle(list, field.label), content: '' });
                            editing.add(`${fieldKey}:${list.length - 1}`);
                        }));
                        break;
                    case 'copy':
                        act(() => saveList(fieldKey, (list) => list.splice(i + 1, 0, { title: `${list[i].title} (copy)`, content: list[i].content })));
                        break;
                    case 'up':
                        act(() => saveList(fieldKey, (list) => { if (i > 0) [list[i - 1], list[i]] = [list[i], list[i - 1]]; }));
                        break;
                    case 'delete':
                        act(async () => {
                            const fresh = dataOf(await loadChar(character.id));
                            const title = readAlternates(fresh).lists[fieldKey][i]?.title || 'this alternate';
                            const yes = await CoreAPI.showConfirm?.({ title: 'Delete alternate', message: `Delete "${title}"? The live ${field.label} is not changed.`, confirmLabel: 'Delete', danger: true });
                            if (!yes) return '';
                            editing.clear();
                            await saveList(fieldKey, (list) => list.splice(i, 1));
                            return '';
                        });
                        break;
                    case 'use':
                    case 'random':
                        act(async () => {
                            const fresh = await loadChar(character.id);
                            const data = dataOf(fresh);
                            const list = readAlternates(data).lists[fieldKey];
                            const idx = btn.dataset.act === 'use' ? i : pickAlternate(list, '', data[fieldKey]);
                            const { kept, title } = await useAlternate(fresh, fieldKey, idx);
                            return `${field.label} is now "${title}"${kept ? ' (the old text was kept as an alternate)' : ''}`;
                        });
                        break;
                }
            });

            root.addEventListener('input', (e) => { if (e.target.matches('textarea[data-autosize]')) autosize(e.target); });
            // edits save when the box loses focus (change), never per keystroke
            root.addEventListener('change', (e) => {
                const el = e.target;
                const act_ = el.dataset?.act;
                if (act_ !== 'title' && act_ !== 'content') return;
                const fieldKey = el.closest('[data-field]')?.dataset.field;
                const i = Number(el.closest('[data-index]')?.dataset.index);
                const value = el.value;
                act(() => saveList(fieldKey, (list) => {
                    if (!list[i]) return;
                    if (act_ === 'title') list[i].title = value.trim() || list[i].title;
                    else list[i].content = value;
                }));
            });

            // one listener for every open tab (ctx.events.on has no off): a tab registers here, a detached one is dropped
            mounts.add({ root, id: character.id, quiet: () => busy, reload });

            root.innerHTML = '<div class="altf-muted">Loading…</div>';
            reload();
        }

        ctx.ui.contribute('character.details.tab', {
            id: 'alt-fields',
            label: 'Alt Fields',
            icon: 'fa-code-branch',
            render: (pane, { character }) => mountTab(pane, character),
        });

        // ---------- settings ----------
        ctx.ui.contribute('extension.settings', {
            render(el) {
                const sw = (key, label, hint) => `
                    <div class="settings-row"><label><input type="checkbox" class="cl-switch-input" data-key="${key}" ${ctx.settings.get(key) !== false ? 'checked' : ''}>
                    <span class="cl-switch" aria-hidden="true"></span><span>${label}</span></label>
                    <div class="altf-muted">${hint}</div></div>`;
                el.innerHTML = sw('snapshotOnSwitch', 'Snapshot before switching', 'Take a Versions snapshot before an alternate replaces a live field, so Versions can undo it (follows the app\'s auto-snapshot setting).')
                    + sw('keepUnsaved', 'Keep unsaved live text', 'When the live text matches no alternate, save it as one before switching instead of losing it.');
                el.addEventListener('change', (e) => {
                    const k = e.target?.dataset?.key;
                    if (k) ctx.settings.set(k, !!e.target.checked);
                });
            },
        });

        // ---------- commands (the ST /altfield) ----------
        ctx.events.on('conversation.changed', ({ charId }) => { currentCharId = charId || null; });

        ctx.commands.register('use', async ({ charId = currentCharId, field, name } = {}) => {
            const f = fieldOf(field);
            if (!f) throw new Error(`field must be one of ${FIELDS.map(x => x.key).join(', ')}`);
            if (!charId) throw new Error('no character: open a chat or pass charId');
            const char = await loadChar(charId);
            if (!char) throw new Error('character not found');
            const data = dataOf(char);
            const list = readAlternates(data).lists[f.key];
            if (!list.length) throw new Error(`${dataOf(char).name} has no ${f.label} alternates`);
            const idx = pickAlternate(list, name, data[f.key]);
            if (idx < 0) throw new Error(`no ${f.label} alternate named "${name}"`);
            const { kept, title } = await useAlternate(char, f.key, idx);
            return { ok: true, field: f.key, title, index: idx, kept };
        }, { title: 'Switch a character field to one of its alternates (no name: a random one)' });

        ctx.commands.register('list', async ({ charId = currentCharId } = {}) => {
            if (!charId) throw new Error('no character: open a chat or pass charId');
            const char = await loadChar(charId);
            if (!char) throw new Error('character not found');
            const data = dataOf(char);
            const { lists } = readAlternates(data);
            return Object.fromEntries(FIELDS.map(f => [f.key, {
                live: activeIndex(lists[f.key], data[f.key]),
                alternates: lists[f.key].map(a => ({ title: a.title, tokens: approxTokens(a.content) })),
            }]));
        }, { title: 'List a character\'s field alternates' });

        window.__SIGMA_ALT_FIELDS__ = { version: '0.1.0', fields: FIELDS.map(f => f.key) };
    },

    dispose() {
        delete window.__SIGMA_ALT_FIELDS__;
    },
};
