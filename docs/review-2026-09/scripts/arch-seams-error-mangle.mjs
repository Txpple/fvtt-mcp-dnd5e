// arch-seams: what does the central error mapper (src/utils/error-handler.ts) do to a plain Error
// whose message trips one of its substring heuristics? Runs offline against dist/.
import { ErrorHandler } from '../dist/utils/error-handler.js';
import { Logger } from '../dist/logger.js';

const logger = new Logger({ level: 'error', format: 'simple', enableConsole: false, enableFile: false });
const eh = new ErrorHandler(logger);

const cases = [
  // [toolName, raw message a page handler or tool might throw]
  ['create-tiles', "foundry.call('createTiles') failed: Scene \"Crypt\" has no grid; set gridType first"],
  ['update-scene', "foundry.call('updateScene') failed: background.src must be a Data-relative path"],
  ['get-actor', "foundry.call('getActor') failed: Actor \"Gren\" not found (did you mean \"Grendel\"?)"],
  ['update-actor', "foundry.call('updateActor') failed: invalid field path system.attributes.hp.vale"],
  ['set-actor-ownership', "foundry.call('setActorOwnership') failed: unknown permission level \"OBSERVR\" — use OWNER/OBSERVER/LIMITED/NONE"],
  ['manage-effect', "foundry.call('manageEffect') failed: effect \"Bless\" is missing a change for system.bonuses.abilities.save"],
  ['search-compendium-spells', "foundry.call('searchCompendiumSpells') failed: pack dnd-players-handbook.spells not found — is the PHB installed?"],
  ['upload-asset', "WebDAV PUT timeout after 30000ms for assets/maps/big.webp"],
  ['asset-url', "MOLTEN_FILEBROWSER_URL is unset; the file browser link cannot be built"],
  ['create-actor-from-compendium', "foundry.call('createActorFromCompendium') failed: entry owlbear not found in dnd-monster-manual.actors"],
  ['list-journals', "foundry.call('listJournals') failed: Cannot read properties of undefined (reading 'pages')"],
  ['create-pc', "foundry.call('createPcActor') failed: advancement transaction aborted at level 3: no HP choice"],
];
for (const [tool, raw] of cases) {
  const out = eh.toUserMessage(new Error(raw), tool);
  const kept = out.includes(raw) || out.includes(raw.replace(/^foundry\.call\('[^']+'\) failed: /, ''));
  console.log(`\n[${tool}]\n  raw : ${raw}\n  out : ${out}\n  raw text preserved? ${kept ? 'YES' : 'NO — mangled'}`);
}
