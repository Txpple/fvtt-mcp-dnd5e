// For each enum/grammar token a skill spells out, check whether the tool's advertised schema/description already carries it.
import { readFileSync } from 'node:fs';
const tools = JSON.parse(readFileSync('scratch/skills-tooldesc.json', 'utf8'));
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { buildToolRegistry } = await import(pathToFileURL(join(process.cwd(), 'dist', 'registry.js')).href);
const mkLogger = () => ({ info() {}, warn() {}, error() {}, debug() {}, child() { return mkLogger(); } });
const noop = new Proxy({}, { get: () => () => { throw new Error('offline'); } });
const reg = buildToolRegistry({ foundry: noop, logger: mkLogger(), host: { name: 'generic', filePlane: null, wake: null } });
const full = Object.fromEntries(reg.tools.map(t => [t.name, (t.description ?? '') + ' ' + JSON.stringify(t.inputSchema)]));

const checks = [
  ['manage-effect', 'stat-block-builder L206-259 rules-change enums', ['dnd5e.advantage', 'dnd5e.bonus', 'dnd5e.minimum', 'dnd5e.maximum', 'roll.attack.type', 'roll.attack.mode', 'roll.attack.classification', 'roll.damage.type', 'roll.proficient', 'roll.tool', 'roll.skill', 'roll.ability', 'startswith', 'endswith', 'icontains', 'hasany', 'hasall', 'subsetof', 'NAND', 'NOR', 'XOR', 'targetEnd', 'sourceStart', 'shortRest', 'longRest', 'turnEnd', 'roundEnd', 'combatEnd', 'replacement', 'magical', 'statuses.bloodied']],
  ['manage-activity', 'stat-block-builder L261-322 area/teleport/transform enums', ['applyActiveEffect', 'difficultTerrain', 'terrainTypes', 'cylinder', 'teleportDistance', 'transformMode', 'wildshape', 'polymorphSelf', 'restrictMovement', 'formless', 'transformSettings', 'minimumAC', 'tempFormula', 'spellLists', 'transformTokens', 'gearProf', 'appliesEffects', 'onSave', 'castLevel', 'spellUuid', 'attackBonus']],
  ['add-region-behavior', 'scene-builder L44-71 behaviors', ['applyActiveEffect', 'difficultTerrain', 'rotateArea', 'terrainTypes', 'web', 'plants', 'ice', 'mud', 'sand', 'snow', 'rocks', 'slope', 'liquid', 'creatureTypes', 'dispositions', 'positions', 'direction', 'timeMs', 'choice']],
  ['add-item', 'physical-item-builder L145-155 itemType table', ['weapon', 'armor', 'shield', 'wondrous', 'consumable', 'tool', 'loot', 'container', 'armorValue', 'consumableType', 'lootType', 'toolType', 'wireAc', 'ammo', 'capacity', 'equipmentType']],
  ['create-pc', 'pc-builder L142-145 skill keys / wildcards', ['skills:acr', 'skills:ath', 'languages:standard', 'tool:game', 'weapon:mar', 'acceptDefaults', 'hpMode', 'multiclass', 'needsChoices', 'unresolvedScale']],
  ['add-feature', 'stat-block-builder L39-45 mode shape', ['compendium-features', 'featureType', 'attack-with-save', 'homebrew-spell', 'spellcasting', 'weaponClass', 'natural', 'featType', 'requirements', 'img']],
  ['update-actor', 'stat-block-builder L330-337 ac shapes', ['override', 'natural', 'tokenAutoRotate', 'tokenRing', 'tokenScale', 'currency', 'legendaryActions', 'legendaryResistances', 'habitat', 'treasure', 'telepathy']],
  ['create-scene', 'scene-builder L92-134 sidecar shapes', ['sight', 'sense', 'luminosity', 'attenuation', 'coloration', 'placeablesPath', 'passthrough', 'config']],
  ['configure-soundscape', 'soundscape-builder library/timing', ['whenToPlay', 'intervalVariation', 'volumeVariation', 'pitchVariation', 'crossfade', 'verifyFiles', 'section', 'category', 'library', 'playStyle', 'octave']],
  ['create-scene-notes', 'tom-cartos L287-297 pin math', ['sceneX', 'cell', 'col', 'row', 'label', 'global']],
  ['get-scene-dimensions', 'tom-cartos L287-289', ['sceneX', 'sceneY', 'columns', 'rows', 'padding']],
];
for (const [tool, where, toks] of checks) {
  const text = full[tool] ?? '';
  const present = toks.filter(t => text.includes(t));
  const absent = toks.filter(t => !text.includes(t));
  console.log(`${tool} (${text.length} chars) — ${where}\n   present ${present.length}/${toks.length}; ABSENT: ${absent.join(', ') || '—'}`);
}
