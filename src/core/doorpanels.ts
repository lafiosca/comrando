import { assemble } from './asm.ts';

// Sealed doors drawn in the background: a locked door's opening shows a closed panel with the Imperial emblem
// (docs/rom-notes.md#door-panels). Every locked doorway is the same 4×4-tile art (only the palette differs
// by area), so the panel is four 16×16 blocks of CHR shared by all of them.

const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
const rd = (rom: Uint8Array, bank: number, cpu: number) => rom[off(bank, cpu)];
const word = (rom: Uint8Array, bank: number, cpu: number) => rd(rom, bank, cpu) | (rd(rom, bank, cpu + 1) << 8);

const ROOMS = 0x70;
/** The emblem's sprite tiles (CHR record $58: 5 tiles, $C0-$C4 in the lock's art). */
const EMBLEM_CHR = 0x21d30;
/** BG tiles the tile-animation objects ($84) overwrite: $04-$0B and $24-$2B (groups of 4). */
const ANIMATED_GROUPS = [1, 2, 9, 10];
/** BG tiles $20-$23: $20 is the blank the screen is filled with while a level draws in, column by column (playtest: a panel there striped Area 1's level as it loaded). */
const BLANK_GROUP = 0x20 >> 2;
/** 02's zero fill after the metatile tables at $8C00 and $9C00 (their rooms' chunks stop at index $7F): the panel's
 * four 64-byte blocks, read by 0F:$E65C into the PPU queue. */
export const PANEL_BANK = 0x02;
export const PANEL_DATA = [0x8f80, 0x8fc0, 0x9f80, 0x9fc0];

/** A room's map (decoded from 0F's scroller: docs/rom-notes.md#door-panels). */
interface RoomMap {
  chunks: number; // bank 0: chunk pointers (bit 14: bank 1)
  metaBank: number; meta: number; // metatiles: 7 bytes (block base tiles TL, BL, TR, BR; attribute; collision)
  grid: number; w: number; h: number; // bank 2: chunk ids, row-major, w × h chunks of 8 × 8 metatiles (64 bytes)
  chr: number; // bank 1: the BG CHR list (64 block ids, then 64 nibbles: bank 4 + (n & 3), bit 2 mirrored)
}

export function roomMap(rom: Uint8Array, room: number): RoomMap | undefined {
  const g = 0x8002 + 4 * room, w = rd(rom, 2, g + 2), h = rd(rom, 2, g + 3);
  if (!w || !h || w > 40 || h > 40) return undefined;
  const mt = word(rom, 2, word(rom, 2, 0x8000) + 2 * room);
  return {
    chunks: word(rom, 0, 0x8000 + 2 * room), metaBank: 2 + ((mt >> 14) & 1), meta: mt & 0xbfff,
    grid: word(rom, 2, g), w, h, chr: word(rom, 1, 0xa002 + 2 * room),
  };
}

/** The chunk content (bank, address) of chunk id `c`. */
export function chunkAt(rom: Uint8Array, m: RoomMap, c: number) {
  const p = word(rom, 0, m.chunks + 2 * c);
  return { bank: (p >> 14) & 1, at: p & 0xbfff };
}

/** Every metatile index the room's chunks place: all 8 × 8 (64 bytes apart in the ROM; the eighth row is drawn and
 * collides too: playtest, O3's ceiling at row 8 took a panel's copy, lost its grip and showed emblems). */
export function metatilesOf(rom: Uint8Array, m: RoomMap) {
  const out = new Set<number>();
  for (let i = 0; i < m.w * m.h; i++) {
    const { bank, at } = chunkAt(rom, m, rd(rom, 2, m.grid + i));
    for (let k = 0; k < 0x40; k++) out.add(rd(rom, bank, at + k));
  }
  return out;
}

