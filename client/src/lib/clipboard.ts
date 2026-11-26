// The clipboard: copying a message (WhatsApp formats, links) and reading one pasted from elsewhere. The
// browser's own way first; where it is refused (an old browser, a page not served securely), the old way.

/** copies text; false when the browser would not */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // a hidden text box, selected and copied - works where the clipboard API is not allowed
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.cssText = 'position:fixed;inset-inline-start:-9999px;top:0;opacity:0';
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

/** what is on the clipboard; null when the browser does not let the page read it (it asks the person to paste) */
export async function readText(): Promise<string | null> {
  try {
    if (!navigator.clipboard?.readText) return null;
    return await navigator.clipboard.readText();
  } catch {
    return null;
  }
}
