// Alt Fields, the pure core: the card shape SillyTavern's Alternate Fields extension writes
// (data.extensions.alternate_fields.<saveKey> = [{ title, content }]), read and written the same
// way here so a card moves between ST and Σ with its alternates intact. No DOM, no ctx.

export const NS = 'alternate_fields';
// ST 0.1.x kept descriptions only, under their own key
export const LEGACY_KEY = 'alternate_descriptions';

export const FIELDS = Object.freeze([
    { key: 'description', saveKey: 'alt_descriptions', label: 'Description', icon: 'fa-scroll', editId: 'editDescription', shownId: 'modalDescription' },
    { key: 'personality', saveKey: 'alt_personalities', label: 'Personality', icon: 'fa-brain', editId: 'editPersonality' },
    { key: 'scenario', saveKey: 'alt_scenarios', label: 'Scenario', icon: 'fa-map', editId: 'editScenario' },
    { key: 'mes_example', saveKey: 'alt_example_dialogue', label: 'Example Dialogue', icon: 'fa-comments', editId: 'editMesExample' },
    { key: 'system_prompt', saveKey: 'alt_main_prompts', label: 'Main Prompt', icon: 'fa-terminal', editId: 'editSystemPrompt' },
    { key: 'post_history_instructions', saveKey: 'alt_post_history', label: 'Post-History Instructions', icon: 'fa-clock-rotate-left', editId: 'editPostHistoryInstructions' },
].map(Object.freeze));

const ALIASES = {
    description: 'description', descriptions: 'description', desc: 'description',
    personality: 'personality', personalities: 'personality',
    scenario: 'scenario', scenarios: 'scenario',
    mes_example: 'mes_example', example: 'mes_example', examples: 'mes_example', example_dialogue: 'mes_example', dialogue: 'mes_example',
    system_prompt: 'system_prompt', main_prompt: 'system_prompt', main: 'system_prompt', system: 'system_prompt',
    post_history_instructions: 'post_history_instructions', post_history: 'post_history_instructions', jailbreak: 'post_history_instructions', phi: 'post_history_instructions',
};

/** A field by its card key, its ST saveKey, its label or a loose alias ("main prompt", "post-history"); null when unknown. */
export function fieldOf(name) {
    if (!name) return null;
    const n = String(name).trim().toLowerCase().replace(/[\s-]+/g, '_');
    const byKey = FIELDS.find(f => f.key === n || f.saveKey === n || f.label.toLowerCase().replace(/[\s-]+/g, '_') === n);
    if (byKey) return byKey;
    const k = ALIASES[n];
    return k ? FIELDS.find(f => f.key === k) : null;
}

function cleanList(list, label) {
    if (!Array.isArray(list)) return [];
    return list.map((item, i) => {
        if (typeof item === 'string') return { title: `${label} #${i + 1}`, content: item };
        if (!item || typeof item !== 'object') return null;
        const content = typeof item.content === 'string' ? item.content
            : typeof item.description === 'string' ? item.description : '';
        const title = typeof item.title === 'string' && item.title.trim() ? item.title : `${label} #${i + 1}`;
        return { title, content };
    }).filter(Boolean);
}

/** Every field's alternates as the card holds them, the ST 0.1.x description list folded in. Answers { lists, legacy }. */
export function readAlternates(data) {
    const ext = data?.extensions || {};
    const ns = ext[NS] && typeof ext[NS] === 'object' && !Array.isArray(ext[NS]) ? ext[NS] : {};
    const lists = {};
    for (const f of FIELDS) lists[f.key] = cleanList(ns[f.saveKey], f.label);
    const legacy = Array.isArray(ext[LEGACY_KEY]) && ext[LEGACY_KEY].length > 0;
    if (legacy && lists.description.length === 0) lists.description = cleanList(ext[LEGACY_KEY], 'Description');
    return { lists, legacy };
}