/** The map cell at (x, y) (map pixels: chunks 256 × 224): the chunk byte holding its metatile, and the block (0-3). */
export function cellAt(rom: Uint8Array, m: RoomMap, x: number, y: number) {
  const c = rd(rom, 2, m.grid + Math.floor(y / 224) * m.w + (x >> 8));
  const { bank, at } = chunkAt(rom, m, c);
  const byte = off(bank, at) + ((y % 224) >> 5) * 8 + ((x & 0xff) >> 5);
  return { byte, k: ((x & 31) >> 4) * 2 + ((y & 31) >> 4) };
}

export const metaEntry = (m: RoomMap, index: number) => off(m.metaBank, m.meta + 7 * index);

const reverse = (b: number) => { let r = 0; for (let i = 0; i < 8; i++) r |= ((b >> i) & 1) << (7 - i); return r; };

/** BG tile `t` as the room's CHR list loads it (0F:$D1D5). */
export function bgTile(rom: Uint8Array, list: number, t: number): number[] {
  const k = t >> 2, j = t & 3;
  const id = rd(rom, 1, list + k), n = (rd(rom, 1, list + 0x40 + (k >> 1)) >> (k & 1 ? 0 : 4)) & 0xf;
  const src = 0x10 + (4 + (n & 3)) * 0x4000 + id * 64;
  const at = src + (n & 4 ? [0x20, 0x30, 0x00, 0x10][j] : 16 * j);
  const bytes = [...rom.subarray(at, at + 16)];
  return n & 4 ? bytes.map(reverse) : bytes;
}

const pixels = (tile: number[]) => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((tile[r] >> (7 - c)) & 1) | (((tile[8 + r] >> (7 - c)) & 1) << 1)));
const encode = (px: number[][]) => [...px.map((r) => r.reduce((a, p) => (a << 1) | (p & 1), 0)), ...px.map((r) => r.reduce((a, p) => (a << 1) | (p >> 1), 0))];

/** The door object of type `door` in `room` (03:$AD6B object lists: type, x, y words; $FF ends). */
export function doorObject(rom: Uint8Array, room: number, door: number) {
  for (let at = word(rom, 3, 0xad6b + 2 * room); rd(rom, 3, at) !== 0xff; at += 5) {
    if (rd(rom, 3, at) === door) return { x: word(rom, 3, at + 1), y: word(rom, 3, at + 3) };
  }
  throw new Error(`door panels: no door $${door.toString(16)} in room $${room.toString(16)}`);
}

/**
 * The closed doorway, 16 tiles (4 rows of 4) of 2-bit pixels: the opening (colour 0 joined to the bottom centre)
 * takes the panel: lines black (0), the fill colour 2, the emblem's highlights 1; the emblem (its middle tiles,
 * mirrored to the right) in an 8-pixel band centred in the doorway, 2 pixels up, the plain
 * pattern (the emblem's outer tiles) in step with it above and below.
 */
function closedDoorway(rom: Uint8Array, open: number[][][][]): number[][][][] {
  const px = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => open[y >> 3][x >> 3][y & 7][x & 7]));
  const mask = px.map((r) => r.map(() => false));
  const stack = [[31, 16], [31, 15]];
  while (stack.length) {
    const [y, x] = stack.pop()!;
    if (y < 0 || y > 31 || x < 0 || x > 31 || mask[y][x] || px[y][x] !== 0) continue;
    mask[y][x] = true;
    stack.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
  // the doorway proper: the rows at its usual width (not the lintel's gaps nor the line under it)
  const widths = mask.map((r) => r.filter(Boolean).length), counts = new Map<number, number>();
  for (const n of widths) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const width = [...counts].sort((a, b) => b[1] - a[1])[0][0];
  const rows = widths.flatMap((n, y) => (n === width ? [y] : []));
  const top = rows[0], bottom = rows[rows.length - 1];
  const band = top + Math.round((bottom - top + 1 - 8) / 2) - 2;
  const emblem = (t: number, flip: boolean) => pixels([...rom.subarray(EMBLEM_CHR + 16 * t, EMBLEM_CHR + 16 * t + 16)]).map((r) => (flip ? r.reverse() : r));
  const plain = [emblem(0, false), emblem(1, false), emblem(1, true), emblem(0, true)];
  const middle = [emblem(2, false), emblem(3, false), emblem(4, false), emblem(2, true)];
  const COLOR = [0, 1, 2, 0]; // the sprite's colours → highlight 1, fill 2, lines 0
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    if (!mask[y][x]) continue;
    const art = y >= band && y < band + 8 ? middle : plain;
    px[y][x] = COLOR[art[x >> 3][(((y - band) % 8) + 8) % 8][x & 7]];
  }
  return Array.from({ length: 4 }, (_, ty) => Array.from({ length: 4 }, (_, tx) => px.slice(8 * ty, 8 * ty + 8).map((r) => r.slice(8 * tx, 8 * tx + 8))));
}

