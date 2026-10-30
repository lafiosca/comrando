// Map markers (option): the overworld map shows which areas you've been in and which you've cleared.
// Visited (entered: leaving the equipment screen into the level, any area incl. neutral zones): the number box's
// border and digit turn blue. Cleared: they turn green. An enemy area is cleared by its boss; a neutral zone once its
// significant items are collected (`zoneFlags`: the flags of the items in its buildings, which are unique, so owning
// one means it was taken there; a zone with none turns green once visited). Each box is exactly one attribute quadrant (BG palette 0, pink); the routine
// switches it to the map's palette 2 (white/blue/green) or 3 (white/green/red), whose color 2 draws the box's
// border and digit. No new graphics. Map numbers are fixed, so boxes are found by spot; the flags are looked up by
// the identity (layout) placed at that spot. See docs/rom-notes.md#map-screen.

import { assemble, type Asm } from './asm.ts';
import { GATE_0B } from './gatedisplay.ts';
import type { MapLayout } from './zones.ts';

const BANK0B = 0x10 + 0x0b * 0x4000;
const BANK0D = 0x10 + 0x0d * 0x4000;
const off0B = (cpu: number) => BANK0B + cpu - 0x8000;
const off0D = (cpu: number) => BANK0D + cpu - 0x8000;

/** Visited flags: one bit per identity, bit (id & 7) of $01D0 + (id >> 3). $01CE-$01E8 is unused (below the stack). */
export const VISITED = 0x01d0;
const COORDS = 0xa814; // 0D: 20 x (x, y) by identity = by spot before the layout is applied
const MAP_NT = 0xb2cc; // 0B: raw 26x18 map tiles, drawn to PPU $2063 by 0B:$B229
const DRAW_HOOK = 0xb276; // 0B: LDA $04F7 (hidden-road check after the map tiles are drawn)
const DRAW_ROUTINE = 0xb4a0; // 0B: unused EPROM fill $B4A0-$B7FF
const DRAW_END = GATE_0B; // the gate display's part from $B5C0 ($B700-$B7FF is lent to text, text.ts)
const MAP_ATTRIBUTES = 0x10 + 0x0f * 0x4000 + 0x23bd; // 0F:$E3BD: the map screen's attribute upload ($23C0, 48 bytes)
const ENTER_HOOK = 0xaacb; // 0D: equipment screen -> level
const VISIT_ROUTINE = 0x9cc0; // 0D: free $9CC0-$9CFF

/** The four box tiles (TL, TR, BL, BR) for map number n (docs/rom-notes.md#map-screen). */
function boxTiles(n: number): number[] {
  if (n < 10) return [0x40 + 4 * n, 0x42 + 4 * n, 0x41 + 4 * n, 0x43 + 4 * n];
  if (n <= 12) { const r = [0x6a, 0x6e, 0x70][n - 10]; return [0x68, r, 0x69, r + 1]; }
  const r = 0x72 + 2 * (n - 13);
  return [0x6c, r, 0x6d, r + 1];
}

function expectBytes(rom: Uint8Array, o: number, bytes: number[], what: string) {
  if (bytes.some((b, i) => rom[o + i] !== b)) throw new Error(`map markers: unexpected bytes at ${what}`);
}

/** Flak Map flag in the green-check lists ($01D3 is the only flag outside page 4). */
const FLAG_FLAK = 0x01d3;

/**
 * `zoneFlags`: per neutral-zone layout (13-19), the RAM flags that are all set once its significant items are taken
 * (page-4 flags, or the Flak Map's $01D3).
 */
