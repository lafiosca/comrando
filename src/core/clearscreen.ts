// The area-clear screen ("xxAREA CLEAR / BONUS x10 / WE'VE OBTAINED <name>"), extended (docs/rom-notes.md#area-clear-screen):
// - Names live in bank 0B. The vanilla name block (0A:$B17B) is full and bank 0A has no room left, so the screen's
//   name copy (0A:$B0FA) calls out to bank 0B, where a per-seed table names each area's reward (communicators, IFF
//   Code, Flak Map and Flare included).
// - The underground passage gets its own clear screen when its item is taken: the pickup also sets PASSAGE_MARK (a
//   per-visit byte the game clears on every return to the map), and the overhead stages' end (0D:$8281) goes to the
//   clear screen (state $CB = 2) instead of the map when it's set. There the screen says "PASSAGE CLEAR", names the
//   passage item, and on its way out sets no area flag and gives nothing more (the pickup already did) except the
//   bonus bullets, as any clear.
//
// Bank calls: 0A $BF84 `LDA #$0B / JSR $DCAA` returns into bank 0B at $BF89 (`JMP routine`); the routine ends
// `JMP $DCA8` (maps $65 = 0A back and returns to the 0A caller). It runs twice per clear: in setup ($CC = 0) it fills
// in the name, and at the end ($CC = 1) it sets the area flag, or returns Y = 0 for the passage (0A then skips to the
// bonus).

import { assemble } from './asm.ts';
import { encodeText } from './text.ts';
import { CLEAR_NAMES, ITEMS, type Item } from './world.ts';

const off0A = (cpu: number) => 0x10 + 0x0a * 0x4000 + cpu - 0x8000;
const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const off0D = (cpu: number) => 0x10 + 0x0d * 0x4000 + cpu - 0x8000;

const NAME_SITE = 0xb0fa; // 0A: the name copy, 21 bytes up to $B10F (LDY #$F2 / JSR $D730: print)
const FLAG_SITE = 0xb13c; // 0A: LDY $4D / LDA #1 / STA $04EA,Y (area flag), then the reward at $B143
const SKIP_TO = 0xb154; // 0A: past the reward: the bonus bullets, then the map
const CALL = 0xbf84; // 0A free $BF84-$BF8F (the bank call), bank 0B continues at $BF89
const ENTRY = 0xbf89; // 0B free $BF88-$BF9F
/** Bank 0B space for the routine, tables and names (text.ts lends $BCC0-$BE3F to text). */
export const CLEAR_SPACE = 0xbe40, CLEAR_SPACE_END = 0xbf80;
/** Per-visit RAM (0D:$A413 clears $04BE-$04C9 on every map entry): passage item taken. The Destroyers' talk (0F:$F895)
 * also writes $04C6-$04C8 in NZ18, but a map entry always comes between that and an overhead stage. */
const PASSAGE_MARK = 0x04c7;
const PASSAGE_TOUCH = 0x9062; // 0D: LDY #$34 / JSR $D754 (sound) / LDA #1 / STA flag / JMP $D6CA
const STAGE_END = 0x8281; // 0D: LDA #0 / STA $CD / STA $CE / LDA #1 / STA $CC / RTS (overhead stage over: the map)
const PASSAGE_CODE = 0xbfa0; // 0D free ($00 fill $BF7F-$BFDF; roomtalk.ts uses $BF80-$BF92)

function expect(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (bytes.some((b, i) => rom[at + i] !== b)) throw new Error(`clear screen: unexpected bytes at ${what}`);
}

/** The clear screen's text for an item (vanilla block bytes, keeping their line-filling spaces, or CLEAR_NAMES). */
function nameBytes(rom: Uint8Array, item: Item): number[] {
  const extra = CLEAR_NAMES[item]?.text;
  if (extra) return [...encodeText(extra)];
  const at = ITEMS[item].clearText;
  if (at === undefined) return [...encodeText(ITEMS[item].name.toUpperCase())]; // (no vanilla name: Machine Gun)
  const out: number[] = [];
  for (let a = off0A(0xb17b + at); rom[a] !== 0xff; a++) out.push(rom[a]);
  return out;
}