/** The BG groups (tile / 4) of the doorway of door `door` in `room`, as the map draws it: TL, BL, TR, BR blocks. */
export function doorwayGroups(rom: Uint8Array, room: number, door: number) {
  const m = roomMap(rom, room)!, { x, y } = doorObject(rom, room, door);
  const bx = x - 0x10, by = y - 0x10 - 0x20 * (y >> 8);
  return [[0, 0], [0, 1], [1, 0], [1, 1]].map(([cx, cy]) => {
    const cell = cellAt(rom, m, bx + 16 * cx, by + 16 * cy);
    return rom[metaEntry(m, rom[cell.byte]) + cell.k] >> 2;
  });
}

/** A locked door's panel: the four BG groups (tile / 4) its doorway now uses, TL, BL, TR, BR blocks. */
export interface DoorPanel { room: number; door: number; groups: number[] }

/**
 * Give each door of `doors` (room, door object type) a doorway of its own that can be closed by CHR alone:
 * - four free BG tile groups (4 tiles, a 16×16 block each; placed by no map of the rooms sharing its CHR list, and
 *   not the animated ones), which the CHR list loads with the open doorway's blocks (the same block ids and nibbles);
 * - the doorway's metatiles copied to indices no chunk of the table's rooms places, pointing at those groups, and
 *   the chunk (each doorway's is used once, by its room) pointing at the copies.
 * The closed doorway's four blocks go to PANEL_DATA (bank 02). Returns the panels and their blocks' addresses.
 */
