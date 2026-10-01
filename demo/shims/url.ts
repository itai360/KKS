// node:url for the browser.
export const fileURLToPath = (u: string | URL) => String(u).replace(/^file:\/\//, '');
