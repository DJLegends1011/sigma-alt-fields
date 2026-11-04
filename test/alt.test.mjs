// node --test test/*.test.mjs   (from the extension folder; finds the Σ checkout beside it)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
    FIELDS, fieldOf, readAlternates, activeIndex, pickAlternate, switchPatch, listPatch, namespaceFrom, nextTitle,
} from '../client/core/alt.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const extDir = path.resolve(here, '..');

// a card as SillyTavern Alternate Fields 1.2 writes it
const stCard = () => ({
    name: 'Mira', description: 'Desc A', personality: '', scenario: 'Tavern at night.', first_mes: 'Hi.',
    alternate_greetings: ['On a ship.', 'In a dungeon.'],
    extensions: {
        alternate_fields: {
            alt_scenarios: [
                { title: 'Scenario #1', content: 'Tavern at night.' },
                { title: 'Ship', content: 'Aboard the Gull, storm rising.' },
                { title: 'Dungeon', content: 'Chained in the deep cells.' },
            ],
            alt_descriptions: [{ title: 'Desc A', content: 'Desc A' }, { title: 'Desc B', content: 'Desc B' }],
            future_st_key: ['kept'],
        },
        depth_prompt: { prompt: '', depth: 4 },
    },
});

test('reads ST 1.2 data and finds the live alternate by text', () => {
    const { lists, legacy } = readAlternates(stCard());
    assert.equal(legacy, false);
    assert.equal(lists.scenario.length, 3);
    assert.equal(activeIndex(lists.scenario, 'Tavern at night.\r\n'), 0, 'CRLF and trailing space fold');
    assert.equal(activeIndex(lists.description, 'Desc C'), -1);
    assert.deepEqual(lists.personality, []);
});

test('ST 0.1 string and {title, description} lists are read and retired on write', () => {
    const old = { description: 'x', extensions: { alternate_descriptions: ['one', 'two'] } };
    const { lists, legacy } = readAlternates(old);
    assert.equal(legacy, true);
    assert.deepEqual(lists.description.map(a => a.content), ['one', 'two']);
    const mid = { extensions: { alternate_descriptions: [{ title: 'T', description: 'd' }] } };
    assert.deepEqual(readAlternates(mid).lists.description, [{ title: 'T', content: 'd' }]);
    const patch = listPatch(old, 'description', lists.description);
    assert.equal(patch['extensions.alternate_descriptions'], null);
    assert.equal(patch['extensions.alternate_fields'].alt_descriptions.length, 2);
});

test('a switch writes the field, keeps unsaved live text, and keeps unknown ST keys', () => {
    const card = stCard();
    card.scenario = 'Hand-edited scenario';
    const { fields, kept, lists } = switchPatch(card, 'scenario', 1, { stamp: 'now' });
    assert.equal(fields.scenario, 'Aboard the Gull, storm rising.');
    assert.equal(kept, true);
    assert.equal(lists.scenario.at(-1).content, 'Hand-edited scenario');
    assert.deepEqual(fields['extensions.alternate_fields'].future_st_key, ['kept']);
    assert.equal(fields['extensions.alternate_fields'].alt_descriptions.length, 2);

    const clean = switchPatch(stCard(), 'scenario', 2);
    assert.deepEqual(Object.keys(clean.fields), ['scenario'], 'a saved live text needs no namespace write');
    assert.equal(switchPatch(card, 'scenario', 1, { keepUnsaved: false }).kept, false);
});

test('picking: by title, case-folded, by number, and random never repeats the live one', () => {
    const list = readAlternates(stCard()).lists.scenario;
    assert.equal(pickAlternate(list, 'Ship', ''), 1);
    assert.equal(pickAlternate(list, 'dungeon', ''), 2);
    assert.equal(pickAlternate(list, '3', ''), 2);
    assert.equal(pickAlternate(list, 'Nope', ''), -1);
    for (const r of [0, 0.49, 0.99]) assert.notEqual(pickAlternate(list, '', 'Tavern at night.', () => r), 0);
    assert.equal(pickAlternate([list[0]], '', 'Tavern at night.'), 0, 'one alternate: it is the pick');
});