export function doorPanels(rom: Uint8Array, doors: { room: number; door: number }[]) {
  const maps = Array.from({ length: ROOMS }, (_, r) => roomMap(rom, r));
  const sharing = (key: (m: RoomMap) => string, m: RoomMap) => maps.filter((o): o is RoomMap => !!o && key(o) === key(m));
  const tableKey = (m: RoomMap) => `${m.metaBank}:${m.meta}`, listKey = (m: RoomMap) => `${m.chr}`;
  const freeMeta = new Map<string, number[]>(), freeGroups = new Map<string, number[]>();
  const blocks: number[][] = [];
  const panels: DoorPanel[] = [];
  for (const { room, door } of doors) {
    if (panels.some((p) => p.room === room && p.door === door)) continue;
    const m = maps[room];
    if (!m) throw new Error(`door panels: room $${room.toString(16)} has no map`);
    if (!freeMeta.has(tableKey(m))) {
      const used = new Set(sharing(tableKey, m).flatMap((o) => [...metatilesOf(rom, o)]));
      freeMeta.set(tableKey(m), Array.from({ length: 0x80 }, (_, i) => i).filter((i) => !used.has(i)));
    }
    if (!freeGroups.has(listKey(m))) {
      const used = new Set<number>([0, BLANK_GROUP, ...ANIMATED_GROUPS]);
      for (const o of sharing(listKey, m)) for (const i of metatilesOf(rom, o)) for (let k = 0; k < 4; k++) used.add(rom[metaEntry(o, i) + k] >> 2);
      // (from the top down; the rooms with panels are level rooms, where no one talks, so the talk box's tiles there
      // are free)
      freeGroups.set(listKey(m), Array.from({ length: 64 }, (_, g) => 63 - g).filter((g) => !used.has(g)));
    }
    const { x, y } = doorObject(rom, room, door);
    const bx = x - 0x10, by = y - 0x10 - 0x20 * (y >> 8); // the doorway's top left, in map pixels
    if (bx & 15 || by & 15) throw new Error(`door panels: room $${room.toString(16)}'s doorway is off the block grid`);
    // its four blocks: where the map holds each, and its base tile
    const cells = [[0, 0], [0, 1], [1, 0], [1, 1]].map(([cx, cy]) => {
      const cell = cellAt(rom, m, bx + 16 * cx, by + 16 * cy);
      return { ...cell, base: rom[metaEntry(m, rom[cell.byte]) + cell.k] };
    });
    if (cells.some((c) => c.base & 3)) throw new Error('door panels: a doorway block off its CHR group');
    const groups = cells.map(() => freeGroups.get(listKey(m))!.shift());
    if (groups.some((g) => g === undefined)) throw new Error(`door panels: no free BG tiles in room $${room.toString(16)}`);
    // the CHR list: each new group loads its doorway block's CHR
    const list = off(1, m.chr);
    cells.forEach(({ base }, i) => {
      const from = base >> 2, to = groups[i]!;
      rom[list + to] = rom[list + from];
      const nib = (rom[list + 0x40 + (from >> 1)] >> (from & 1 ? 0 : 4)) & 0xf, at = list + 0x40 + (to >> 1);
      rom[at] = to & 1 ? (rom[at] & 0xf0) | nib : (rom[at] & 0x0f) | (nib << 4);
    });
    // the map: each metatile under the doorway becomes a copy pointing at the new groups
    for (const byte of new Set(cells.map((c) => c.byte))) {
      const index = freeMeta.get(tableKey(m))!.shift();
      if (index === undefined) throw new Error(`door panels: no free metatile in room $${room.toString(16)}'s table`);
      const entry = [...rom.subarray(metaEntry(m, rom[byte]), metaEntry(m, rom[byte]) + 7)];
      cells.forEach((c, i) => { if (c.byte === byte) entry[c.k] = groups[i]! << 2; });
      rom.set(entry, metaEntry(m, index));
      rom[byte] = index;
    }
    // the closed doorway's blocks (TL, BL, TR, BR tiles each), shared by every door with the same art
    const open = [0, 1, 2, 3].map((ty) => [0, 1, 2, 3].map((tx) => {
      const c = cells[(tx >> 1) * 2 + (ty >> 1)];
      return pixels(bgTile(rom, m.chr, c.base + (tx & 1) * 2 + (ty & 1)));
    }));
    const closed = closedDoorway(rom, open);
    [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([cx, cy], i) => {
      const data = [closed[2 * cy][2 * cx], closed[2 * cy + 1][2 * cx], closed[2 * cy][2 * cx + 1], closed[2 * cy + 1][2 * cx + 1]].flatMap(encode);
      if (!blocks[i]) blocks[i] = data;
      else if (blocks[i].some((b, j) => b !== data[j])) throw new Error(`door panels: room $${room.toString(16)}'s doorway differs`);
    });
    panels.push({ room, door, groups: groups as number[] });
  }
  blocks.forEach((data, i) => {
    const at = off(PANEL_BANK, PANEL_DATA[i]);
    if (rom.subarray(at, at + 64).some((b) => b !== 0)) throw new Error(`door panels: 02:$${PANEL_DATA[i].toString(16)} not free`);
    rom.set(data, at);
  });
  return { panels, data: PANEL_DATA };
}

