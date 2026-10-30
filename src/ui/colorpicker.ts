// A dropdown of NES color swatches (a native select can't show colors), for the cosmetic options.

/** Swatch colors per NES palette index (a bright, common emulator palette: closer to how the game looks than nespal.ts). */
export const SWATCH = [
  '7c7c7c',
  '0000fc',
  '0000bc',
  '4428bc',
  '940084',
  'a80020',
  'a81000',
  '881400',
  '503000',
  '007800',
  '006800',
  '005800',
  '004058',
  '000000',
  '000000',
  '000000',
  'bcbcbc',
  '0078f8',
  '0058f8',
  '6844fc',
  'd800cc',
  'e40058',
  'f83800',
  'e45c10',
  'ac7c00',
  '00b800',
  '00a800',
  '00a844',
  '008888',
  '000000',
  '000000',
  '000000',
  'f8f8f8',
  '3cbcfc',
  '6888fc',
  '9878f8',
  'f878f8',
  'f85898',
  'f87858',
  'fca044',
  'f8b800',
  'b8f818',
  '58d854',
  '58f898',
  '00e8d8',
  '787878',
  '000000',
  '000000',
  'fcfcfc',
  'a4e4fc',
  'b8b8f8',
  'd8b8f8',
  'f8b8f8',
  'f8a4c0',
  'f0d0b0',
  'fce0a8',
  'f8d878',
  'd8f878',
  'b8f8b8',
  'b8f8d8',
  '00fcfc',
  'f8d8f8',
  '000000',
  '000000',
];
export const swatchColor = (i: number) => `#${SWATCH[i & 0x3f]}`;
export const RANDOM_SWATCH = 'conic-gradient(#f83800, #f8b800, #58d854, #00e8d8, #0058f8, #f878f8, #f83800)';
/** A dropdown of color swatches (a native select can't show colors): a button, and a listbox that opens under it. */
export function colorPicker(
  box: HTMLElement,
  label: string,
  choices: readonly string[],
  color: (v: string) => string,
  name: (v: string) => string,
  value: string,
  onPick: (v: string) => void,
) {
  const swatch = (v: string) => Object.assign(document.createElement('i'), { style: `background: ${color(v)}` });
  const button = Object.assign(document.createElement('button'), { type: 'button', className: 'colorpick-button' });
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-label', label);
  const list = Object.assign(document.createElement('ul'), { className: 'colorpick-list', hidden: true, tabIndex: -1 });
  list.setAttribute('role', 'listbox');
  const items = choices.map((v) => {
    const li = document.createElement('li');
    li.setAttribute('role', 'option');
    li.dataset.value = v;
    li.append(swatch(v), name(v));
    li.addEventListener('click', () => {
      pick(v);
      close();
      button.focus();
    });
    return li;
  });
  list.append(...items);
  let active = 0;
  const show = (v: string) => {
    button.replaceChildren(swatch(v), Object.assign(document.createElement('span'), { textContent: name(v) }));
    items.forEach((li) => li.setAttribute('aria-selected', String(li.dataset.value === v)));
  };
  const pick = (v: string) => {
    value = v;
    show(v);
    onPick(v);
  };
  const highlight = (i: number) => {
    active = (i + items.length) % items.length;
    items.forEach((li, k) => li.classList.toggle('active', k === active));
    items[active].scrollIntoView({ block: 'nearest' });
  };
  const open = () => {
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    highlight(choices.indexOf(value));
    list.focus();
  };
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', () => (list.hidden ? open() : close()));
  button.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') highlight(active + 1);
    else if (e.key === 'ArrowUp') highlight(active - 1);
    else if (e.key === 'Home') highlight(0);
    else if (e.key === 'End') highlight(items.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') {
      pick(choices[active]);
      close();
      button.focus();
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      close();
      if (e.key === 'Escape') button.focus();
    } else return;
    e.preventDefault();
  });
  list.addEventListener('mousemove', (e) => {
    const i = items.indexOf((e.target as HTMLElement).closest('li')!);
    if (i >= 0 && i !== active) highlight(i);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!box.contains(e.target as Node)) close();
  });
  box.append(button, list);
  show(value);
}
