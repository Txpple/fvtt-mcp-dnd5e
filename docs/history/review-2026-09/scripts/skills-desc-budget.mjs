// skills-desc-budget.mjs — measure the six replacement front-matter descriptions against ≤55%.
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('scratch/skills-matrix.json', 'utf8'));
const cur = Object.fromEntries(Object.entries(m.skills).map(([k, v]) => [k, v.desc.chars]));

const NEW = {
  'pc-builder':
    'Build a COMPLETE D&D 5e player character (type:character, not an NPC) in Foundry — class + species + background, ability scores, the level-1 choices, spells, starting gear, art, owner, folder. Use when the user wants to "make a PC", "build a character", "create a level 1 fighter", "roll up a wizard", "make my player\'s dragonborn paladin", "build a character for <player>", or pastes a character concept/sheet. ALSO use for "import my D&D Beyond character" / "import from DDB" or a dndbeyond.com link — that path is removed; the skill refuses and rebuilds the PC natively from the premium books.',
  'session-audit':
    'Audit the NEXT SESSION before it is played — read the maps, placed monsters and PC sheets, do the encounter arithmetic, judge whether the fights are tuned and the night fits the hours, then audit campaign pacing. READ-ONLY report. Use when the user wants to "audit my next session", "is this fight too hard / too easy", "evaluate the difficulty", "review the maps and monsters I placed", "check the encounters before Tuesday", "will this dungeon fit in one session", "how is the campaign pacing", "are we on track", "review <site> before we run it", or hands over a built dungeon and asks what to change.',
  'tom-cartos-import':
    'Import a Tom-Cartos-style Foundry SCENE-PACK MODULE (an unzipped folder with a module.json and packs/) into the live world — every scene with its walls, lights, mood, teleporters, legend journal and standalone tiles. Use when the user wants to "import a Tom Cartos pack", "install this map module", "bring this scene pack into my world", "import the dungeon/temple/keep module", "import a Foundry module\'s scenes", or points at a module folder / a module.json.',
  'physical-item-builder':
    'Author D&D 5e physical items — weapons, armor, shields, wondrous items, potions/scrolls, ammunition, tools, gems/loot, containers — as Foundry items, compendium-first (copy the real PHB/DMG item, modify + rename for custom, author from scratch last). Use when the user wants to "make a magic sword", "create a +1 longsword", "add a healing potion", "give this NPC some loot / treasure / gear", "stat out this magic item", "build a flame tongue", "fill this chest with loot", or pastes a DMG-style item entry.',
  'playlist-builder':
    'Author Foundry audio playlists — MUSIC and whole-track ambience: scene ambience beds, combat/boss music, exploration sets, SFX soundboards (uploaded files; no compendium). Use when the user wants to "make a playlist", "add background music", "battle music", "a theme for this place", "exploration music", "a soundboard of effects", or to attach audio to a scene. NOT for randomized one-shots with silence between them or a crossfaded ambient bed — that is soundscape-builder; a sound from one spot on the map is an AmbientSound (create-sounds).',
  'stat-block-builder':
    'Build a COMPLETE D&D 5e NPC in Foundry from a pasted/described stat block — stats, traits, actions, spells, effects, AND its inventory, loot, coins, biography, art, ownership, folder. Use when the user wants to "build this monster", "make an NPC from this stat block", "stat out <creature>", "create a creature from this text", "build the boss with its gear and loot", or pastes a Monster-Manual-style block. NPCs only — a player character is pc-builder.',
};

let curTotal = 0;
let newTotal = 0;
const rows = [];
for (const [k, d] of Object.entries(NEW)) {
  const before = cur[k];
  const after = d.length;
  curTotal += before;
  newTotal += after;
  rows.push({ skill: k, before, after, ratio: (after / before).toFixed(2), target: Math.floor(before * 0.55), ok: after <= before * 0.55 });
}
console.table(rows);
const all = Object.values(cur).reduce((a, b) => a + b, 0);
const others = all - curTotal;
const ratio = newTotal / curTotal;
console.log(`six: before=${curTotal} after=${newTotal} ratio=${ratio.toFixed(3)}`);
console.log(`all 17 today=${all}; six replaced only => ${others + newTotal}; same ratio on all 17 => ${Math.round(all * ratio)}`);
console.log(`~tokens (chars/3.6): today ${Math.round(all / 3.6)}, six-replaced ${Math.round((others + newTotal) / 3.6)}, all-at-ratio ${Math.round((all * ratio) / 3.6)}`);
