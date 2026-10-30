// An info icon (ⓘ) showing a tip on hover or focus: the game options' explanations.

export interface TipContent {
  /** What the option needs (a bold block on top). */
  requires?: readonly string[];
  summary?: string;
  /** [name, what it does]: the name in bold. */
  items?: readonly (readonly [string, string])[];
  /** A closing remark (italic). */
  note?: string;
}
/** An info icon showing `tip` on hover or focus. */
export function infoIcon(about: string, tip: TipContent): HTMLElement {
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'info' });
  button.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M12 11v6" /><circle class="dot" cx="12" cy="7.6" r="1.3" /></svg>';
  const span = (className: string, ...kids: (string | Node)[]) => {
    const e = Object.assign(document.createElement('span'), { className });
    e.append(...kids);
    return e;
  };
  const bold = (text: string) => Object.assign(document.createElement('b'), { textContent: text });
  const box = span('tip');
  box.setAttribute('aria-hidden', 'true');
  // (a need written "A -or- B" shows its "or" plain and underlined)
  const need = (r: string) =>
    span('tip-item', '• ', ...r.split(' -or- ').flatMap((part, i) => (i ? [span('or', 'or'), part] : [part])));
  if (tip.requires?.length) box.append(span('tip-needs', bold('Requires:'), ...tip.requires.map(need)));
  if (tip.summary) box.append(span('tip-summary', tip.summary));
  if (tip.items?.length)
    box.append(span('tip-items', ...tip.items.map(([name, info]) => span('tip-item', '• ', bold(name), `: ${info}`))));
  if (tip.note) box.append(span('tip-note', tip.note));
  button.append(box);
  const spoken = [
    tip.requires?.length ? `Requires: ${tip.requires.join('; ').replace(/ -or- /g, ' or ')}.` : '',
    tip.summary ?? '',
    ...(tip.items ?? []).map(([n, i]) => `${n}: ${i}.`),
    tip.note ? `${tip.note}.` : '',
  ];
  button.setAttribute('aria-label', `About ${about}: ${spoken.filter(Boolean).join(' ')}`);
  return button;
}
