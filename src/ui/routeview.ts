// The route spoiler's view: each visit a collapsible entry with its requirements and lettered steps, item icons drawn
// from the player's ROM.

import { itemIcon } from '../core/icons.ts';
import { NES_RGB } from '../core/nespal.ts';
import type { RouteEntry } from '../core/routetext.ts';
import { ITEMS, type Item } from '../core/world.ts';

/** Item icons beside their names (the equipment menu's, drawn from the loaded ROM: icons.ts), one per item named
 * ("Rocket Launcher and 3-Way Gun": two); none for things without one (Super Joe, ammo). */
const iconCache = new Map<string, string | null>();
function icons(rom: Uint8Array | undefined, names: string): HTMLImageElement[] {
  return names.split(' and ').flatMap((name) => {
    if (!iconCache.has(name)) {
      const key = (Object.keys(ITEMS) as Item[]).find((k) => ITEMS[k].name === name);
      const px = rom && key ? itemIcon(rom, key) : undefined;
      let url: string | null = null;
      if (px) {
        const canvas = Object.assign(document.createElement('canvas'), { width: 16, height: 16 });
        const ctx = canvas.getContext('2d')!,
          data = ctx.createImageData(16, 16);
        px.flat().forEach((c, i) => {
          if (c >= 0) data.data.set([...NES_RGB[c], 255], 4 * i);
        });
        ctx.putImageData(data, 0, 0);
        url = canvas.toDataURL();
      }
      iconCache.set(name, url);
    }
    const url = iconCache.get(name);
    return url
      ? [Object.assign(document.createElement('img'), { className: 'icon', src: url, alt: '', width: 16, height: 16 })]
      : [];
  });
}
/** The route (RouteEntry): "Area 4 (O3) sent by …" (the reason in italics), the requirements (a box that stands
 * out: the communicator first), then the steps lettered a, b, c, optional ones in italics, the reward in bold. */
export function showRoute(routeList: HTMLElement, route: RouteEntry[], rom: Uint8Array | undefined) {
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) =>
    Object.assign(document.createElement(tag), { className, ...(text !== undefined && { textContent: text }) });
  const first = ['Briefing', 'Start'].includes(route[0]?.place) ? 0 : 1; // (0. Briefing, or the oracle's 0. Start)
  routeList.replaceChildren(
    ...route.map((r, k) => {
      // (collapsed by default; the title and reason, then the requirements and steps when opened)
      const li = document.createElement('li'),
        entry = el('details', 'entry'),
        head = el('summary', ''),
        body = el('div', 'entry-body');
      head.append(el('span', 'num', `${first + k}.`), ' ', el('span', 'place', r.place)); // (the number in the row)
      if (r.layout) head.append(' ', el('span', 'layout', `(${r.layout})`));
      if (r.why) head.append(' ', el('span', 'why', r.why));
      entry.append(head, body);
      li.append(entry);
      if (r.requirements.length) {
        const req = el('div', 'req');
        req.append(el('span', 'req-label', 'Requirements'));
        const ul = document.createElement('ul');
        for (const { item, why, struck } of r.requirements) {
          const it = document.createElement('li');
          it.append(...icons(rom, item), el(struck ? 's' : 'span', 'req-item', item));
          if (why) it.append(el('span', 'req-src', struck ? ` ${why}` : ` – ${why}`)); // ("~~Flare~~ Flareless")
          ul.append(it);
        }
        req.append(ul);
        body.append(req);
      }
      const steps = el('ol', 'steps');
      // (each step keeps its letter when the unneeded ones are hidden: the route cites them, "per 4c")
      if (r.steps.length && r.steps.every((s) => s.extra)) li.classList.add('extra');
      for (const [k, s] of r.steps.entries()) {
        const it = el(
          'li',
          [s.blocked ? 'blocked' : s.optional ? 'optional' : '', s.extra ? 'extra' : ''].filter(Boolean).join(' '),
        );
        it.value = k + 1;
        // (a dead end's red band on an inner span: the letter column stays put)
        const body = s.blocked ? el('span', 'dead-end') : it;
        if (body !== it) it.append(body);
        body.append(s.quote && s.text ? `${s.text}: ` : s.text);
        if (s.quote) body.append(el('code', 'said', s.quote));
        if (s.reward) body.append(' ', ...icons(rom, s.reward), el('strong', '', s.reward));
        if (s.note) body.append(` (${s.note})`);
        steps.append(it);
      }
      body.append(steps);
      return li;
    }),
  );
}
