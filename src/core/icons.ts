// Item icons for the spoiler page, drawn from the player's own ROM: the equipment menu's icons (0B:$B199;
// docs/rom-notes.md#items-and-rewards), 16×16, in the menu's sprite palettes.

import type { Item } from './world.ts';

/** The menu's sprite palettes (colors 1-3; 0 is transparent): pal0 red, pal1 green, pal2 blue, pal3 orange. The menu's
 * orange is $26 (salmon), next to α's raspberry $15 hard to tell apart: $27, the building pickups'. */
const MENU_PALETTES = [
  [0x30, 0x15, 0x0f],
  [0x30, 0x2a, 0x0f],
  [0x30, 0x21, 0x0f],
  [0x30, 0x27, 0x0f],
];

/** Per item: the menu's tiles TL, BL, TR, BR (8×8 sprites, by columns: read from the menu's OAM) and palettes. The IFF Code and the Flak Map (randomizer items,
 * not in the menu) are a green and a red Permit card, as their pickups are. */
const MENU_ICONS: Partial<Record<Item, { tiles: number[]; pals: number[] }>> = {
  pendant: { tiles: [0xd6, 0xd8, 0xd7, 0xd9], pals: [3, 3, 3, 3] },
  helmet: { tiles: [0xda, 0xdc, 0xdb, 0xdd], pals: [1, 3, 1, 3] },
  vest: { tiles: [0xde, 0xe0, 0xdf, 0xe1], pals: [3, 2, 3, 2] },
  rocket: { tiles: [0xe6, 0xe8, 0xe7, 0xe9], pals: [3, 3, 0, 3] },
  wide: { tiles: [0xea, 0xec, 0xeb, 0xed], pals: [1, 3, 1, 1] },
  machine: { tiles: [0xee, 0xf0, 0xef, 0xf1], pals: [3, 3, 2, 3] },
  threeway: { tiles: [0xf2, 0xf4, 0xf3, 0xf5], pals: [0, 3, 0, 0] },
  flare: { tiles: [0xf6, 0xf8, 0xf7, 0xf9], pals: [0, 0, 0, 0] },
  pills: { tiles: [0xfa, 0xfc, 0xfb, 0xfd], pals: [3, 1, 3, 1] },
  permit: { tiles: [0xfe, 0x50, 0xff, 0x51], pals: [3, 3, 2, 0] },
  iff: { tiles: [0xfe, 0x50, 0xff, 0x51], pals: [1, 1, 1, 1] },
  flak: { tiles: [0xfe, 0x50, 0xff, 0x51], pals: [0, 0, 0, 0] },
  boots: { tiles: [0x56, 0x58, 0x57, 0x59], pals: [2, 2, 2, 2] },
  rapid: { tiles: [0x5a, 0x5c, 0x5b, 0x5d], pals: [2, 2, 2, 2] },
  alpha: { tiles: [0x5e, 0x60, 0x5f, 0x61], pals: [0, 0, 0, 0] },
  beta: { tiles: [0x5e, 0x60, 0x5f, 0x61], pals: [1, 1, 1, 1] },
  gamma: { tiles: [0x5e, 0x60, 0x5f, 0x61], pals: [2, 2, 2, 2] },
  delta: { tiles: [0x5e, 0x60, 0x5f, 0x61], pals: [3, 3, 3, 3] },
};

/** File offset of menu sprite tile `t`: $D5-$FF from 0x20D60, $50-$64 from 0x245D0. */
const tileAt = (t: number) => (t >= 0xd5 ? 0x20d60 + (t - 0xd5) * 16 : 0x245d0 + (t - 0x50) * 16);

/** `item`'s icon as 16×16 NES color indices (-1: transparent), or undefined for items without one. */
export function itemIcon(rom: Uint8Array, item: Item): number[][] | undefined {
  const icon = MENU_ICONS[item];
  if (!icon) return undefined;
  const out = Array.from({ length: 16 }, () => new Array<number>(16).fill(-1));
  icon.tiles.forEach((t, q) => {
    const at = tileAt(t),
      pal = MENU_PALETTES[icon.pals[q]],
      ox = (q >> 1) * 8,
      oy = (q & 1) * 8;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const c = ((rom[at + y] >> (7 - x)) & 1) | (((rom[at + 8 + y] >> (7 - x)) & 1) << 1);
        if (c) out[oy + y][ox + x] = pal[c - 1];
      }
  });
  return out;
}
