// Demo build's saveFile: the page's frame cannot download by itself, so the
// file goes through the viewer's own save prompt (the "downloads" capability).

interface Downloads {
  save(r: { filename: string; data: Blob }): Promise<unknown>;
}
interface ClaudeHost {
  use(name: 'downloads'): Promise<Downloads | null>;
}

let ns: Promise<Downloads | null> | null = null;
function downloads(): Promise<Downloads | null> {
  const host = (window as unknown as { claude?: ClaudeHost }).claude;
  ns ??= host?.use ? host.use('downloads').catch(() => null) : Promise.resolve(null);
  return ns;
}

export async function saveFile(filename: string, data: Blob): Promise<void> {
  const d = await downloads();
  if (!d) throw new Error('שמירת קבצים אינה זמינה בתצוגה הזו');
  try {
    await d.save({ filename, data });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'declined') return;
    if (code === 'rejected_extension' || code === 'extension_not_enabled') throw new Error('אי אפשר לשמור קובץ מהסוג הזה כאן');
    if (code === 'rate_limited') throw new Error('חלון שמירה כבר פתוח');
    throw new Error('השמירה לא הצליחה');
  }
}
