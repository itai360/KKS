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