/**
 * Area 12's miniboss room ($21): its exit door opens like the power rooms' when the officer falls.
 * The exit object (type $2E) waits for the room's event count `$40`, then 0F:$CCA7 redraws the shutter from bank 05
 * $9F40 behind a shrinking mask, into tiles $D8-$DB in the power rooms (their door's tiles). The boss rooms (one shared
 * tile set and metatile table, $16-$25, $54, $55) draw the same art as tiles $40-$43, which the redraw doesn't touch.
 * $D8-$DB can't hold a boss room's door: the talk box types into $B8-$F7 (playtest: every boss's door
 * turned to letters while he talked), and its frame is $F8-$FF (playtest: a shutter there broke the box's border). So
 * the shared tile set loads the shutter into $48-$4B (group $12: placed by no map of those rooms, never on screen in
 * them, the bosses' talks included, and outside Joe's rescue box, $80-$DF), the door's metatile blocks point there (every boss room's: they share
 * chunks too, so each one's exit opens when its boss falls), and the redraw picks its tiles by room: rooms $20-$2F
 * (the boss rooms with an exit, $21-$25) $1480, else $1D80 as before (the power rooms $58/$59; the doors of types
 * $29/$5B/$5C in rooms $00, $47, $49, which run the same redraw and close again after). The bytes come from the routine
 * itself (0F:$CCCB-$CD33, reassembled): its close path's `STA $043E` (always 0 there: the masks start at $FFFF and
 * shift in zeros), its `INC $043C / RTS` shared with the wait state's, the open path's `CMP #$FF … LDA #0` (`EOR #$FF`
 * leaves 0), and the count $40 as `LSR` of $80. Its caller (0F:$CBE6, then $CBEF) reads no flag or register it left.
 */
