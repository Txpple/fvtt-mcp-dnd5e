# maplib — a creator's map packs as a library on disk, and back into a world

Premium battlemap creators (The MAD Cartographer, Forgotten Adventures, Tom Cartos …) ship their
maps as Foundry **scene-pack modules**: a `module.json`, LevelDB compendiums holding fully
authored scenes (walls, doors, lights, ambient sounds, tiles, regions, multi-level layouts), and
the images and audio those scenes reference. Installing eighty of those modules into every world
is not how anyone wants to use them. `maplib` turns the installed (or merely unzipped) modules
into a plain folder library that any tool or model can scan, and puts one scene back into a live
world only when it is wanted, with everything the creator authored intact.

```
Maps_MC/                                  one library per creator (the folder name is the library id)
  catalog.json  catalog.md                every scene: pack, name, variant, size in squares, counts, folder
  mad-deserts/                            one folder per module (pack), named by its id
    pack.json                             the module manifest essentials, scene list, extras, docs
    assets/                               every image and sound the module ships, module layout kept
      images/maps/…  images/tiles/…  audio/…
    docs/                                 the pack's other documents as JSON (journals, Mass Edit prefabs)
    06-desert-spa/                        one folder per scene: <NN>-<name>[-<variant>]
      meta.json                           the compact sidecar for scanning (below)
      preview.jpg                         the map at ≤1024 px, for a quick look
      scene.json                          the whole Foundry scene document, paths rewritten to assets/…
      placeables.json                     {walls, lights, regions, sounds, tiles, notes, drawings}
    08-desert-temple-entrance-night/
```

`meta.json` is what a model reads first: creator, pack, scene name / base / variant / number, the
map file, pixel size, grid size and the map's size in squares, counts of walls / doors / lights /
sounds / tiles / regions / levels, the mood (darkness, global light), the assets the scene needs,
and the source ids for dedup. `scene.json` is the document itself, whole, so nothing the creator
authored is lost between extract and import. `placeables.json` is the same walls / lights /
regions in the sidecar shape `manage-scenes` `create` reads through `placeablesPath`, for the
cases where only the geometry is wanted on a different image.

## Extract

Install the creator's modules on the local sandbox (Foundry's Setup screen, or the admin API), stop
the world (the packs must not be open), then:

```bash
node scripts/maplib/extract.mjs --library "C:\Users\<you>\Desktop\Maps_MC" --creator "MAD Cartographer" --modules-dir "C:\Users\<you>\AppData\Local\FoundryVTT\Data\modules"
```

`--creator` is a case-insensitive regex matched against the module's authors, title and id;
`--modules-dir` defaults to `$FOUNDRY_DATA_DIR/modules`. An unzipped module that was never
installed (Tom Cartos sells direct downloads) goes in by path, and several can be mixed:

```bash
node scripts/maplib/extract.mjs --library "…\Maps_TC" --module "…\tom-cartos-into-the-wilds-…-land-of-rot-01"
```

A pack already in the library at the same version is skipped (`--force` redoes it); the catalogue
is rebuilt from every pack present. `--only <id>` limits a run; `--no-preview` skips the
previews (they need `sharp`, taken from this repo's or the imagegen sibling's `node_modules`).

What the extractor does with the document: strips the compendium keys, percent-decodes and
rewrites every `modules/<id>/…` path to `assets/…`, drops a thumbnail that points into the
creator's build world (Foundry regenerates it), and keeps everything else, including the flags of
modules the creator used (Levels, Wall Height, Monk's Active Tiles). Those flags are inert in a
world without the module and come alive when it is installed, which is the faithful choice.

## Import

```bash
FOUNDRY_HOST=local node scripts/maplib/import.mjs "…\Maps_MC\mad-deserts\06-desert-spa"
FOUNDRY_HOST=molten node scripts/maplib/import.mjs "…\Maps_MC\mad-deserts\06-desert-spa" --folder "Chapter 3" --name "The Spa at Ashar"
```

The import uploads the assets the scene references through the host's file plane (the local
`Data/` on the sandbox, WebDAV on Molten; files already there are kept unless `--overwrite`),
rewrites the document's paths to the destination (default
`worlds/<world>/assets/maplib/<pack id>/`), stamps `flags.maplib` with the pack, version and
source id, drops the pack-only flags (`scene-packer`, `cf`, `core.sourceId`), and creates the
scene in one `Scene.create` with every embedded collection. A scene imported before is refused
unless `--force`; `--dry-run` reports without changing anything; `--activate` activates it.

**Edited maps.** The library is also the editing surface: replace `assets/images/maps/<file>` (or
point `scene.json` and `meta.json` at a new file beside it) after an imagegen pass, and import as
usual. The import compares the image's pixel size with `meta.map.imagePixels` and warns when they
differ, because walls and lights are in canvas pixels and only line up on an image of the authored
size. Keep the size; change the paint.

## Not carried

Journals and Mass Edit prefabs are extracted to `docs/` as JSON for reading but not imported (the
MCP's journal tools can rebuild one by hand when a map's key is wanted). A region behaviour that
teleports to another scene still names the pack's scene and region ids after import; the importer
stamps the same provenance the MCP's remap reads, so once every scene a stair spans is in the
world, one `manage-placeables { kind: "regions", action: "remap-teleporters", sourceModule: "<pack id>" }`
re-points them. Scene-level playlists are not referenced by these packs.
