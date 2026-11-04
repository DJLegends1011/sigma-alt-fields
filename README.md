# Alt Fields

A Project Σ port of [SillyTavern Alternate Fields](https://github.com/nbrown725/SillyTavern-AlternateDescriptions) (nbrown725, AGPLv3).

Keep several versions of a character's **Description, Personality, Scenario, Example Dialogue, Main Prompt** and
**Post-History Instructions** on the card, and switch which one is live.

## Use

Open a character → **Alt Fields** tab. For each field:

- **Save live text** keeps what the field says now as an alternate.
- **Use** makes an alternate the live text. When the live text matches no alternate it is kept as one first
  (setting *Keep unsaved live text*), and a Versions snapshot is taken (setting *Snapshot before switching*).
- **Random** picks an alternate other than the live one.
- Rename inline, ✎ to edit the text, ↑ reorder, duplicate, delete. Edits save when a box loses focus.

The live alternate is found by comparing text, so editing the field in the Edit tab simply shows *Live text not saved*.

Commands: `alt-fields.use { field, name?, charId? }` (no `name` = random, like ST's `/altfield`; `name` may also be a
1-based number) and `alt-fields.list { charId? }`. `charId` defaults to the open chat's character.

## Card data and SillyTavern

Stored exactly where ST's extension stores it: `data.extensions.alternate_fields.<alt_descriptions | alt_personalities |
alt_scenarios | alt_example_dialogue | alt_main_prompts | alt_post_history>` as `[{ title, content }]`. Cards imported
or migrated from ST bring their alternates along, and cards exported from Σ work in ST. ST 0.1's
`extensions.alternate_descriptions` is read and moved to the new key on the next save.
The data travels with the card, so delete alternates you don't want shared before exporting.

## Versions

- A switch changes a real card field, so it is an ordinary edit: the snapshot taken before it lets Versions undo it.
- Snapshots store the whole card, alternates included, but a Versions **restore only writes the card's fields** — it
  leaves `extensions.alternate_fields` as it is now. Restoring an old version therefore brings back the old live text
  while keeping today's alternates (the old text shows as *Live text not saved* if no alternate holds it).
- The Versions diff does not list alternates, only the live fields.
- A card linked to an online provider: a switched field differs from upstream, so an update check sees a local edit
  (just like editing the field by hand).

## Planned: greeting-linked alternates (v0.2)

Bots often ship one scenario and many greetings, where each greeting implies a different setup. Plan:

- Each alternate can be linked to greetings (`first_mes` = 0, `alternate_greetings[i]` = i+1), stored beside the
  alternate as `greetings: [n]` (ST ignores unknown keys, so cards stay compatible).
- The link applies **per chat, at prompt time**, not by rewriting the card: a server `prompt` pipeline filter reads the
  chat's first assistant message, finds which greeting it is (swipe index / text match), and swaps that field's text in
  the built prompt. Two chats on the same bot can then run different scenarios at once, and the card stays untouched.
- Per-chat override: pin an alternate for one chat from a chat action, stored in an `x_alt_fields_chat` table.
- The Prompt Inspector shows the swapped text since it reads the same pipeline.
- Open question: how {{scenario}} macros inside presets resolve — the swap must happen where the card fields are read
  for the prompt, not only on the final message list.