export function shutterDoor(rom: Uint8Array) {
  const ROOM = 0x21, SHUTTER = 0x48, ART = 0x9f40; // bank 05
  const m = roomMap(rom, ROOM)!, { x, y } = doorObject(rom, ROOM, 0x2e);
  const bx = x - 0x10, by = y - 0x10 - 0x20 * (y >> 8);
  const sharing = Array.from({ length: ROOMS }, (_, r) => roomMap(rom, r)).filter((o): o is RoomMap => !!o && o.chr === m.chr);
  const used = new Set(sharing.flatMap((o) => [...metatilesOf(rom, o)].flatMap((i) => [0, 1, 2, 3].map((k) => rom[metaEntry(o, i) + k] >> 2))));
  if (used.has(SHUTTER >> 2)) throw new Error('shutter door: tiles $48-$4B in use');
  const art = off(5, ART);
  if (![...rom.subarray(art, art + 64)].some((b) => b)) throw new Error('shutter door: no shutter art');
  // the tile set: group $3E loads bank 05 $9F40 (block id $7D, nibble 1: bank 5, not mirrored)
  const list = off(1, m.chr), g = SHUTTER >> 2;
  rom[list + g] = (ART - 0x8000) >> 6;
  rom[list + 0x40 + (g >> 1)] = g & 1 ? (rom[list + 0x40 + (g >> 1)] & 0xf0) | 1 : (rom[list + 0x40 + (g >> 1)] & 0x0f) | 0x10;
  // the door's blocks drawn from $40-$43 now use $48-$4B (its metatiles and chunks, shared by all the boss rooms)
  let moved = 0;
  for (const [cx, cy] of [[0, 0], [0, 1], [1, 0], [1, 1]]) {
    const cell = cellAt(rom, m, bx + 16 * cx, by + 16 * cy), at = metaEntry(m, rom[cell.byte]) + cell.k;
    if (rom[at] === 0x40) { rom[at] = SHUTTER; moved++; }
  }
  if (!moved) throw new Error('shutter door: no $40 block in the doorway');
  // the redraw: the routine from its close path on, its tiles by room
  const F = (cpu: number) => 0x10 + 15 * 0x4000 + cpu - 0xc000;
  const FROM = 0xcccb, TO = 0xcd34, TABLE = 0xccb7;
  const vanilla = '0e3e042e3d042008cdad3d04d00b8d3e04a92f8d3f04ee3c0460ce3f04d003ee3c0460386e3d046e3e04200' +
    '8cdad3e04c9ffd008a9008d3b048d3c0460a90520e2d6a21fbd409f2d3d049dfb03bd609f2d3e049d1b04ca10eba9808df903a91d8df803a9408dfa0360';
  if ([...rom.subarray(F(FROM), F(TO))].map((b) => b.toString(16).padStart(2, '0')).join('') !== vanilla) throw new Error('shutter door: unexpected redraw code');
  const labels: Record<string, number> = {};
  const code = assemble(FROM, [
    0x0e, 0x3e, 0x04, 0x2e, 0x3d, 0x04, { abs: 0x20, to: 'draw' }, 0xad, 0x3d, 0x04, { rel: 0xd0, to: 'r1' }, // close: ASL/ROL the masks, draw; done at $043D = 0
    0xa9, 0x2f, 0x8d, 0x3f, 0x04, { rel: 0xd0, to: 'next' }, //  (no STA $043E: it's 0 then; BNE: A = $2F, the wait's INC $043C / RTS)
    { label: 'wait' }, 0xce, 0x3f, 0x04, { rel: 0xd0, to: 'r1' }, { label: 'next' }, 0xee, 0x3c, 0x04, { label: 'r1' }, 0x60,
    { label: 'open' }, 0x38, 0x6e, 0x3d, 0x04, 0x6e, 0x3e, 0x04, { abs: 0x20, to: 'draw' },
    0xad, 0x3e, 0x04, 0x49, 0xff, { rel: 0xd0, to: 'r3' }, 0x8d, 0x3b, 0x04, 0x8d, 0x3c, 0x04, { label: 'r3' }, 0x60, // EOR #$FF: A = 0 when open
    { label: 'draw' }, 0xa9, 0x05, 0x20, 0xe2, 0xd6, 0xa2, 0x1f,
    { label: 'loop' }, 0xbd, 0x40, 0x9f, 0x2d, 0x3d, 0x04, 0x9d, 0xfb, 0x03, 0xbd, 0x60, 0x9f, 0x2d, 0x3e, 0x04, 0x9d, 0x1b, 0x04, 0xca, { rel: 0x10, to: 'loop' },
    0xa5, 0x4c, 0x29, 0x20, { rel: 0xf0, to: 'hi' }, 0xa9, 0x09, //  LDA $4C / AND #$20 / BEQ / LDA #$09
    { label: 'hi' }, 0x49, 0x1d, //                                   EOR #$1D: rooms $2x $14, else $1D
    0x8d, 0xf8, 0x03, 0xa9, 0x80, 0x8d, 0xf9, 0x03, 0x4a, 0x8d, 0xfa, 0x03, 0x60, //      STA $03F8 / LDA #$80 / STA $03F9 / LSR A / STA $03FA
  ], labels);
  if (code.length > TO - FROM) throw new Error(`shutter door: redraw ${code.length} bytes, room for ${TO - FROM}`);
  if (0x1000 + (SHUTTER << 4) !== 0x1480) throw new Error('shutter door: the redraw writes $1480 in rooms $20-$2F');
  rom.set(code, F(FROM));
  rom.fill(0xea, F(FROM + code.length), F(TO));
  // the state table (0F:$CCB7: $CCBF, $CCCB, then the wait and open states, moved)
  if (rom[F(TABLE + 4)] !== 0xe5 || rom[F(TABLE + 6)] !== 0xee) throw new Error('shutter door: unexpected state table');
  for (const [k, l] of [[4, 'wait'], [6, 'open']] as const) { rom[F(TABLE + k)] = labels[l] & 0xff; rom[F(TABLE + k + 1)] = labels[l] >> 8; }
}

