# Evidence for `docs/history/architecture-review-2026-09.md`

The review cites `scratch/…` paths (the orchestrator's gitignored working directory). This folder
is the tracked mirror so the numbers can be reproduced from a clone:

- `brief.md` — the brief every review agent read (ground rules, history, the owner's 3.0 decisions,
  the measurements taken beforehand).
- `notes/` — the long-form notes of the six review dimensions and the dnd5e/zod research stream.
- `scripts/` — the measurement scripts the streams wrote, as they ran. They import from `dist/`
  (run `npm run build` first) and were written to run from the repo root with the outputs under
  `scratch/`; the ones prefixed `profile-` / `pin-` drive the sandbox (`FOUNDRY_HOST=local`, one
  driver at a time). The load-bearing ones live on, maintained, as `scripts/measure/` (3.0 M0):
  `perf-schema-decompose` → `schema-decompose.mjs`, `perf-schema-toolsets` → `schema-toolsets.mjs`,
  `siblings-names-cost` → `names-cost.mjs`, `skills-matrix` → `skills-matrix.mjs`, and the live
  `measure-tool-results` → `tool-results.mjs`; `src/measure.test.ts` prints and ratchets the
  three offline numbers on every `npm test`.
- `data/` — the outputs the review's numbers come from: the 24-call baseline
  (`measure-2026-09-20c.json`), the live `search-compendium` profile, the 6.0.3 targeted checks,
  the `tools/list` decomposition and the three-shape experiment, the skill × tool matrix, the
  sibling census. The raw result bodies (`scratch/bodies-2026-09-20/`) are not mirrored — they
  contain the owner's world data; `scripts/measure/tool-results.mjs --bodies <dir>` regenerates them.
- `verification-verdicts.md` — the adversarial pass, one verdict per finding (9 confirmed, 41
  corrected, 0 refuted), with what each skeptic checked.
