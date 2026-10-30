// Small page helpers.

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setStatus(el: HTMLElement, text: string, kind: 'ok' | 'error' | '' = '') {
  el.textContent = text;
  el.className = `status ${kind}`;
}

/** Save `data` as a file. */
export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copy text (the clipboard API, or a selection copy where it's missing); true when it worked. */
export async function copyText(text: string, from: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    from.select();
    return document.execCommand('copy');
  }
}
