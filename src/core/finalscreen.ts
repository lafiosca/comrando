// The ending's final screen (docs/design.md#credits-and-final-screen): every seed but a fully vanilla one shows the run's
// details there in our own text over the whole black screen, then a pink heart and Joe's signature (no date).
//
// The vanilla screen: scene 5's step 5 (1:$BEC2) fades the letter out, sets the target palettes' background half
// ($0516-$0525) black and spawns the signature object (`LDY #$F5 / LDA #$BA / JMP $D6C7`: metasprite 0A:$BAF5, 22
// entries [tile, x, y, attributes], the date's 7 then Joe's 15); steps 6-7 fade in and idle. PPUCTRL $FE = $91
// (background tiles from $1000, nametable $2400), scroll ($B7, $BA) 0; the sprites use palette 3 (white).
//
// Our step 5 tail (bank 1), with NMI and rendering off while it draws:
// - both nametables cleared by the game's own routine (0F:$D6AC: tile $20, attributes 0);
// - the font: the dialogue font (0B:$B800) is 64 ready-made 16-byte tiles, character code = tile number. A 1 KB copy to
//   $1200 makes code c tile $20 + c, so the clear's tile $20 is the space. Bank 1 code can't read bank 0B, so a loop
//   there does the copy (FONT_COPY_SIZE bytes reserved by writeMessages): bank 1 pushes its address - 1 and jumps to
//   0F:$DCAA with A = $0B (map the bank, RTS into it); the loop ends `JMP $DCA8` (bank $65, 1, back, and RTS to the
//   caller);
// - the heart: 2 sprite tiles (its left half; the right half is them mirrored) written over the date's tiles $40-$41
//   in the sprite pattern table (CHR RAM only: the ROM's records, which other rooms load too, stay as they are), and
//   the signature's metasprite rewritten in place: the heart's 4 entries, then Joe's 15;
// - the lines: [PPU hi, lo, length, tiles] records ending at 0; $FF moves on to the next piece of data (the free space
//   is in pieces); a length with bit 7 copies the run timer's time line (RAM $04A2, timer.ts) instead;
// - the printer stopped ($74 = 0: the letter's last page may still be waiting), scroll 0, and the target palettes:
//   background 0's text white, sprite 3's colors 2-3 pink (Joe draws in color 1 only).
// The run timer's own final-screen print (timer.ts) is left out with this screen, which frees its code ($BF7A-$BFBA).

import { assemble } from './asm.ts';
import { encodeText } from './text.ts';

const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + (cpu - (bank === 0x0f ? 0xc000 : 0x8000));
const lo = (a: number) => a & 0xff, hi = (a: number) => a >> 8;

const STEP5_TAIL = 0xbee8; // 1: LDY #$F5 / LDA #$BA / JMP $D6C7
/** Bank 1 space: after the pickups' palette blocks (pickups.ts PAL_END) to the timer's code; the timer's final-screen
 * code's old place and the fill after its print call; the timer's conversion code's tail. Each piece is checked free. */
export const CODE = 0x9de0;
const PIECES: [number, number][] = [[CODE, 0x9f00], [0xbf7a, 0xbfbb], [0xbfc0, 0xbfe0], [0x9f00, 0xa000]];
const SIGNATURE = 0xbaf5; // 0A
const TIME_LINE = 0x04a2, TIME_LEN = 0x0491; // timer.ts: the time message's second line, and the message's length
const FONT_TILE = 0x20, HEART_TILE = 0x40;
/** The heart's top-left corner, from the signature object's position ($80, $A8). */
const HEART_AT = { x: -20, y: -16 }; // (beside Joe, who is 12 pixels lower: SIGNATURE_Y)
/** The signature object's x (vanilla $80, 1:$BED5 `LDA #$80 / STA $0582`): 48 pixels right. */
const SIGNATURE_X = 0xb0;
/** Its y (vanilla $A8, 1:$BED9 `LDA #$A8 / STA $05BC`): 12 pixels down. */
const SIGNATURE_Y = 0xb4;

