# Release checklist

> `npm test` is fast but **mocks `foundry.call`** — it proves Node-side arg shaping and the pure
> page-side logic, **not** that the code which mutates a live Foundry world works. The live gates
> below are off by default; a tag is green only when they ran, against a real world — the local
> sandbox by preference ([`docs/local-sandbox.md`](local-sandbox.md)).

## Before every release tag

1. **Full offline gate green** on `main`:

   ```sh
   npm run check        # biome
   npm run typecheck    # tsc --noEmit
   npm test             # vitest (unit) — prints the context budgets and fails past a ratchet
   npm run build        # tsc + esbuild page bundle
   npm run knip
   ```

2. **The release set green** — twelve live verify scripts, run **one at a time** (never in
   parallel: two drivers on one world race each other's writes), against the sandbox:

   ```sh
   for s in effects-6 region-effects activities-6 settings-calendar item-tooling actor-tooling \
            pc-build teleporter-scene-fields placeables-tooling scene-tools cast-activity region-tooling; do
     FOUNDRY_HOST=local node scripts/verify-$s.mjs || break
   done
   ```

   Each prints `N/N` and cleans its `ZZ-*` documents in `finally`; a script that leaves the world
   dirty is a bug, not a pass. The counts go in the release notes.

3. **The live integration suite green** — the same `.env` the server reads, the host selected by
   `FOUNDRY_HOST` (`FOUNDRY_URL`, `FOUNDRY_USER`, `FOUNDRY_ADMIN_KEY` for a cold launch; a wake URL
   on a host that sleeps). It runs `npm run build` first:

   ```sh
   FOUNDRY_HOST=local RUN_LIVE=1 npm run test:integration
   ```

   Confirm these suites **ran** (not skipped) and passed — a run with no `RUN_LIVE` only reports
   skips and does not satisfy this step:
   - `pc.int.test.ts` — PC build + advancement (HP, spell slots, multiclass, subclass, **zero
     unresolved `@scale`**);
   - `dnd5e-writes.int.test.ts` — NPC authoring + the activity / save / spell data model;
   - `write-cycle.int.test.ts`, `reads.int.test.ts`, `tools-reads.int.test.ts`, `chat.int.test.ts`,
     `bridge.int.test.ts` — CRUD round-trips, the read shapes, the bridge lifecycle.

   Without `FOUNDRY_HOST` the run targets `generic` (whatever `FOUNDRY_URL` names); with a
   placeholder URL every suite skips and says why.

4. **Smoke the headline tools over MCP** after a Claude Code restart (a changed tool schema needs
   one): `get-world-info` on the sandbox registration; build a multiclass level-3 PC (expect
   `success` + zero unresolved `@scale`); confirm a deliberately bad subclass uuid returns
   `success:false` + `errors[]` with no actor created.

5. **The numbers.** `npm run measure` and the `npm test` budget lines (tools/list chars, name
   chars per registration, skill-description chars, the always-on set) go in the release notes
   beside the verify counts, so the next release can be compared to this one.

6. **Version + changelog + tag.** Bump `version` in `package.json`, add the release to
   [`CHANGELOG.md`](../CHANGELOG.md) (what changed for a user, the numbers, the verified Foundry /
   dnd5e versions), update the version pins in the README, tag `vX.Y.Z`, push.

## After a Foundry or dnd5e upgrade

An upgrade is a compatibility event, not a release: the procedure (release notes → sandbox launch
→ bridge connect → targeted verifies → this release set → the pins) is in
[`CONTRIBUTING.md`](../CONTRIBUTING.md).
