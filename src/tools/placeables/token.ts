// Placed-token tools — list / place / update / delete a token INSTANCE on a scene.
//
// The lifecycle split this module documents: PLACE copies the actor's prototype token onto the map
// (batch encounter prep — the GM usually just drags); UPDATE is the bespoke actor→all-copies editor
// with the lockRotation gotcha; DELETE removes the placed instance only (the sidebar actor is
// delete-actor's job). Page-side correctness lives in src/page/placeables/token.ts.

import { z } from 'zod';
import { toInputSchema } from '../../utils/schema.js';
import {
  formatCreatePlaceables,
  formatDeletePlaceables,
  formatListPlaceables,
} from '../../utils/placeable-format.js';
import { sceneTarget, type PlaceableModuleFactory } from './_module.js';

const ListTokensSchema = z.object({ sceneIdentifier: sceneTarget });

const PlaceTokensSchema = z.object({
  sceneIdentifier: sceneTarget,
  tokens: z
    .array(
      z.object({
        actor: z.string().min(1).describe('Actor id or exact name (its prototype token).'),
        x: z.number().describe('Top-left X in absolute canvas pixels.'),
        y: z.number().describe('Top-left Y in absolute canvas pixels.'),
        hidden: z.boolean().optional().describe('Hidden from players.'),
        elevation: z.number().optional().describe('Elevation in grid-distance units.'),
        rotation: z.number().optional().describe('Facing in degrees (0–359).'),
        name: z.string().optional().describe('Nameplate (default the prototype name).'),
        disposition: z
          .enum(['friendly', 'neutral', 'hostile', 'secret'])
          .optional()
          .describe('Overrides the prototype for this copy.'),
      })
    )
    .min(1)
    .describe('The tokens to place; repeat an actor for several copies.'),
});

const DeleteTokensSchema = z.object({
  sceneIdentifier: sceneTarget,
  tokenIds: z
    .array(z.string().min(1))
    .min(1)
    .describe('Placed-token ids; the sidebar actor is untouched.'),
});

// --- update-token (bespoke — actor→all-copies matching + the lockRotation gotcha) ---
const UpdateTokenSchema = z
  .object({
    sceneIdentifier: sceneTarget,
    tokenIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Placed-token ids; a union with actorIds.'),
    actorIds: z
      .array(z.string().min(1))
      .optional()
      .describe('Actor ids or exact names: every placed copy of each; a union with tokenIds.'),
    rotation: z.number().optional().describe('Facing in degrees (0–359), for every matched token.'),
    randomizeRotation: z
      .boolean()
      .optional()
      .describe('Each matched token gets its own random angle; overrides rotation.'),
    scale: z
      .number()
      .positive()
      .optional()
      .describe('Token art scale (texture.scaleX / scaleY together): 1 normal, 1.5 = 50% larger.'),
    imagePath: z
      .string()
      .min(1)
      .optional()
      .describe(
        'New token art (path or URL; image or video) for the placed copies only; a 404 keeps the ' +
          'current art with a warning.'
      ),
    elevation: z
      .number()
      .optional()
      .describe(
        'Elevation in grid-distance units (with falling automation on, above the surface = Falling).'
      ),
    hidden: z.boolean().optional().describe('Hidden from players.'),
    lockRotation: z
      .boolean()
      .optional()
      .describe('true hides any rotation; rotating a locked token auto-unlocks it with a warning.'),
    x: z.number().optional().describe('New X in absolute canvas pixels.'),
    y: z.number().optional().describe('New Y in absolute canvas pixels.'),
    name: z.string().min(1).optional().describe('Rename the placed token.'),
    displayName: z
      .enum(['none', 'control', 'owner-hover', 'hover', 'owner', 'always'])
      .optional()
      .describe('Nameplate visibility (control = when selected).'),
    displayBars: z
      .enum(['none', 'control', 'owner-hover', 'hover', 'owner', 'always'])
      .optional()
      .describe('Resource-bar visibility, same modes as displayName.'),
    bar1: z
      .string()
      .optional()
      .describe('Bar 1 attribute path (the health bar is "attributes.hp"); "" clears.'),
    bar2: z.string().optional().describe('Bar 2 attribute path; "" clears.'),
    ring: z.boolean().optional().describe('Dynamic token ring on / off.'),
    hp: z
      .object({
        value: z.number().int().optional().describe('Current hit points.'),
        max: z.number().int().optional().describe('Max hit points.'),
        temp: z.number().int().optional().describe('Temporary hit points.'),
        tempmax: z
          .number()
          .int()
          .optional()
          .describe('Max-HP modifier (system.attributes.hp.tempmax).'),
      })
      .optional()
      .describe(
        "Hit points on the token's own delta (linked: the base actor); only the sub-fields passed " +
          'change.'
      ),
  })
  .refine(v => (v.tokenIds?.length ?? 0) > 0 || (v.actorIds?.length ?? 0) > 0, {
    message: 'Provide at least one target: tokenIds and/or actorIds.',
  })
  .refine(
    v =>
      v.rotation !== undefined ||
      v.randomizeRotation === true ||
      v.scale !== undefined ||
      v.imagePath !== undefined ||
      v.elevation !== undefined ||
      v.hidden !== undefined ||
      v.lockRotation !== undefined ||
      v.x !== undefined ||
      v.y !== undefined ||
      v.name !== undefined ||
      v.displayName !== undefined ||
      v.displayBars !== undefined ||
      v.bar1 !== undefined ||
      v.bar2 !== undefined ||
      v.ring !== undefined ||
      v.hp !== undefined,
    {
      message:
        'Provide at least one field to change (rotation, randomizeRotation, scale, imagePath, elevation, hidden, lockRotation, x, y, name, displayName, displayBars, bar1, bar2, ring, or hp).',
    }
  );

