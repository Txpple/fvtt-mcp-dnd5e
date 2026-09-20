#!/bin/bash
# siblings-grep.sh — count references to this repo across the sibling repos (tracked files only).
cd /d/Workbench/FVTT/Repos
REPOS="fvtt-mod-autoexplore fvtt-mod-battleflow fvtt-mod-combatplus fvtt-mod-fxstudio fvtt-mod-lootshelf fvtt-mod-miscpatches fvtt-mod-openserver fvtt-mod-partystash fvtt-mod-soundscape fvtt-mod-soundscape-sfx fvtt-mcp-artificer fvtt-campaign-greenrest"
PATTERNS="fvtt-mcp-molten5e fvtt-mcp-dnd5e foundry-molten5e foundry-local5e dist/foundry.js local-foundry.mjs deploy-house-module configure-modules upload-soundscape-library pull-prod-to-local register-module uninstall-modules reload-clients remap-soundscape-scene-paths mcp__foundry- disconnect-bridge get-world-info"
for p in $PATTERNS; do
  echo "=== PATTERN: $p"
  for r in $REPOS; do
    # tracked files only, excluding node_modules and .claude/worktrees
    n=$(git -C $r grep -c -F -- "$p" -- ':!node_modules' ':!.claude/worktrees' 2>/dev/null | awk -F: '{s+=$NF; f++} END {printf "%d hits in %d files", s, f}')
    [ "$n" != "0 hits in 0 files" ] && echo "  $r: $n"
  done
done
