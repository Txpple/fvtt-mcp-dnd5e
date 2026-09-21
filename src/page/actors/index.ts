// Page-side actor API — one barrel over the three export groups (F45 split the 2,257-line
// src/page/actors.ts along them: reads / writes / update). The page index and the dnd5e advancement
// module import from here; the bundle sees no boundary.

export {
  listActors,
  getCharacterInfo,
  exportActorData,
  getCharacterEntity,
  searchCharacterItems,
  findActor,
} from './reads.js';
export {
  extractDamageProfile,
  createActorFromCompendium,
  deleteActor,
  duplicateActor,
  addActorItems,
  removeActorItems,
} from './writes.js';
export { updateActor, updateActorItem } from './update.js';
