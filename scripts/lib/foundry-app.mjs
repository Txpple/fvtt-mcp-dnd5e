// Where the local Foundry install's server entry (resources/app/main.js) is: FOUNDRY_APP (alias
// LOCAL_FOUNDRY_APP), else the first default install location that has it. Shared by
// scripts/local-foundry.mjs (which runs it) and scripts/doctor.mjs (which checks it is there).
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The installer's default targets, in the order they are tried. */
function defaultCandidates(platform, localAppData) {
  if (platform === 'win32') {
    // All users (Program Files) and per user (%LOCALAPPDATA%).
    return [
      'C:\\Program Files\\Foundry Virtual Tabletop\\resources\\app\\main.js',
      ...(localAppData
        ? [
            join(
              localAppData,
              'Programs',
              'Foundry Virtual Tabletop',
              'resources',
              'app',
              'main.js'
            ),
          ]
        : []),
    ];
  }
  if (platform === 'darwin') {
    return ['/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app/main.js'];
  }
  return ['/opt/foundryvtt/resources/app/main.js'];
}

/**
 * `{ main, tried, found }`: the main.js to run, every path that was considered (the override
 * alone when one is set) and whether `main` exists. `env` is the parsed .env map.
 */
export function foundryApp(
  env,
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA
) {
  const override = env.FOUNDRY_APP || env.LOCAL_FOUNDRY_APP;
  const candidates = defaultCandidates(platform, localAppData);
  const tried = override ? [override] : candidates;
  const main = override || candidates.find(p => existsSync(p)) || candidates[0];
  return { main, tried, found: existsSync(main) };
}