/**
 * Names from bank 0B: `names` maps area node (1-12) -> the item its clear screen names; `passage`, if given, is the
 * underground passage's item and turns on its clear screen.
 */
export function applyClearScreen(rom: Uint8Array, names: Map<number, Item>, passage?: Item) {
  // --- tables: offsets by node (index 0 = the passage; $FF = no name), then the names, each $FF-terminated ---
  const strings: number[] = [], at = new Map<string, number>();
  const place = (bytes: number[]) => {
    const key = bytes.join(',');
    if (!at.has(key)) { at.set(key, strings.length); strings.push(...bytes, 0xff); }
    return at.get(key)!;
  };
  const offsets = Array.from({ length: 13 }, (_, n) => {
    const item = n === 0 ? passage : names.get(n);
    return item ? place(nameBytes(rom, item)) : 0xff;
  });
  if (strings.length > 0xff) throw new Error('clear screen: names too long');
  const PASSAGE = [...encodeText('PASSAGE  ')]; // over "xxAREA   " ($0102-$010A): "PASSAGE  CLEAR"

  const code = (pass: number, offs: number, nm: number) => assemble(CLEAR_SPACE, [
    0xa5, 0xcc, { rel: 0xd0, to: 'end' }, //           LDA $CC / BNE end (the clear's last step)
    0xa4, 0x4d, //                                      LDY $4D
    0xad, PASSAGE_MARK & 0xff, PASSAGE_MARK >> 8, { rel: 0xf0, to: 'named' }, // LDA mark / BEQ named
    0xa2, 0x08, //                                      LDX #8
    { label: 'l1' }, 0xbd, pass & 0xff, pass >> 8, 0x9d, 0x02, 0x01, 0xca, { rel: 0x10, to: 'l1' }, // "PASSAGE  "
    0xa0, 0x00, //                                      LDY #0 (the passage's name)
    { label: 'named' },
    0xb9, offs & 0xff, offs >> 8, 0xc9, 0xff, { rel: 0xf0, to: 'done' }, // LDA offs,Y / CMP #$FF / BEQ done
    0xaa, 0xa0, 0x00, //                                TAX / LDY #0
    { label: 'l3' }, 0xbd, nm & 0xff, nm >> 8, { rel: 0x30, to: 'done' }, // LDA names,X / BMI done
    0x99, 0x32, 0x01, 0xe8, 0xc8, { rel: 0xd0, to: 'l3' }, // STA $0132,Y / INX / INY / BNE
    { label: 'done' },
    0x4c, 0xa8, 0xdc, //                                JMP $DCA8 (bank 0A, return)
    { label: 'end' },
    0xa4, 0x4d, //                                      LDY $4D
    0xad, PASSAGE_MARK & 0xff, PASSAGE_MARK >> 8, { rel: 0xd0, to: 'passage' }, // LDA mark / BNE passage
    0xa9, 0x01, 0x99, 0xea, 0x04, 0x4c, 0xa8, 0xdc, //  LDA #1 / STA $04EA,Y (the area flag) / JMP $DCA8 (Y = node)
    { label: 'passage' }, 0xa0, 0x00, 0x4c, 0xa8, 0xdc, // LDY #0 / JMP $DCA8
  ]);
  const size = code(0, 0, 0).length;
  const pass = CLEAR_SPACE + size, offs = pass + PASSAGE.length, nm = offs + offsets.length;
  const block = [...code(pass, offs, nm), ...PASSAGE, ...offsets, ...strings];
  if (CLEAR_SPACE + block.length > CLEAR_SPACE_END) throw new Error('clear screen: no room in bank 0B');
  for (let a = CLEAR_SPACE; a < CLEAR_SPACE + block.length; a++) {
    if (rom[off0B(a)] !== ((a >> 5) & 1 ? 0x00 : 0xff)) throw new Error('clear screen: 0B:$BE40 not free');
  }
  rom.set(block, off0B(CLEAR_SPACE));

  // --- the bank call ---
  expect(rom, off0A(CALL), new Array(5).fill(0xff), 'free space 0A:$BF84');
  expect(rom, off0B(ENTRY), new Array(3).fill(0xff), 'free space 0B:$BF89');
  rom.set([0xa9, 0x0b, 0x20, 0xaa, 0xdc], off0A(CALL)); // LDA #$0B / JSR $DCAA
  rom.set([0x4c, CLEAR_SPACE & 0xff, CLEAR_SPACE >> 8], off0B(ENTRY)); // JMP routine
  // name copy -> JSR call / JMP $B10F
  expect(rom, off0A(NAME_SITE), [0xb9, 0x7a, 0xb1, 0xf0, 0x10, 0xa8, 0xa2, 0x00, 0xb9, 0x7b, 0xb1, 0x30, 0x08, 0x9d, 0x32, 0x01,
    0xc8, 0xe8, 0x4c, 0x02, 0xb1], 'clear name copy');
  rom.set([0x20, CALL & 0xff, CALL >> 8, 0x4c, 0x0f, 0xb1, ...new Array(15).fill(0xea)], off0A(NAME_SITE));
  if (!passage) return;

  // --- the passage: the end of the clear skips the area flag and the reward ---
  expect(rom, off0A(FLAG_SITE), [0xa4, 0x4d, 0xa9, 0x01, 0x99, 0xea, 0x04], 'clear area flag');
  rom.set([0x20, CALL & 0xff, CALL >> 8, 0x98, 0xf0, SKIP_TO - (FLAG_SITE + 6), 0xea], off0A(FLAG_SITE)); // JSR / TYA / BEQ skip
  // the pickup also sets the mark (after placePassageItem set its flag)
  const touch = off0D(PASSAGE_TOUCH);
  expect(rom, touch, [0xa0, 0x34, 0x20, 0x54, 0xd7, 0xa9, 0x01, 0x8d], 'passage pickup touch');
  const flag = [rom[touch + 8], rom[touch + 9]];
  const helper = [0xa9, 0x01, 0x8d, ...flag, 0x8d, PASSAGE_MARK & 0xff, PASSAGE_MARK >> 8, 0x60]; // LDA #1 / STA flag / STA mark / RTS
  const END_HOOK = PASSAGE_CODE + helper.length;
  const endHook = [
    0xa9, 0x00, 0x85, 0xcd, 0x85, 0xce, //                LDA #0 / STA $CD / STA $CE
    0xad, PASSAGE_MARK & 0xff, PASSAGE_MARK >> 8, 0xf0, 0x09, // LDA mark / BEQ map
    0xa9, 0x02, 0x85, 0xcb, 0xa9, 0x00, 0x85, 0xcc, 0x60, // LDA #2 / STA $CB (area clear) / LDA #0 / STA $CC / RTS
    0xa9, 0x01, 0x85, 0xcc, 0x60, //                      map: LDA #1 / STA $CC / RTS
  ];
  const all = [...helper, ...endHook];
  expect(rom, off0D(PASSAGE_CODE), new Array(all.length).fill(0x00), 'free space 0D:$BFA0');
  if (PASSAGE_CODE + all.length > 0xbfe0) throw new Error('clear screen: 0D code too big');
  rom.set(all, off0D(PASSAGE_CODE));
  rom.set([0x20, PASSAGE_CODE & 0xff, PASSAGE_CODE >> 8, 0xea, 0xea], touch + 5); // JSR helper / NOP NOP
  expect(rom, off0D(STAGE_END), [0xa9, 0x00, 0x85, 0xcd, 0x85, 0xce, 0xa9, 0x01, 0x85, 0xcc, 0x60], 'overhead stage end');
  rom.set([0x4c, END_HOOK & 0xff, END_HOOK >> 8, ...new Array(8).fill(0xea)], off0D(STAGE_END));
}
