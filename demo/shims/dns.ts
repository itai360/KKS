// node:dns/promises for the browser demo: it never fetches outside addresses from the "server".
export async function lookup(): Promise<{ address: string; family: number }[]> {
  throw new Error('no DNS in the demo');
}