/** The heart's left half, 8x16 (the right half mirrors it): 1 white, 2 pink, 3 dark pink. */
const HEART = [
  '........',
  '..3333..',
  '.322223.',
  '32211223',
  '32112222',
  '32122222',
  '32222222',
  '32222222',
  '.3222222',
  '..322222',
  '...32222',
  '....3222',
  '.....322',
  '......32',
  '.......3',
  '........',
];
const SPRITE_PINK = [0x25, 0x15]; // sprite palette 3, colors 2-3
const TEXT_WHITE = 0x30;

function heartTiles(): number[] {
  const out: number[] = [];
  for (const top of [0, 8]) for (const plane of [0, 1]) for (let r = 0; r < 8; r++) {
    let b = 0;
    for (let c = 0; c < 8; c++) b = (b << 1) | (('.123'.indexOf(HEART[top + r][c]) >> plane) & 1);
    out.push(b);
  }
  return out;
}

export interface FinalScreen {
  /** The run style: a preset's name, or CUSTOM. */
  style: string;
  seedCode: string;
  version: string;
  /** The run timer is on: its time gets a line. */
  timer: boolean;
  /** When the ROM was generated (its local date is shown). */
  date: Date;
}

/** Bank 0B bytes the font copy needs (reserve them with writeMessages). */
export const FONT_COPY_SIZE = 16;

/** The screen's lines: [row, column, text]; `{TIME}` is the run timer's time. The list at the top is left-aligned with
 * a blank row between its lines, the rest centered. */
