// The in-browser demo build (demo/) defines __KKS_DEMO__; the real app does not.
declare const __KKS_DEMO__: boolean | undefined;

export const IS_DEMO = typeof __KKS_DEMO__ !== 'undefined' && __KKS_DEMO__ === true;

/** Set by the demo boot code: wipes this browser's demo data and starts over. */
export const demoHooks: { reset?: () => Promise<void> } = {};