export function applyMapMarkers(rom: Uint8Array, layout: MapLayout, zoneFlags: Map<number, number[]> = new Map()) {
  const at = (spot: number) => layout.get(spot) ?? spot;

  // --- per-spot table: id, attribute low byte, palette-2 bits, palette-3 bits, offset of its green-check list ---
  // A list holds the low bytes of page-4 flags that must all be set for green, 1 for the Flak Map's $01D3, 0 to end.
  const table: number[] = [];
  const lists: number[] = [];
  const flagCode = (a: number) => {
    if (a === FLAG_FLAK) return 1;
    if (a >> 8 !== 0x04 || (a & 0xff) < 2) throw new Error(`map markers: flag $${a.toString(16)} not encodable`);
    return a & 0xff;
  };
  for (const spot of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 15, 16, 17, 18, 19]) {
    const x = rom[off0D(COORDS + 2 * spot)], y = rom[off0D(COORDS + 2 * spot) + 1];
    const gc = x / 8 - 4, gr = y / 8 - 4; // box position in the 26x18 map grid
    const [tl, tr, bl, br] = boxTiles(spot);
    expectBytes(rom, off0B(MAP_NT) + gr * 26 + gc, [tl, tr], `map box ${spot}`);
    expectBytes(rom, off0B(MAP_NT) + (gr + 1) * 26 + gc, [bl, br], `map box ${spot}`);
    const col = gc + 3, row = gr + 3; // the grid is drawn from PPU $2063
    if (col % 2 || row % 2) throw new Error(`map markers: box ${spot} not on the attribute grid`);
    const attr = 0xc0 + (row >> 2) * 8 + (col >> 2);
    const shift = ((row >> 1) & 1) * 4 + ((col >> 1) & 1) * 2;
    const id = at(spot);
    const flags = id <= 11 ? [0x04ea + id] : zoneFlags.get(id) ?? []; // area: its cleared flag ($04EA + id)
    table.push(id, attr, 2 << shift, 3 << shift, lists.length);
    lists.push(...flags.map(flagCode), 0);
  }
  table.push(0xff);

  // --- map number 0 (the start, nothing to do there): always green, in the map's own attribute table ---
  {
    const x = rom[off0D(COORDS)], y = rom[off0D(COORDS) + 1], col = x / 8 - 1, row = y / 8 - 1;
    expectBytes(rom, MAP_ATTRIBUTES, [0x23, 0xc0, 0x30], 'map attribute upload');
    const o = MAP_ATTRIBUTES + 3 + (row >> 2) * 8 + (col >> 2), shift = ((row >> 1) & 1) * 4 + ((col >> 1) & 1) * 2;
    if (col % 2 || row % 2 || ((rom[o] >> shift) & 3) !== 0) throw new Error('map markers: box 0 not a palette-0 quadrant');
    rom[o] |= 3 << shift;
  }
  if (lists.length > 0x100) throw new Error('map markers: green-check lists too long');
  const E = 5; // entry size

  // --- 0B draw routine, called from the map draw (rendering is off) ---
  const TMP = 0x17, MASK = 0x18; // zero-page temps 0B:$B229 is done with
  const code: Asm[] = [
    0xa2, 0x00, //                         LDX #0
    { label: 'loop' },
    { abs: 0xbd, to: 'table' }, 0xc9, 0xff, { rel: 0xd0, to: 'go' }, { abs: 0x4c, to: 'done' }, // end at $FF
    { label: 'go' },
    0x29, 0x07, 0xa8, 0xa9, 0x01, //       AND #7 / TAY / LDA #1
    { label: 'shift' }, 0x88, { rel: 0x30, to: 'shifted' }, 0x0a, { rel: 0xd0, to: 'shift' }, // DEY / BMI / ASL / BNE
    { label: 'shifted' }, 0x85, MASK, //   STA mask
    { abs: 0xbd, to: 'table' }, 0x4a, 0x4a, 0x4a, 0xa8, // LDA id / LSR x3 / TAY
    0xb9, VISITED & 0xff, VISITED >> 8, 0x25, MASK, 0x85, MASK, // LDA visited,Y / AND mask / STA mask (0: not visited)
    // green if every flag in its list is set (an empty list: once visited), else blue if visited
    { abs: 0xbc, to: 't4' }, { abs: 0xb9, to: 'lists' }, { rel: 0xd0, to: 'flag' }, // LDY offset,X / LDA lists,Y / BNE flag
    0xa5, MASK, { rel: 0xf0, to: 'next' }, { rel: 0xd0, to: 'green' }, // empty: LDA mask / BEQ next / BNE green
    { label: 'flag' },
    0x84, TMP, 0xc9, 0x01, { rel: 0xd0, to: 'page4' }, // STY tmp / CMP #1 / BNE page4
    0xad, FLAG_FLAK & 0xff, FLAG_FLAK >> 8, 0x18, { rel: 0x90, to: 'check' }, // LDA $01D3 / CLC / BCC check
    { label: 'page4' }, 0xa8, 0xb9, 0x00, 0x04, // TAY / LDA $0400,Y
    { label: 'check' }, { rel: 0xf0, to: 'notall' }, // BEQ notall (not taken yet)
    0xa4, TMP, 0xc8, { abs: 0xb9, to: 'lists' }, { rel: 0xd0, to: 'flag' }, // LDY tmp / INY / LDA lists,Y / BNE flag
    { label: 'green' }, { abs: 0xbd, to: 't3' }, { rel: 0xd0, to: 'write' }, // palette 3 bits (never 0)
    { label: 'notall' }, 0xa5, MASK, { rel: 0xf0, to: 'next' }, // LDA mask / BEQ next (not visited)
    { abs: 0xbd, to: 't2' }, //            palette 2 bits
    { label: 'write' },
    // attribute quadrant |= bits (read-modify-write through $2007; the first read is the buffer)
    0x85, MASK, 0xad, 0x02, 0x20,
    0xa9, 0x23, 0x8d, 0x06, 0x20, { abs: 0xbd, to: 't1' }, 0x8d, 0x06, 0x20,
    0xad, 0x07, 0x20, 0xad, 0x07, 0x20, 0x05, MASK, 0x48, // LDA $2007 x2 / ORA mask / PHA
    0xa9, 0x23, 0x8d, 0x06, 0x20, { abs: 0xbd, to: 't1' }, 0x8d, 0x06, 0x20,
    0x68, 0x8d, 0x07, 0x20, //            PLA / STA $2007
    { label: 'next' },
    0x8a, 0x18, 0x69, E, 0xaa, { abs: 0x4c, to: 'loop' }, // TXA / CLC / ADC #E / TAX / JMP loop
    { label: 'done' },
    0xad, 0xf7, 0x04, 0x60, //            LDA $04F7 / RTS (the hook's caller branches on it)
    { label: 'table' }, table,
    { label: 'lists' }, lists,
  ];
  const labels: Record<string, number> = {};
  const probe = assemble(DRAW_ROUTINE, code, labels);
  for (let i = 1; i < E; i++) labels[`t${i}`] = labels.table + i;
  const bytes = assemble(DRAW_ROUTINE, code, labels);
  if (bytes.length !== probe.length) throw new Error('map markers: assembler size mismatch');
  if (DRAW_ROUTINE + bytes.length > DRAW_END) throw new Error(`map markers: draw routine too big (${bytes.length} bytes)`);
  const free = off0B(DRAW_ROUTINE);
  for (let i = 0; i < DRAW_END - DRAW_ROUTINE; i++) {
    const v = rom[free + i], fill = ((DRAW_ROUTINE + i - 0xb4a0) >> 5) & 1 ? 0xff : 0x00;
    if (v !== fill) throw new Error('map markers: 0B:$B4A0-$B7FF is not the unused fill');
  }
  rom.set(bytes, free);
  expectBytes(rom, off0B(DRAW_HOOK), [0xad, 0xf7, 0x04, 0xf0, 0x50], 'map draw hook');
  rom.set([0x20, DRAW_ROUTINE & 0xff, DRAW_ROUTINE >> 8], off0B(DRAW_HOOK)); // JSR; the BEQ after it stays

  // --- 0D: entering an area (leaving the equipment screen into the level) marks it visited ---
  // 0D:$AACB is the equipment screen's only exit into the level (`INC $CC / LDA #0 / STA $CD...`); cancelling back to the
  // map doesn't pass here. Truck and passage stages also come through, with $4C >= $13 and $4D still the take-off
  // area, so they're skipped.
  expectBytes(rom, off0D(ENTER_HOOK), [0xe6, 0xcc, 0xa9, 0x00, 0x85, 0xcd], 'equipment screen exit');
  expectBytes(rom, off0D(VISIT_ROUTINE), new Array(0x2c).fill(0xff), 'free space 0D:$9CC0'); // ($9CEC on: rapid fire)
  const visit = assemble(VISIT_ROUTINE, [
    0xa5, 0x4c, 0xc9, 0x13, { rel: 0xb0, to: 'done' }, // LDA $4C / CMP #$13 / BCS done (truck or passage stage)
    0x8a, 0x48, //                        TXA / PHA
    0xa5, 0x4d, 0x29, 0x07, 0xa8, 0xa9, 0x01, // LDA $4D / AND #7 / TAY / LDA #1
    { label: 'shift' }, 0x88, { rel: 0x30, to: 'shifted' }, 0x0a, { rel: 0xd0, to: 'shift' },
    { label: 'shifted' }, 0x48, //         PHA (mask)
    0xa5, 0x4d, 0x4a, 0x4a, 0x4a, 0xaa, // LDA $4D / LSR x3 / TAX
    0x68, 0x1d, VISITED & 0xff, VISITED >> 8, 0x9d, VISITED & 0xff, VISITED >> 8, // PLA / ORA v,X / STA v,X
    0x68, 0xaa, //                        PLA / TAX
    { label: 'done' },
    0xe6, 0xcc, 0xa9, 0x00, 0x60, //      INC $CC / LDA #0 / RTS (the replaced code)
  ]);
  if (visit.length > 0x2c) throw new Error('map markers: visit routine too big');
  rom.set(visit, off0D(VISIT_ROUTINE));
  rom.set([0x20, VISIT_ROUTINE & 0xff, VISIT_ROUTINE >> 8, 0xea], off0D(ENTER_HOOK)); // JSR visit / NOP
}