function lines(f: FinalScreen): [number, number, string][] {
  const d = f.date, pad = (n: number) => String(n).padStart(2, '0');
  const center = (row: number, text: string): [number, number, string] => [row, (32 - text.length) >> 1, text];
  const list = [...(f.timer ? ['MISSION TIME- {TIME}'] : []), `RUN STYLE- ${f.style}`, `SEED- ${f.seedCode}`, `VERSION- ${f.version}`];
  // (the SEED line's 31 columns, the screen's width less its left column, hold a code of 25 characters: custom's 24)
  if (`SEED- ${f.seedCode}`.length > 31) throw new Error('final screen: the seed code is too long for its line');
  return [
    ...list.map((text, i): [number, number, string] => [3 + 2 * i, 1, text]),
    center(12, 'GENERATED AT'),
    center(13, 'COMRANDO.COM'),
    center(14, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`),
    center(17, 'THANK YOU FOR PLAYING!'),
  ];
}

/** Install the final screen; `copyAt` is the bank 0B space reserved for the font copy (FONT_COPY_SIZE). */
export function finalScreen(rom: Uint8Array, f: FinalScreen, copyAt: number) {
  const isFree = (bank: number, from: number, to: number) => rom.subarray(off(bank, from), off(bank, to)).every((b) => b === 0xff);
  const expect = (bank: number, at: number, bytes: number[], what: string) => {
    if (!bytes.every((b, i) => b < 0 || rom[off(bank, at) + i] === b)) throw new Error(`final screen: unexpected ${what}`);
  };
  expect(0x01, STEP5_TAIL, [0xa0, lo(SIGNATURE), 0xa9, hi(SIGNATURE), 0x4c, 0xc7, 0xd6], 'scene 5 step 5 tail');
  expect(0x0a, SIGNATURE, [22, 0x40, 0xd8, 0xe8, 3], 'signature metasprite');

  // the records, one array per line
  const records: number[][] = [];
  const nt = (row: number, col: number) => 0x2400 + row * 32 + col;
  for (const [row, col, text] of lines(f)) {
    let c = col;
    for (const [i, part] of text.split('{TIME}').entries()) {
      if (i) { records.push([hi(nt(row, c)), lo(nt(row, c)), 0x80 | 16]); c += 16; }
      if (!part) continue;
      if (c + part.length > 32) throw new Error(`final screen: line too long: ${part}`);
      records.push([hi(nt(row, c)), lo(nt(row, c)), part.length, ...[...encodeText(part)].map((t) => FONT_TILE + t)]);
      c += part.length;
    }
  }

  const code = (dataAt: number) => assemble(CODE, [
    0x20, 0xb2, 0xd6, 0x20, 0xa3, 0xd6, //                    JSR $D6B2 (NMI off) / JSR $D6A3 (rendering off)
    0x20, 0xac, 0xd6, //                                       JSR $D6AC (both nametables: tile $20, attributes 0)
    0xa9, 0x10 + (FONT_TILE >> 4), 0x8d, 0x06, 0x20, 0xa9, 0x00, 0x8d, 0x06, 0x20, // PPU $1200
    0x85, 0x17, 0xa9, 0xb8, 0x85, 0x18, 0xa2, 0x04, 0xa0, 0x00, // ($17) = $B800, X = 4 pages, Y = 0
    { abs: 0x20, to: 'far' }, //                               JSR far (the font, from bank 0B)
    0xa9, HEART_TILE >> 4, 0x8d, 0x06, 0x20, 0xa9, lo(HEART_TILE << 4), 0x8d, 0x06, 0x20, // PPU $0400 (sprite tiles)
    0xa2, 0x00, { label: 'heart' }, { abs: 0xbd, to: 'heartTiles' }, 0x8d, 0x07, 0x20, 0xe8, 0xe0, 32, { rel: 0xd0, to: 'heart' },
    0xa9, lo(dataAt), 0x85, 0x17, 0xa9, hi(dataAt), 0x85, 0x18, // ($17) = the records
    { label: 'record' }, 0xa0, 0x00, 0xb1, 0x17, { rel: 0xf0, to: 'done' }, // LDY #0 / LDA ($17),Y / BEQ done
    0xc9, 0xff, { rel: 0xd0, to: 'address' }, //               CMP #$FF / BNE address
    0xc8, 0xb1, 0x17, 0xaa, 0xc8, 0xb1, 0x17, 0x85, 0x18, 0x86, 0x17, { rel: 0xd0, to: 'record' }, // the next piece
    { label: 'address' }, 0x8d, 0x06, 0x20, 0xc8, 0xb1, 0x17, 0x8d, 0x06, 0x20, 0xc8,
    0xb1, 0x17, 0xc8, 0xaa, { rel: 0x30, to: 'time' }, //      LDA length / INY / TAX / BMI time
    { label: 'text' }, 0xb1, 0x17, 0x8d, 0x07, 0x20, 0xc8, 0xca, { rel: 0xd0, to: 'text' }, { rel: 0xf0, to: 'next' },
    { label: 'time' }, 0xad, lo(TIME_LEN), hi(TIME_LEN), 0x38, 0xe9, 16, 0x85, 0x19, // the line's length: message's - 16
    0xa2, 0x00, { label: 'timeLoop' }, 0xbd, lo(TIME_LINE), hi(TIME_LINE), 0x18, 0x69, FONT_TILE,
    0x8d, 0x07, 0x20, 0xe8, 0xe4, 0x19, { rel: 0x90, to: 'timeLoop' }, 0xa2, 0x00, { rel: 0xf0, to: 'next' }, // CPX $19 / BCC
    { label: 'next' }, 0x98, 0x18, 0x65, 0x17, 0x85, 0x17, { rel: 0x90, to: 'record' }, 0xe6, 0x18, { rel: 0xd0, to: 'record' }, // ($17) += Y
    { label: 'done' },
    0xa9, TEXT_WHITE, 0x8d, 0x17, 0x05, //                     LDA #$30 / STA $0517 (background 0, color 1)
    0xa9, SPRITE_PINK[0], 0x8d, 0x34, 0x05, 0xa9, SPRITE_PINK[1], 0x8d, 0x35, 0x05, // sprite 3, colors 2-3
    0xa9, 0x00, 0x85, 0x74, 0x85, 0xb7, 0x85, 0xba, //          stop the printer; scroll 0
    0x20, 0xaf, 0xd6, 0x20, 0xa6, 0xd6, //                    JSR $D6AF (NMI on) / JSR $D6A6 (rendering on)
    0xa2, 0x13, 0xa0, lo(SIGNATURE), 0xa9, hi(SIGNATURE), 0x4c, 0xc7, 0xd6, // the signature (heart and Joe), object slot $13
    { label: 'far' }, 0xa9, hi(copyAt - 1), 0x48, 0xa9, lo(copyAt - 1), 0x48, 0xa9, 0x0b, 0x4c, 0xaa, 0xdc, // RTS into 0B
    { label: 'heartTiles' }, ...heartTiles(),
  ]);
  const size = code(0).length;

  // the records into the free pieces, largest first (each piece ends with $FF + the next piece's address, the last 0)
  const free: [number, number][] = [];
  for (const [from, to] of PIECES) {
    let start = from === CODE ? CODE + size : from;
    for (let a = to - 1; a >= start; a--) if (rom[off(0x01, a)] !== 0xff) { start = a + 2; break; } // (after the timer's code)
    if (to - start > 3) free.push([start, to]);
  }
  const bins = free.map(([start, to]) => ({ start, room: to - start - 3, bytes: [] as number[] }));
  for (const rec of [...records].sort((x, y) => y.length - x.length)) {
    const bin = bins.find((b) => b.room >= rec.length);
    if (!bin) throw new Error(`final screen: no room for the lines (code ${size} bytes)`);
    bin.bytes.push(...rec);
    bin.room -= rec.length;
  }
  const placed = bins.filter((b) => b.bytes.length).map((b) => [b.start, b.bytes] as [number, number[]]);
  placed.forEach(([at, bytes], i) => {
    const next = placed[i + 1];
    rom.set([...bytes, ...(next ? [0xff, lo(next[0]), hi(next[0])] : [0])], off(0x01, at));
  });
  if (!isFree(0x01, CODE, CODE + size)) throw new Error('final screen: bank 1 $9DE0 not free');
  rom.set(code(placed[0][0]), off(0x01, CODE));

  // the font copy in bank 0B (X pages from ($17) to the PPU)
  const copy = assemble(copyAt, [
    { label: 'loop' }, 0xb1, 0x17, 0x8d, 0x07, 0x20, 0xc8, { rel: 0xd0, to: 'loop' }, // LDA ($17),Y / STA $2007 / INY / BNE
    0xe6, 0x18, 0xca, { rel: 0xd0, to: 'loop' }, //            INC $18 / DEX / BNE
    0x4c, 0xa8, 0xdc, //                                       JMP $DCA8 (bank 1 back; returns to the caller)
  ]);
  if (copy.length !== FONT_COPY_SIZE) throw new Error('final screen: font copy size');
  rom.set(copy, off(0x0b, copyAt));

  // the signature: the heart (left half, then mirrored), then Joe's 15 entries
  const at = off(0x0a, SIGNATURE);
  const joe = [...rom.subarray(at + 1 + 7 * 4, at + 1 + 22 * 4)];
  const { x, y } = HEART_AT;
  const heart = [[HEART_TILE, x, y, 3], [HEART_TILE, x + 8, y, 0x43], [HEART_TILE + 1, x, y + 8, 3], [HEART_TILE + 1, x + 8, y + 8, 0x43]]
    .flatMap(([t, ex, ey, a]) => [t, ex & 0xff, ey & 0xff, a]);
  rom.fill(0xff, at, at + 1 + 22 * 4);
  rom.set([19, ...heart, ...joe], at);

  expect(0x01, 0xbed4, [0xa9, 0x80, 0x8d, 0x82, 0x05], "the signature's x");
  rom[off(0x01, 0xbed5)] = SIGNATURE_X;
  expect(0x01, 0xbed9, [0xa9, 0xa8, 0x8d, 0xbc, 0x05], "the signature's y");
  rom[off(0x01, 0xbeda)] = SIGNATURE_Y;
  rom.set([0x4c, lo(CODE), hi(CODE)], off(0x01, STEP5_TAIL));
}
