import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  JOIN_PASSWORD,
  JOIN_SUBMIT,
  JOIN_USER_FIELD,
  JOIN_USER_INPUT,
  JOIN_USER_SELECT,
} from './join-form.js';

// One saved /join page per Foundry version (test/fixtures/join/<version>.html). A new Foundry
// release gets its fixture here before the bridge is called compatible with it: Foundry 14.367
// and 14.369 each reshaped the user field, and each time the bridge hung on every live world.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'join');
const versions = readdirSync(FIXTURES)
  .filter(f => f.endsWith('.html'))
  .map(f => f.slice(0, -'.html'.length));

const page = (version: string) =>
  new JSDOM(readFileSync(join(FIXTURES, `${version}.html`), 'utf8')).window.document;

describe('the /join form selectors', () => {
  it('hold a fixture for every Foundry build the bridge has been verified on', () => {
    expect(versions).toEqual(expect.arrayContaining(['14.365', '14.367', '14.369']));
  });

  describe.each(versions)('Foundry %s', version => {
    const doc = page(version);

    it('is the build its file name says', () => {
      const build = version.split('.')[1];
      expect(doc.querySelector('#software-version')?.textContent).toContain(`Build ${build}`);
    });

    it('finds exactly one user field', () => {
      expect(doc.querySelectorAll(JOIN_USER_FIELD)).toHaveLength(1);
    });

    it('can name the bridge user in that field', () => {
      const select = doc.querySelector<HTMLSelectElement>(JOIN_USER_SELECT);
      if (select) {
        const users = [...select.options].map(o => o.textContent?.trim());
        expect(users).toContain('MCP-Claude');
      } else {
        expect(doc.querySelector<HTMLInputElement>(JOIN_USER_INPUT)?.type).toBe('text');
      }
    });

    it('finds the password field and submits the join form, not the setup form', () => {
      expect(doc.querySelector(JOIN_PASSWORD)?.closest('form')?.getAttribute('name')).toBe('join');
      expect(doc.querySelector(JOIN_SUBMIT)?.closest('form')?.getAttribute('name')).toBe('join');
    });
  });

  it('matches nothing on a page with no world (so the probe can tell "no world" from "joinable")', () => {
    const doc = new JSDOM(
      '<form method="post" action="setup"><input type="password" name="adminPassword"></form>'
    ).window.document;
    expect(doc.querySelectorAll(JOIN_USER_FIELD)).toHaveLength(0);
  });
});
