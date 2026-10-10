// The startup browser check (issue #3, item 9). The paths are Playwright's own, read from the
// installed package; only the existence test is stubbed.
import { describe, expect, it } from 'vitest';
import { chromiumProblem } from './foundry.js';

describe('chromiumProblem', () => {
  it('asks for the headless shell a headless launch runs, beside the full build', () => {
    const asked: string[] = [];
    expect(
      chromiumProblem(p => {
        asked.push(p);
        return true;
      })
    ).toBeUndefined();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/chromium_headless_shell-\d+$/);
  });

  it('names the install command when the browser is missing', () => {
    const problem = chromiumProblem(() => false);
    expect(problem).toMatch(/^Playwright's Chromium is not installed \(.+ is missing\)/);
    expect(problem).toContain('`npx playwright install chromium`');
  });
});
