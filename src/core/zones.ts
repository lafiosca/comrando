// Map layout shuffle: the map looks exactly as in vanilla (every number in its usual spot), but which layout lies
// behind each number changes — enemy areas 1–11 among themselves, neutral zones 13–19 among themselves. Area 0 (the
// start) and Area 12 (the finale) stay put. See docs/rom-notes.md#map-screen.
//
// Every game system keys an area's contents off its identity ($4D) — level, people, buildings, items, rewards, comm
// checks, cleared flags — and arrival on the map is geometric. So moving identity X to spot S means giving X spot S's
// coordinates and road list; X's whole layout comes along. The number shown at a spot is drawn into the map
// nametable and the route texts, which we leave alone, so spot S keeps showing S. The few things that print or test
// a number are re-pointed to the spot: area-clear digits, enemy-truck start nodes, the hidden-passage road checks.

import type { Rng } from './rng.ts';

const BANK0D = 0x10 + 0x0d * 0x4000;
const off = (cpu: number) => BANK0D + cpu - 0x8000;
const BANK0A = 0x10 + 0x0a * 0x4000;
const off0A = (cpu: number) => BANK0A + cpu - 0x8000;
const ROUTE_PTRS = 0xa760; // 20 words: identity -> road list
const COORDS = 0xa814; // 20 x (x, y): identity -> helicopter arrival point
const TRUCKS = 0xa99f; // 0D:$A99F: script<<4 | start node (by identity), $FF-terminated
/** Hidden-passage road checks: compare operand -> spot whose identity it must name (0D:$A5FF). */
const PASSAGE_GATES: [number, number][] = [
  [0xa602, 14],
  [0xa606, 18],
  [0xa60a, 15],
];
/** 0A:$B0D9 converts $4D to BCD for the "xxAREA CLEAR" screen; replaced by a lookup in free space at 0A:$BB4E, by
 * identity 0-12 (only enemy areas have a clear screen). */
const CLEAR_DIGITS = 0xb0d9;
const LABEL_TABLE = 0xbb4e;

export const AREA_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
export const ZONE_NUMBERS = [13, 14, 15, 16, 17, 18, 19];

/** layoutAt[spot] = identity (layout) placed at that map spot; spots not listed hold their own identity. */
export type MapLayout = Map<number, number>;

export const vanillaLayout = (): MapLayout => new Map([...AREA_NUMBERS, ...ZONE_NUMBERS].map((n) => [n, n]));

export function shuffleGroup(layout: MapLayout, group: number[], rng: Rng) {
  const ids = rng.shuffle([...group]);
  group.forEach((spot, i) => layout.set(spot, ids[i]));
}

/** Map numbers on the start side of the 6<->8 road (the second half is 7-12 and NZ17-19). */
export const FIRST_HALF_AREAS = [1, 2, 3, 4, 5, 6];
/** Neutral-zone map numbers past the 6<->8 road. */
export const EAST_ZONES = [17, 18, 19];

/**
 * Keep layout `id` at one of `spots`: if it landed elsewhere, swap it with the layout at a random one of them (so it
 * ends up uniform over `spots`). Used to keep Area 1's layout, which the opening briefing sends you to ("THERE ARE MANY
 * AGENTS IN AREA x"), reachable from the start.
 */
export function keepAt(layout: MapLayout, id: number, spots: number[], rng: Rng) {
  const here = [...layout].find(([, v]) => v === id)?.[0] ?? id;
  if (spots.includes(here)) return;
  const there = rng.pick(spots);
  layout.set(here, layout.get(there) ?? there);
  layout.set(there, id);
}

/** spotOf[identity] = the map spot (and displayed number) where that layout now is. */
export function spotOf(layout: MapLayout): (id: number) => number {
  const m = new Map([...layout].map(([spot, id]) => [id, spot]));
  return (id) => m.get(id) ?? id;
}

export function applyMapLayout(rom: Uint8Array, layout: MapLayout) {
  const orig = rom.slice();
  const at = (spot: number) => layout.get(spot) ?? spot;
  const word = (a: number) => orig[off(a)] | (orig[off(a) + 1] << 8);
  for (const [spot, id] of layout) {
    // identity `id` takes over spot `spot`'s road list and arrival point
    const p = word(ROUTE_PTRS + 2 * spot);
    rom[off(ROUTE_PTRS + 2 * id)] = p & 0xff;
    rom[off(ROUTE_PTRS + 2 * id) + 1] = p >> 8;
    rom[off(COORDS + 2 * id)] = orig[off(COORDS + 2 * spot)];
    rom[off(COORDS + 2 * id) + 1] = orig[off(COORDS + 2 * spot) + 1];
  }
  // 17's check exists only once fixPassageGate has rewritten the routine
  const gates = orig[off(0xa60d)] === 0xc9 ? [...PASSAGE_GATES, [0xa60e, 17] as [number, number]] : PASSAGE_GATES;
  for (const [operand, spot] of gates) {
    if (orig[off(operand)] !== spot)
      throw new Error(`map layout: unexpected passage gate operand at $${operand.toString(16)}`);
    rom[off(operand)] = at(spot);
  }
  // Truck convoys start at a node (low nibble) and drive a fixed direction script: keep them on their spot.
  for (let a = TRUCKS; orig[off(a)] !== 0xff; a++) {
    const b = orig[off(a)];
    const id = at(b & 0x0f);
    if (id > 0x0f) throw new Error(`map layout: truck start spot ${b & 0x0f} holds identity ${id}`);
    rom[off(a)] = (b & 0xf0) | id;
  }
  if ([...layout].some(([spot, id]) => spot !== id)) {
    // "xxAREA CLEAR": LDA $4D / TAY / CMP #10 / BCC +4 / SBC #10 / ORA #$10  ->  LDY $4D / LDA table,Y / NOP x6
    const site = off0A(CLEAR_DIGITS),
      table = off0A(LABEL_TABLE);
    const expectBytes = (o: number, bytes: number[], what: string) => {
      if (bytes.some((b, i) => orig[o + i] !== b)) throw new Error(`map layout: unexpected bytes at ${what}`);
    };
    expectBytes(site, [0xa5, 0x4d, 0xa8, 0xc9, 0x0a, 0x90, 0x04, 0xe9, 0x0a, 0x09, 0x10], 'area-clear digits');
    expectBytes(table, new Array(13).fill(0xff), 'free space 0A:$BB4E');
    rom.set([0xa4, 0x4d, 0xb9, LABEL_TABLE & 0xff, LABEL_TABLE >> 8, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea], site);
    const where = spotOf(layout);
    for (let id = 0; id <= 12; id++) rom[table + id] = Math.floor(where(id) / 10) * 16 + (where(id) % 10);
  }
}
