// Map gate display (option): on the overworld map a gated road (6<->8, 8<->10) is drawn red while it's shut, and the
// IFF Code and Flak Map show in the empty corner right of the message box once you have them (card icon and name).
// See docs/rom-notes.md#map-screen.
//
// - Red roads: the map's land palettes have no spare color, so the road is overlaid with sprites (sprite palette 0,
//   color 2 = $15) covering exactly its white pixels: 9 sprites for 6<->8, 4 for 8<->10, at most 2 per scanline. The
//   map frame (0D:$A400) ends `JMP $D6C1` (hide the OAM entries from $3A on); it now jumps here first, which appends
//   the sprites of each road whose flags aren't all set. Map numbers never move, so the positions are fixed. The
//   SELECT screen in a level shows the same map (0D:$AADE, its frame's `JMP $D6C1`): it gets the roads too.
// - Corner: the names are background tiles, written while the map is built (rendering off): the build's hidden-road
//   check (0B:$B276 `LDA $04F7`, or the map markers' hook there) first calls this, on the map only ($CC = 1; the SELECT
//   screen in a level draws the same map and has its own L=/P= there). The letters (copied from the font at 0B:$B800)
//   go to BG $80-$8A, the road and card sprite tiles to sprite $9D-$A5: all free on the map screen. The cards are
//   sprites, drawn with the roads each frame: as background they'd each need an attribute quadrant of their own (IFF
//   green, Flak Map red), which kept them 32 px apart. Sprite palette 1 color 2 = green $2A, palette 0 color 2 = $15.
// - Banks: the 0B part (letters, which need the font; the sprite tiles) hops to bank 0D for the rest: 0B:$BF93 `LDA #$0D / JSR $DCAA`
//   continues in 0D at $BF98 `JSR build / LDA #$0B / JSR $DCAA`, back in 0B at $BFA0 `RTS`. Bank 0D holds the build
//   and frame code and the data in the unused zero-filled $9D00-$9DFF and $9F00-$9FDF (no code refers to them: static
//   scan, and a 250k-frame read trace).

import { assemble, type Asm } from './asm.ts';

const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const off0D = (cpu: number) => 0x10 + 0x0d * 0x4000 + cpu - 0x8000;

const DRAW_HOOK = 0xb276; // 0B: LDA $04F7 (after the map tiles are drawn), or the map markers' JSR there
/** 0B space for the letters part (the map markers stay below it). */
export const GATE_0B = 0xb5c0, GATE_0B_END = 0xb700;
const HOP_0B = 0xbf93, HOP_0D = HOP_0B + 5, BACK_0B = 0xbfa0; // the bank hop (see above)
const FRAME_0D = 0x9d00, FRAME_0D_END = 0x9db0; // frame code, sprites ($9DB0 on: patches.ts topDownDrops)
const BUILD_0D = 0x9f00, BUILD_0D_END = 0x9f60; // build code, corner lists ($9F60 on: patches.ts topDownDrops, machineGunAuto)
const FRAME_END = 0xa409; // 0D: JMP $D6C1 (end of the map frame)
const SELECT_END = 0xaade; // 0D: JMP $D6C1 (end of a frame of the SELECT screen's handler, also other states: $CC checked)
const FONT = 0xb800; // 0B: 16 bytes per glyph, plane 0 rows 0-6

const LETTER_TILE = 0x80, SPRITE_TILE = 0x9d, CARD_TILE = SPRITE_TILE + 5; // (sprite tiles: 5 road patterns, then the card)
/** Font glyph per letter (text codes are interleaved: docs/rom-notes.md#text-and-messages). */
const GLYPH: Record<string, number> = { A: 22, C: 26, D: 28, E: 30, F: 1, I: 7, K: 11, L: 13, M: 15, O: 19, P: 21 };

/** The Permit card from the equipment screen (14x15): `#` = marks drawn in the item's color, `.` = white. */
const CARD = [
  '..............',
  '..............',
  '.#######.####.',
  '.#######.####.',
  '..####...####.',
  '...##....####.',
  '.........####.',
  '..............',
  '..............',
  '.....####.###.',
  '..............',
  '.....#######..',
  '..............',
  '.....#####.##.',
  '..............',
];

/** Road overlay sprites (screen x, y, pattern): every white pixel of the road's tiles, from the map nametable. */
export const PATTERNS = [
  [0x01, 0x03, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0], // diagonal
  [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80], // diagonal's corner pixels
  [0x03, 0x07, 0x0e, 0x1c, 0x38, 0x70, 0xe0, 0x40], // diagonal, lower
  [0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x03], // vertical
  [0x03, 0x03, 0x03, 0x03, 0x03, 0x03, 0x00, 0x00], // vertical, above a grid line
];
export const ROAD_68 = [[151, 96, 0], [152, 97, 1], [144, 104, 2], [135, 112, 0], [136, 113, 1], [128, 120, 2], [119, 128, 0], [120, 129, 1], [112, 136, 2]];
export const ROAD_810 = [[161, 49, 3], [161, 57, 4], [161, 65, 3], [161, 73, 4]];

