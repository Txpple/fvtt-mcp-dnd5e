import { buildWithZod } from './perf-schema-zodmap.mjs';
import { bytes } from './perf-schema-lib.mjs';
const { tools, zodOf } = buildWithZod();
const FAM = {
  placeables: ['create-tiles','list-tiles','update-tiles','delete-tiles','create-lights','list-lights','update-lights','delete-lights','create-sounds','list-sounds','update-sounds','delete-sounds','create-drawings','list-drawings','update-drawings','delete-drawings','create-walls','list-walls','update-walls','delete-walls','list-tokens','place-tokens','update-token','delete-tokens','create-scene-notes','list-notes','update-note','delete-note','create-region','list-regions','update-region','delete-region','create-teleporter','add-region-behavior','remap-teleporters'],
  items: ['create-item','list-items','get-item','update-item','delete-item','import-item'],
  rolltables: ['create-rolltable','import-rolltable','list-rolltables','update-rolltable','roll-on-table','get-rolltable','delete-rolltable'],
};
for (const [fam, names] of Object.entries(FAM)) {
  let total = 0, desc = 0, schema = 0;
  for (const n of names) {
    const t = tools.find(t => t.name === n); if (!t) { console.log('MISSING', n); continue; }
    const z = zodOf.get(n);
    total += bytes(t); desc += t.description.length; schema += bytes(t.inputSchema);
    console.log(`${fam} ${n.padEnd(22)} zodType=${z._zod.def.type.padEnd(8)} def=${bytes(t)} desc=${t.description.length} schema=${bytes(t.inputSchema)}`);
  }
  console.log(`== ${fam}: ${names.length} tools, ${total} bytes (desc ${desc}, schema ${schema})\n`);
}
