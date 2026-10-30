// The map screen as the game draws it, from the player's own ROM (for the simulator): the
// nametable's map rows (0B:$B2CC, 26x18 tiles, drawn at PPU $2063), its frame, the hidden
// roads once the passage is found (0B:$B276), the background tiles, attributes and palette the map screen loads. Found
// by dumping the PPU at the map in the emulator and finding the bytes in the ROM (docs/rom-notes.md#map-screen).

import { PATTERNS, ROAD_68, ROAD_810 } from './gatedisplay.ts';
import { NES_RGB } from './nespal.ts';

const file = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + (cpu - 0x8000);
/** The map rows: 26x18 tiles at nametable column 3, row 3. */
const MAP_NT = file(0x0b, 0xb2cc);
/** Background tiles $00-$7F (the map screen's pattern table $1000): 16 bytes each. */
const TILES = 0x1e010;
/** The map screen's attribute table (its first 48 bytes: rows 0-23). */
const ATTRIBUTES = 0x3e3d0;
/** Its palette (background: 4 x 4 colors). */
const PALETTE = 0x3d8d8;
/** Number-box centers by map number (0D:$A814: x, y in screen pixels). */
const COORDS = file(0x0d, 0xa814);
/** The hidden roads' tiles (0B:$B276, with $04F7 set): [row, column, tile]. */
const HIDDEN_ROADS: [number, number, number][] = [
  [18, 18, 0x24],
  [18, 19, 0x26],
  [19, 18, 0x25],
  [19, 19, 0x27],
  [8, 14, 0x05],
  [8, 15, 0x0a],
  [9, 14, 0x07],
  [9, 15, 0x33],
];

/** The part of the screen drawn: the map and its frame (nametable columns 2-29, rows 2-21). */
export const MAP_COLS = 28,
  MAP_ROWS = 20;
export const MAP_W = MAP_COLS * 8,
  MAP_H = MAP_ROWS * 8;
const COL0 = 2,
  ROW0 = 2;

/** How the game's options mark the map: a number box visited (blue) or cleared (green), as the map markers do (the box's
 * attribute quadrant switched to palette 2 or 3), and the gated roads still shut in red, as the gate display does
 * (its sprites, color $15, over the road's white pixels). */
export interface MapMarks {
  boxes?: Map<number, 'visited' | 'cleared'>;
  shut68?: boolean;
  shut810?: boolean;
}

/** The map screen as RGBA pixels, MAP_W x MAP_H. */
export function mapPixels(rom: Uint8Array, passage: boolean, marks: MapMarks = {}): Uint8ClampedArray<ArrayBuffer> {
  const boxPal = new Map<number, number>(); // tile row * 32 + column -> palette
  for (const [n, mark] of marks.boxes ?? []) {
    const c = (rom[COORDS + 2 * n] >> 3) - 1,
      r = (rom[COORDS + 2 * n + 1] >> 3) - 1;
    for (const t of [r * 32 + c, r * 32 + c + 1, (r + 1) * 32 + c, (r + 1) * 32 + c + 1])
      boxPal.set(t, mark === 'visited' ? 2 : 3);
  }
  const nt = new Map<number, number>(); // row * 32 + column -> tile
  for (let c = COL0; c < COL0 + MAP_COLS; c++) {
    nt.set(ROW0 * 32 + c, 0x02);
    nt.set((ROW0 + MAP_ROWS - 1) * 32 + c, 0x02);
  }
  for (let r = ROW0; r < ROW0 + MAP_ROWS; r++) {
    nt.set(r * 32 + COL0, 0x01);
    nt.set(r * 32 + COL0 + MAP_COLS - 1, 0x01);
  }
  for (const r of [ROW0, ROW0 + MAP_ROWS - 1]) for (const c of [COL0, COL0 + MAP_COLS - 1]) nt.set(r * 32 + c, 0x00); // (the corners)
  for (let r = 0; r < 18; r++) for (let c = 0; c < 26; c++) nt.set((r + 3) * 32 + c + 3, rom[MAP_NT + 26 * r + c]);
  if (passage) for (const [r, c, t] of HIDDEN_ROADS) nt.set(r * 32 + c, t);
  const out = new Uint8ClampedArray(MAP_W * MAP_H * 4);
  for (let r = 0; r < MAP_ROWS; r++)
    for (let c = 0; c < MAP_COLS; c++) {
      const R = r + ROW0,
        C = c + COL0,
        tile = nt.get(R * 32 + C) ?? 0x20;
      const attr = rom[ATTRIBUTES + (R >> 2) * 8 + (C >> 2)],
        pal = boxPal.get(R * 32 + C) ?? (attr >> (((R & 2) << 1) | (C & 2))) & 3;
      for (let y = 0; y < 8; y++) {
        const lo = rom[TILES + 16 * tile + y],
          hi = rom[TILES + 16 * tile + 8 + y];
        for (let x = 0; x < 8; x++) {
          const v = ((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1);
          const [red, green, blue] = NES_RGB[rom[PALETTE + (v ? pal * 4 + v : 0)] & 0x3f];
          out.set([red, green, blue, 255], ((r * 8 + y) * MAP_W + c * 8 + x) * 4);
        }
      }
    }
  // the shut roads in red: the gate display's sprites (x, y on screen; a sprite is drawn a line below its y)
  const red = NES_RGB[0x15];
  for (const [x, y, pat] of [...(marks.shut68 ? ROAD_68 : []), ...(marks.shut810 ? ROAD_810 : [])]) {
    for (let row = 0; row < 8; row++)
      for (let bit = 0; bit < 8; bit++) {
        if (!((PATTERNS[pat][row] << bit) & 0x80)) continue;
        const px = x + bit - COL0 * 8,
          py = y + 1 + row - ROW0 * 8;
        if (px >= 0 && px < MAP_W && py >= 0 && py < MAP_H) out.set([...red, 255], (py * MAP_W + px) * 4);
      }
  }
  return out;
}

/** Map number n's box center, in the drawn map's pixels. */
export function boxCenter(rom: Uint8Array, n: number): [number, number] {
  return [rom[COORDS + 2 * n] - COL0 * 8, rom[COORDS + 2 * n + 1] - ROW0 * 8];
}

/** The underground-passage stage's spots: the middles of the two hidden roads, 14<->17 and 15<->18 (either flies there). */
export const PASSAGE_SPOTS: [number, number][] = [
  [19 * 8 - COL0 * 8, 19 * 8 - ROW0 * 8],
  [15 * 8 - COL0 * 8, 9 * 8 - ROW0 * 8],
];
