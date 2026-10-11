// Ambient globals available inside the headless Foundry page.
// The page-side domain library (src/page/**) runs in the browser with these in scope.
// foundry-vtt-types (v9) doesn't cover Foundry 14, so we declare the surface we use loosely;
// correctness is guaranteed by the live oracle/acceptance tests, not by these stubs.

declare const game: any;
declare const CONFIG: any;
declare const ui: any;
declare const Hooks: any;
declare const foundry: any;
declare const fromUuid: (uuid: string) => Promise<any>;
declare const fromUuidSync: (uuid: string) => any;
declare const Roll: any;
declare const dnd5e: any;

interface Window {
  // The injected domain API, raw (the run-script facade and the siblings' evaluate reach it).
  __fvtt: Record<string, (args?: any) => any>;
  // The bridge's entry point (src/page/_receipts.ts callOp): foundry.call(name, args) lands here.
  __fvttCall: (
    name: string,
    args: unknown,
    opts?: { record?: boolean }
  ) => Promise<import('./_receipts.js').CallOutcome>;
}
