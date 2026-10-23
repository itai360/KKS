// Hands a file the page generated to the browser's download.
// The demo build swaps this module for demo/download.ts (the viewer's save prompt).

export async function saveFile(filename: string, data: Blob): Promise<void> {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * A document or a sheet to keep: on a phone, the share sheet with the file itself - Google Drive, Files,
 * WhatsApp; elsewhere (or where sharing a file is not offered), a download.
 */
export async function shareOrSave(filename: string, data: Blob): Promise<void> {
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const file = typeof File === 'function' ? new File([data], filename, { type: data.type }) : null;
  if (phone && file && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename.replace(/\.[^.]+$/, '') });
      return;
    } catch (e) {
      // closed without choosing: nothing more to do
      if ((e as Error)?.name === 'AbortError') return;
    }
  }
  return saveFile(filename, data);
}