/** The corner (right of the message box, rows 22-27): a name per row, its card 4 px above it at x 162-175. */
const CORNER = { iff: { row: 23, name: 'IFF CODE', palette: 1 }, flak: { row: 26, name: 'FLAK MAP', palette: 0 } };
const CARD_X = 160, NAME_COL = 23;

export interface GateDisplay {
  /** RAM flags that all open the road (none: the road is open), by road. */
  road68?: number[];
  road810?: number[];
  /** The key items' flags (shown in the corner once set), when the seed has them. */
  iff?: number;
  flak?: number;
}

function expect(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (bytes.some((b, i) => rom[at + i] !== b)) throw new Error(`gate display: unexpected bytes at ${what}`);
}

/** Unused EPROM fill: every byte $00 or $FF, constant within each aligned 32-byte run. */
function expectFree(rom: Uint8Array, at: number, len: number, what: string) {
  for (let i = 0; i < len; i++) {
    const v = rom[at + i], run = rom[at + i - ((at + i - 0x10) & 0x1f)];
    if ((v !== 0 && v !== 0xff) || v !== run) throw new Error(`gate display: ${what} not free`);
  }
}

/** 2bpp tiles (TL, TR, BL, BR) of the card, art 2 px from the left: `.` = color 1, `#` = color 2. */
function cardTiles(): number[] {
  const px = (x: number, y: number) => { const c = CARD[y]?.[x - 2]; return c === '.' ? 1 : c === '#' ? 2 : 0; };
  const out: number[] = [];
  for (const [tx, ty] of [[0, 0], [8, 0], [0, 8], [8, 8]]) {
    for (const plane of [1, 2]) {
      for (let y = 0; y < 8; y++) {
        let b = 0;
        for (let x = 0; x < 8; x++) if (px(tx + x, ty + y) & plane) b |= 0x80 >> x;
        out.push(b);
      }
    }
  }
  return out;
}

