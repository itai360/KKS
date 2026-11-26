// node:zlib for the browser demo: reading an Excel file (a zip) needs a
// synchronous inflate, which browsers do not offer - the demo imports CSV and
// pasted lists, and says so for Excel files. Compressed database copies
// (server/src/storedDb.ts) belong to the serverless deployment, not the demo.

const unavailable = (what: string) => (): never => {
  throw Object.assign(new Error(what), { status: 400 });
};

export const inflateRawSync = unavailable('בגרסת ההדגמה אפשר לייבא קובץ CSV או להדביק רשימה; קובץ אקסל - באתר עצמו');
export const gzipSync = unavailable('לא זמין בגרסת ההדגמה');
export const gunzipSync = unavailable('לא זמין בגרסת ההדגמה');

export default { inflateRawSync, gzipSync, gunzipSync };