export const tokenToolModule: PlaceableModuleFactory = foundry => ({
  defs: [
    {
      name: 'list-tokens',
      description:
        'Every placed token on a scene: id, name, x / y, size, rotation, elevation, hidden, ' +
        'disposition, actorId, art + scale, lockRotation. A token id is also an actor target for the ' +
        "actor tools (that token's own delta, not the base actor).",
      inputSchema: toInputSchema(ListTokensSchema),
    },
    {
      name: 'place-tokens',
      description:
        "Place actors' tokens on a scene from their prototypes, at canvas-pixel x / y, with " +
        'per-copy hidden / elevation / rotation / name / disposition overrides. GM-only.',
      inputSchema: toInputSchema(PlaceTokensSchema),
    },
    {
      name: 'update-token',
      description:
        'Edit placed tokens (not the prototype: update-actor) by tokenIds and/or actorIds (every ' +
        'placed copy of an actor): rotation, scale, art, elevation, hidden, lockRotation, position, ' +
        "name, nameplate / bar visibility, bars, ring, and hp on the token's own delta. Reports " +
        'matched / updated and unresolved ids. GM-only.',
      inputSchema: toInputSchema(UpdateTokenSchema),
    },
    {
      name: 'delete-tokens',
      description:
        'Remove placed tokens by id; the sidebar actor survives. Missing ids are reported, never ' +
        'fatal. GM-only.',
      inputSchema: toInputSchema(DeleteTokensSchema),
    },
  ],
  handlers: {
    'list-tokens': async args => {
      const parsed = ListTokensSchema.parse(args ?? {});
      const result = await foundry.call('listSceneTokens', parsed);
      return formatListPlaceables(result, 'token');
    },
    'place-tokens': async args => {
      const { sceneIdentifier, tokens } = PlaceTokensSchema.parse(args ?? {});
      const result = await foundry.call('placeSceneTokens', { sceneIdentifier, items: tokens });
      return formatCreatePlaceables(result, 'token');
    },
    'update-token': async args => {
      const parsed = UpdateTokenSchema.parse(args ?? {});
      const result = await foundry.call('updateSceneTokens', parsed);
      if (result?.notFound) {
        return `Scene not found: "${result.notFound}". Nothing changed.`;
      }
      const um = result?.unmatched ?? {};
      const umBits = [
        ...(um.tokenIds?.length ? [`token ${um.tokenIds.join(', ')}`] : []),
        ...(um.actorIds?.length ? [`actor ${um.actorIds.join(', ')}`] : []),
      ];
      if ((result?.matched ?? 0) === 0) {
        return (
          `No tokens matched on "${result?.sceneName}" (${result?.sceneId})` +
          (umBits.length ? ` — unresolved ${umBits.join('; ')}` : '') +
          '.'
        );
      }
      const rows = Array.isArray(result?.tokens)
        ? result.tokens
            .map(
              (t: any) =>
                `\n  • ${t.name} (${t.id}) — rot ${t.rotation}°, scale ${t.scale}, elev ${t.elevation}` +
                `${t.hidden ? ', hidden' : ''}, name ${t.displayName}, bars ${t.displayBars}` +
                `${t.bar1 ? ` (${t.bar1})` : ''}, ring ${t.ring ? 'on' : 'off'}` +
                `${t.hp ? `, hp ${t.hp.value}/${t.hp.max}` : ''}` +
                `${t.src ? `, art ${t.src}` : ''}`
            )
            .join('')
        : '';
      const warns = Array.isArray(result?.warnings) ? result.warnings : [];
      const warnLine = warns.length
        ? `\n\n⚠️ ${warns.length} note(s):\n${warns.map((w: string) => `- ${w}`).join('\n')}`
        : '';
      const umLine = umBits.length ? `\n  (unresolved: ${umBits.join('; ')})` : '';
      return (
        `Updated ${result?.updated ?? 0} of ${result?.matched ?? 0} matched token(s) on ` +
        `"${result?.sceneName}" (${result?.sceneId})` +
        rows +
        umLine +
        warnLine
      );
    },
    'delete-tokens': async args => {
      const { sceneIdentifier, tokenIds } = DeleteTokensSchema.parse(args ?? {});
      const result = await foundry.call('deleteSceneTokens', { sceneIdentifier, ids: tokenIds });
      return formatDeletePlaceables(result, 'token');
    },
  },
});