export function applyGateDisplay(rom: Uint8Array, g: GateDisplay) {
  // --- letters: one tile per letter (the font's glyph as is) ---
  const keys = (['iff', 'flak'] as const).filter((k) => g[k] !== undefined);
  const letters = [...new Set(keys.flatMap((k) => [...CORNER[k].name.replace(/ /g, '')]))];
  const glyphs = letters.map((l) => FONT + 16 * GLYPH[l]);
  const tileOf = (ch: string) => (ch === ' ' ? 0x20 : LETTER_TILE + letters.indexOf(ch));

  // --- 0D: corner lists (PPU address, count, bytes; 0 ends), then the build code ---
  const lists: number[] = [], listAt: Partial<Record<'iff' | 'flak', number>> = {};
  for (const k of keys) {
    const { row, name } = CORNER[k];
    listAt[k] = lists.length;
    const at = 0x2000 + row * 32 + NAME_COL;
    lists.push(at >> 8, at & 0xff, name.length, ...[...name].map(tileOf), 0);
  }
  const ppu = (addr: number): Asm[] => [0xa9, addr >> 8, 0x8d, 0x06, 0x20, 0xa9, addr & 0xff, 0x8d, 0x06, 0x20];
  const roadSprites = (road: number[][]) => road.flatMap(([x, y, p]) => [y - 1, SPRITE_TILE + p, 0x00, x]);
  const cardSprites = (row: number, palette: number) =>
    [[0, 0], [8, 0], [0, 8], [8, 8]].flatMap(([dx, dy], i) => [row * 8 - 4 + dy - 1, CARD_TILE + i, palette, CARD_X + dx]);
  const sprites: number[] = [];

  // frame block: append each shut road's sprites and each held key's card at $3A, then hide the rest as before
  const roadCode: Asm[] = [];
  let from = 0;
  for (const [flags, road] of [[g.road68, ROAD_68], [g.road810, ROAD_810]] as const) {
    if (!flags) continue;
    if (!flags.length) throw new Error('gate display: a shut road needs flags');
    const id = `${from}`, len = road.length * 4;
    flags.forEach((f, i) => roadCode.push(0xad, f & 0xff, f >> 8, i < flags.length - 1 ? { rel: 0xf0, to: `shut${id}` } : { rel: 0xd0, to: `open${id}` }));
    roadCode.push({ label: `shut${id}` }, 0xa2, from, 0xa0, len, { abs: 0x20, to: 'copy' }, { label: `open${id}` });
    sprites.push(...roadSprites(road));
    from += len;
  }
  const cardCode: Asm[] = [];
  for (const k of keys) {
    cardCode.push(0xad, g[k]! & 0xff, g[k]! >> 8, { rel: 0xf0, to: `no${k}` }, 0xa2, from, 0xa0, 16, { abs: 0x20, to: 'copy' }, { label: `no${k}` });
    sprites.push(...cardSprites(CORNER[k].row, CORNER[k].palette));
    from += 16;
  }
  const TEMP = 0x1b; // zero-page temp the map's sprite drawing (0F:$D55F) is done with
  const fl: Record<string, number> = {};
  const frame = assemble(FRAME_0D, [
    // the SELECT screen in a level ($CC = 3, $CD = 3; its corner has L=/P=): the roads only, and only while it builds
    // or shows the map ($CE = 2, 3). $CE = 1 fades the level out and 4 brings it back with the level's tiles where the
    // road patterns go; the sprites would stay on screen as junk (OAM keeps them between frames). Anything else falls
    // into the map's check, whose $CD = 1 it fails ($AADE is only reached in a level: traced)
    { label: 'select' }, 0xa5, 0xce, 0x4a, 0xc9, 0x01, { rel: 0xf0, to: 'roads' }, // LDA $CE / LSR / CMP #1 / BEQ roads
    { label: 'map' }, 0xa5, 0xcd, 0xc9, 0x01, { rel: 0xd0, to: 'out' }, // LDA $CD / CMP #1 / BNE out (the map running)
    ...cardCode,
    { label: 'roads' }, ...roadCode,
    { label: 'out' }, 0x4c, 0xc1, 0xd6, //              JMP $D6C1
    { label: 'copy' }, //                               X = first byte, Y = bytes
    0x84, TEMP, 0xa5, 0x3a, 0x18, 0x65, TEMP, { rel: 0xb0, to: 'full' }, // STY t / LDA $3A / CLC / ADC t / BCS full
    0xa4, 0x3a, 0x85, 0x3a, //                          LDY $3A / STA $3A (the new end)
    { label: 'c' }, { abs: 0xbd, to: 'sprites' }, 0x99, 0x00, 0x02, 0xe8, 0xc8, 0xc4, 0x3a, { rel: 0xd0, to: 'c' }, // LDA,X / STA $0200,Y / INX / INY / CPY $3A / BNE
    { label: 'full' }, 0x60,
    { label: 'sprites' }, sprites,
  ], fl);
  if (FRAME_0D + frame.length > FRAME_0D_END) throw new Error(`gate display: 0D frame block too big (${frame.length} bytes)`);

  // build block: road sprite tiles (plane 0 blank), card sprite tiles, then the name of each key item held
  const keyCode: Asm[] = keys.flatMap((k): Asm[] => [
    0xad, g[k]! & 0xff, g[k]! >> 8, { rel: 0xf0, to: `no${k}` }, 0xa2, listAt[k]!, { abs: 0x20, to: 'write' }, { label: `no${k}` },
  ]);
  const build = assemble(BUILD_0D, [
    ...keyCode,
    0x60,
    { label: 'write' }, //                              X = list offset: entries (hi, lo, n, bytes), 0 ends
    { abs: 0xbd, to: 'lists' }, { rel: 0xf0, to: 'done' }, 0x8d, 0x06, 0x20, 0xe8,
    { abs: 0xbd, to: 'lists' }, 0x8d, 0x06, 0x20, 0xe8, { abs: 0xbc, to: 'lists' }, 0xe8,
    { label: 'b' }, { abs: 0xbd, to: 'lists' }, 0x8d, 0x07, 0x20, 0xe8, 0x88, { rel: 0xd0, to: 'b' },
    { rel: 0xf0, to: 'write' },
    { label: 'done' }, 0x60,
    { label: 'lists' }, lists,
  ]);
  if (BUILD_0D + build.length > BUILD_0D_END) throw new Error(`gate display: 0D build block too big (${build.length} bytes)`);

  // --- 0B: letters, the hop to 0D's build, then what the hook replaced ---
  const prev = [rom[off0B(DRAW_HOOK)], rom[off0B(DRAW_HOOK) + 1], rom[off0B(DRAW_HOOK) + 2]];
  const tail = prev[0] === 0x20 ? [0x4c, prev[1], prev[2]] : [0xad, 0xf7, 0x04, 0x60]; // JMP (the markers) / LDA $04F7 / RTS
  if (prev[0] !== 0x20) expect(rom, off0B(DRAW_HOOK), [0xad, 0xf7, 0x04], 'map draw hook');
  const G = 0x17; // zero-page pointer ($17-$18) 0B:$B229 is done with (as the map markers)
  const part0B = assemble(GATE_0B, [
    0xad, 0x02, 0x20, //                                LDA $2002 (address latch)
    0xa5, 0xcc, 0xc9, 0x01, { rel: 0xf0, to: 'map' }, // LDA $CC / CMP #1 / BEQ map
    0xc9, 0x03, { rel: 0xd0, to: 'end' }, //             CMP #3 / BNE end
    // the SELECT screen in a level: the road tiles only (the level reloads its sprite tiles on the way back)
    { abs: 0x20, to: 'roadTiles' }, { rel: 0xf0, to: 'end' }, // JSR / BEQ end (Z set: X = the count)
    { label: 'map' },
    ...(letters.length ? [
      ...ppu(0x1000 + 16 * LETTER_TILE),
      0xa2, 0x00,
      { label: 'l' },
      { abs: 0xbd, to: 'lo' }, 0x85, G, { abs: 0xbd, to: 'hi' }, 0x85, G + 1,
      0xa0, 0x00, { label: 'g' }, 0xb1, G, 0x8d, 0x07, 0x20, 0xc8, 0xc0, 0x10, { rel: 0xd0, to: 'g' }, // the glyph's 16 bytes
      0xe8, 0xe0, letters.length, { rel: 0xd0, to: 'l' },
    ] as Asm[] : []),
    // sprite tiles: the road patterns, then the card (CARD_TILE)
    { abs: 0x20, to: 'roadTiles' },
    0xa2, 0x00, { label: 'card' }, { abs: 0xbd, to: 'cardTiles' }, 0x8d, 0x07, 0x20, 0xe8, 0xe0, 0x40, { rel: 0xd0, to: 'card' },
    0x20, HOP_0B & 0xff, HOP_0B >> 8, //                JSR hop (0D's build)
    { label: 'end' }, ...tail,
    // the road patterns (plane 0 blank) to SPRITE_TILE on; ends with Z set
    { label: 'roadTiles' }, ...ppu(16 * SPRITE_TILE),
    0xa2, 0x00,
    { label: 'tile' }, 0xa0, 0x08, 0xa9, 0x00, { label: 'z' }, 0x8d, 0x07, 0x20, 0x88, { rel: 0xd0, to: 'z' },
    0xa0, 0x08, { label: 'p' }, { abs: 0xbd, to: 'spriteTiles' }, 0x8d, 0x07, 0x20, 0xe8, 0x88, { rel: 0xd0, to: 'p' },
    0xe0, PATTERNS.length * 8, { rel: 0xd0, to: 'tile' }, 0x60,
    { label: 'lo' }, glyphs.map((a) => a & 0xff),
    { label: 'hi' }, glyphs.map((a) => a >> 8),
    { label: 'spriteTiles' }, PATTERNS.flat(),
    { label: 'cardTiles' }, cardTiles(),
  ]);
  if (GATE_0B + part0B.length > GATE_0B_END) throw new Error(`gate display: 0B part too big (${part0B.length} bytes)`);

  // --- write it all ---
  expectFree(rom, off0B(GATE_0B), GATE_0B_END - GATE_0B, '0B:$B5C0');
  expectFree(rom, off0B(HOP_0B), 5, '0B:$BF93');
  expectFree(rom, off0B(BACK_0B), 1, '0B:$BFA0');
  expectFree(rom, off0D(HOP_0D), 8, '0D:$BF98');
  expectFree(rom, off0D(FRAME_0D), FRAME_0D_END - FRAME_0D, '0D:$9D00');
  expectFree(rom, off0D(BUILD_0D), BUILD_0D_END - BUILD_0D, '0D:$9F00');
  expect(rom, off0D(FRAME_END), [0x4c, 0xc1, 0xd6], 'map frame end');
  expect(rom, off0D(SELECT_END), [0x4c, 0xc1, 0xd6], 'SELECT screen frame end');
  rom.set(part0B, off0B(GATE_0B));
  rom.set([0x20, GATE_0B & 0xff, GATE_0B >> 8], off0B(DRAW_HOOK)); // JSR; the BEQ after it stays
  rom.set([0xa9, 0x0d, 0x20, 0xaa, 0xdc], off0B(HOP_0B)); // LDA #$0D / JSR $DCAA
  rom.set([0x20, BUILD_0D & 0xff, BUILD_0D >> 8, 0xa9, 0x0b, 0x20, 0xaa, 0xdc], off0D(HOP_0D)); // JSR build / LDA #$0B / JSR $DCAA
  rom[off0B(BACK_0B)] = 0x60; // RTS
  rom.set(frame, off0D(FRAME_0D));
  rom.set(build, off0D(BUILD_0D));
  rom.set([0x4c, fl.map & 0xff, fl.map >> 8], off0D(FRAME_END));
  rom.set([0x4c, fl.select & 0xff, fl.select >> 8], off0D(SELECT_END));
}