test('fields resolve from keys, ST save keys, labels and loose names', () => {
    assert.equal(fieldOf('scenario').key, 'scenario');
    assert.equal(fieldOf('alt_main_prompts').key, 'system_prompt');
    assert.equal(fieldOf('Main Prompt').key, 'system_prompt');
    assert.equal(fieldOf('post-history').key, 'post_history_instructions');
    assert.equal(fieldOf('example dialogue').key, 'mes_example');
    assert.equal(fieldOf('first_mes'), null);
    assert.equal(FIELDS.length, 6);
    assert.equal(nextTitle([{ title: 'Scenario #2' }], 'Scenario'), 'Scenario #3');
    assert.deepEqual(namespaceFrom({}, { scenario: [] }), {}, 'an emptied list drops its key');
});

// ---------- in Σ: import keeps the data, the tab renders, the command switches ----------
const kitPath = [path.resolve(extDir, '../../../../ProjectSigma-main/tools/extension-kit/index.mjs'),
    path.resolve(extDir, '../../../../../ProjectSigma-main/tools/extension-kit/index.mjs'),
    process.env.SIGMA_DIR && path.join(process.env.SIGMA_DIR, 'tools/extension-kit/index.mjs')].filter(Boolean).find(p => fs.existsSync(p));

test('in Σ: an ST card keeps its alternates, the tab paints them, alt-fields.use switches the field', { skip: !kitPath && 'no Σ checkout' }, async () => {
    const { startSigma } = await import(pathToFileURL(kitPath).href);
    const sigma = await startSigma({ extensions: [extDir] });
    let page;
    try {
        await sigma.session.enable('alt-fields', true);
        const api = async (...a) => { const r = await sigma.session.api(...a); if (r.status >= 400) throw new Error(`${a[0]} ${r.status} ${JSON.stringify(r.body)}`); return r.body; };
        const char = await sigma.session.importCard(stCard());
        const stored = await api(`/characters/${char.id}`);
        const card = stored.card?.data || stored.data || stored;
        assert.equal(card.extensions.alternate_fields.alt_scenarios.length, 3, 'import keeps extensions.alternate_fields');

        page = await sigma.session.page();
        const C = page.CoreAPI;
        const cache = new Map();
        const fetchChar = async (id) => { const r = await api(`/characters/${id}`); const c = { ...r, data: r.card?.data || r.data }; cache.set(id, c); return c; };
        C.getCharacterById = (id) => cache.get(id);
        C.ensureCharacterById = fetchChar;
        C.hydrateCharacter = async (c) => c;
        const snaps = [];
        C.autoSnapshotBeforeChange = async (c, why) => { snaps.push([c.id, why]); };
        page.registry.defineCommand('character.update', async ({ id, fields }) => {
            await api(`/characters/${id}`, 'PATCH', { fields });
            await fetchChar(id);
            return { ok: true };
        }, { title: 'real write (test)' });
        await page.boot();

        const pane = page.dom.createElement('div');
        assert.ok(page.host.renderDetailTab('alt-fields/alt-fields', pane, { character: { id: char.id }, isCurrent: () => true }));
        for (let i = 0; i < 100 && !pane.innerHTML.includes('Dungeon'); i++) await new Promise(r => setTimeout(r, 20));
        assert.match(pane.innerHTML, /Dungeon/);
        assert.match(pane.innerHTML, /Scenario #1/);

        // closing every open field keeps them closed (a redraw must not re-open fields with alternates)
        const isOpen = (k) => new RegExp(`altf-field open" data-field="${k}"`).test(pane.innerHTML);
        assert.ok(isOpen('description') && isOpen('scenario'));
        const toggle = (k) => pane.querySelector(`[data-field="${k}"] [data-act="toggle"]`).click();
        toggle('description');
        assert.ok(!isOpen('description') && isOpen('scenario'));
        toggle('scenario');
        assert.ok(!isOpen('description') && !isOpen('scenario'), 'closing the last open field opens nothing else');
        toggle('scenario');
        assert.ok(!isOpen('description') && isOpen('scenario'));

        const res = await page.registry.runCommand('alt-fields.use', { charId: char.id, field: 'scenario', name: 'Dungeon' });
        assert.equal(res.title, 'Dungeon');
        const after_ = await api(`/characters/${char.id}`);
        assert.equal((after_.card?.data || after_.data).scenario, 'Chained in the deep cells.');
        assert.deepEqual(snaps, [[char.id, 'alt field']], 'a Versions snapshot is taken before the switch');

        const list = await page.registry.runCommand('alt-fields.list', { charId: char.id });
        assert.equal(list.scenario.live, 2);
        assert.equal(list.description.live, 0);
    } finally {
        page?.close();
        await sigma.close();
    }
});
