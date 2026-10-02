// node:zlib for the browser demo: reading an Excel file (a zip) needs a
// synchronous inflate, which browsers do not offer - the demo imports CSV and
// pasted lists, and says so for Excel files.

export function inflateRawSync(): never {
  throw Object.assign(new Error('בגרסת ההדגמה אפשר לייבא קובץ CSV או להדביק רשימה; קובץ אקסל - באתר עצמו'), { status: 400 });
}

export default { inflateRawSync };