/** The namespace object to write back: the card's own keys we don't know are kept (a newer ST field). */
export function namespaceFrom(data, lists) {
    const old = data?.extensions?.[NS];
    const out = old && typeof old === 'object' && !Array.isArray(old) ? { ...old } : {};
    for (const f of FIELDS) {
        const list = lists[f.key];
        if (list && list.length) out[f.saveKey] = list.map(({ title, content }) => ({ title, content }));
        else delete out[f.saveKey];
    }
    return out;
}

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();

/** Same text as a reader sees it: line endings folded (a textarea turns CRLF into LF) and ends trimmed. */
export function sameText(a, b) { return norm(a) === norm(b); }

/** Where each open editor's row lands after a list edit: up swaps i with i-1, copy shifts rows after i, delete drops i. */
export function remapIndex(op, i, at) {
    if (op === 'up') return at === i ? i - 1 : at === i - 1 ? i : at;
    if (op === 'copy') return at > i ? at + 1 : at;
    if (op === 'delete') return at === i ? -1 : at > i ? at - 1 : at;
    return at;
}

/** The index of the alternate the live field holds (compared trimmed, CRLF folded), or -1. */
export function activeIndex(list, live) {
    const want = norm(live);
    return (list || []).findIndex(a => norm(a.content) === want);
}

/** A title not yet in the list: "<Label> #n". */
export function nextTitle(list, label) {
    const taken = new Set((list || []).map(a => a.title));
    let n = (list?.length || 0) + 1;
    while (taken.has(`${label} #${n}`)) n++;
    return `${label} #${n}`;
}

/** An alternate by name (exact, then case-folded, then a 1-based number), or a random one other than the live text when name is empty. */
export function pickAlternate(list, name, live, rand = Math.random) {
    if (!list?.length) return -1;
    if (name === undefined || name === null || String(name).trim() === '') {
        const cur = activeIndex(list, live);
        const pool = list.map((_, i) => i).filter(i => i !== cur);
        const from = pool.length ? pool : [cur];
        return from[Math.floor(rand() * from.length)];
    }
    const s = String(name).trim();
    let i = list.findIndex(a => a.title === s);
    if (i < 0) i = list.findIndex(a => a.title.toLowerCase() === s.toLowerCase());
    if (i < 0 && /^\d+$/.test(s)) { const n = Number(s) - 1; if (n >= 0 && n < list.length) i = n; }
    return i;
}

/** A rough token count: no tokenizer reaches an extension, so about 4 characters a token. */
export function approxTokens(text) {
    const s = String(text || '');
    return s ? Math.max(1, Math.round(s.length / 4)) : 0;
}

/**
 * The fields a switch writes: the live field becomes the alternate, and (keepUnsaved) live text no
 * alternate holds is first kept as a new one so a switch never loses writing. Answers
 * { fields, lists, kept } where fields is a character.update patch.
 */
export function switchPatch(data, fieldKey, index, { keepUnsaved = true, stamp = '' } = {}) {
    const f = FIELDS.find(x => x.key === fieldKey);
    if (!f) throw new Error(`unknown field ${fieldKey}`);
    const { lists, legacy } = readAlternates(data);
    const list = lists[f.key].slice();
    const target = list[index];
    if (!target) throw new Error(`no alternate #${index + 1} for ${f.label}`);
    const live = data?.[f.key] ?? '';
    let kept = false;
    if (keepUnsaved && norm(live) && activeIndex(list, live) < 0) {
        list.push({ title: `${f.label} (kept${stamp ? ' ' + stamp : ''})`, content: String(live) });
        kept = true;
    }
    lists[f.key] = list;
    const fields = { [f.key]: target.content };
    if (kept || legacy) fields[`extensions.${NS}`] = namespaceFrom(data, lists);
    if (legacy) fields[`extensions.${LEGACY_KEY}`] = null;
    return { fields, lists, kept };
}

/** The patch that stores one field's list (and retires the 0.1.x key once its list lives under the namespace). */
export function listPatch(data, fieldKey, list) {
    const { lists, legacy } = readAlternates(data);
    lists[fieldKey] = list;
    const fields = { [`extensions.${NS}`]: namespaceFrom(data, lists) };
    if (legacy) fields[`extensions.${LEGACY_KEY}`] = null;
    return fields;
}
