// Cosmetic option "Robot Portrait": the robot bosses (header $00: no close-up in vanilla) get a head-on portrait
// (robotart.ts, drawn by scripts/robot-portrait.py). See docs/rom-notes.md#portraits.
//
// - Which messages: the header parser (0F:$E0BA, `AND #$0F / STA $76 / DEC $76`, bank 0B mapped) calls a hook in bank
//   0B: a header with no portrait (low nibble 0) in a robot boss room ($19, $1D, $1F: BOSS_TYPE $67), in a level's talk
//   mode ($CB = 1, $CC = 4; not the area clear or the map after it, whose $4C is still the room), gets portrait
//   index 15 ($76), one past the vanilla 0-14.
// - Loading it: the talk mode's state 1 (0F:$C38C: pointers from 0B:$8000, the pair table, the art and layout tables
//   0F:$C34C / $C368, the 16 palette bytes) moves to bank 0B (the state table's word at 0F:$C2F5 points there), with
//   index 15 taking the robot's art, layout and palettes. That frees its fixed-bank space: the layout table goes to
//   bank 0B with it, the box tables (0F:$C384: positions, read at $C5EE / $C5FA; $C388: sprite slots, at $C2D3) move down to $C368, and the robot's
//   layout (99 bytes; the drawing at 0F:$C5DA maps bank 0C but reads the layout through ($83), any address) follows.
// - The art: the 16 tiles go into blank slots of Killt's 1KB art window (9:$8B80) that his layout never draws and no
//   sprite record loads (record $33 ends at $8DBF); the robot's art pointer is that window.
// - The palettes: the unused palette group at offset $70 (0B:$A6FF; Joe's own copy is at $60).

import { assemble } from './asm.ts';
import { ROBOT_LAYOUT, ROBOT_PALETTES, ROBOT_SLOTS, ROBOT_TILES } from './robotart.ts';
import { BOSS_TYPE } from './roomtalk.ts';

const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const off09 = (cpu: number) => 0x10 + 0x09 * 0x4000 + cpu - 0x8000;
const off0F = (cpu: number) => 0x10 + 0x0f * 0x4000 + cpu - 0xc000;

const ROBOT = 15; // portrait index ($76)
const ROBOT_ROOMS = Object.entries(BOSS_TYPE).filter(([, t]) => t === 0x67).map(([r]) => Number(r)); // $19, $1D, $1F
const ART_WINDOW = 0x8b80; // 9: Killt's art (his pair's art entry: $80, $CB)
const ART_ENTRY = [0x80, 0xcb];
export const ROBOT_GROUP = 0x70; // palette group offset (0B:$A68F + $70)
const GROUPS = 0xa68f;
const STATES = 0xc2f3, LOADER = 0xc38c, LOADER_END = 0xc3df, ART_TABLE = 0xc34c, LAYOUT_TABLE = 0xc368, POS_TABLE = 0xc384;
const NEW_POS = LAYOUT_TABLE, NEW_LAYOUT = NEW_POS + 8;
const HEADER = 0xe0ba;

/** Bank 0B bytes the option needs (reserve them with writeMessages). */
export const ROBOT_0B_SIZE = 166;

function expect(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (!bytes.every((b, i) => rom[at + i] === b)) throw new Error(`robot portrait: unexpected ${what}`);
}

/** Install the robot portrait; `at` is the bank 0B space reserved for it (ROBOT_0B_SIZE). */
export function robotPortrait(rom: Uint8Array, at: number) {
  expect(rom, off0F(STATES + 2), [LOADER & 0xff, LOADER >> 8], "talk state 1's entry");
  expect(rom, off0F(LOADER), [0xad, 0x00, 0x80, 0x85, 0x17, 0xad, 0x01, 0x80], 'portrait loader');
  expect(rom, off0F(LOADER_END - 5), [0xe6, 0x32, 0xe6, 0x82, 0x60], "portrait loader's end");
  expect(rom, off0F(POS_TABLE - 2), [0x09, 0xbe], 'layout table');
  expect(rom, off0F(0xc2d3), [0xbd, (POS_TABLE + 4) & 0xff, POS_TABLE >> 8], 'sprite slot per box style');
  expect(rom, off0F(0xc5ee), [0x7d, POS_TABLE & 0xff, POS_TABLE >> 8], 'box position (x)');
  expect(rom, off0F(0xc5fa), [0x7d, (POS_TABLE + 1) & 0xff, POS_TABLE >> 8], 'box position (y)');
  expect(rom, off0F(HEADER), [0x29, 0x0f, 0x85, 0x76, 0xc6, 0x76], 'header parser');
  expect(rom, off0B(GROUPS + ROBOT_GROUP), new Array(16).fill(0x0f), 'unused portrait palettes');
  ROBOT_SLOTS.forEach((s) => expect(rom, off09(ART_WINDOW + 16 * s), new Array(16).fill(0), `art slot ${s}`));
  if (NEW_LAYOUT + ROBOT_LAYOUT.length > LOADER_END) throw new Error('robot portrait: layout too big');

  const layoutTable = [...rom.subarray(off0F(LAYOUT_TABLE), off0F(LAYOUT_TABLE) + 28)];
  const labels: Record<string, number> = {};
  const code = assemble(at, [
    // talk state 1 (as 0F:$C38C), plus the robot
    { label: 'load' }, 0xa2, 0x03, { label: 'ptrs' }, 0xbd, 0x00, 0x80, 0x95, 0x17, 0xca, { rel: 0x10, to: 'ptrs' }, // ($17), ($19) = 0B:$8000-$8003
    0xa5, 0x76, 0xc9, ROBOT, { rel: 0xf0, to: 'robot' }, //            LDA $76 / CMP #15 / BEQ robot
    0x0a, 0x48, 0xa8, 0xb1, 0x19, 0xa8, //                              ASL / PHA / TAY / LDA ($19),Y (the art index) / TAY
    0xb9, ART_TABLE & 0xff, ART_TABLE >> 8, 0x85, 0x7e, 0xb9, (ART_TABLE + 1) & 0xff, ART_TABLE >> 8, 0x85, 0x7f,
    { abs: 0xb9, to: 'layouts' }, 0x85, 0x83, { abs: 0xb9, to: 'layouts1' }, 0x85, 0x84,
    0x68, 0xa8, 0xc8, 0xb1, 0x19, 0xa8, //                              PLA / TAY / INY / LDA ($19),Y (the palette offset) / TAY
    { label: 'common' }, 0xa9, 0x00, 0x85, 0x7c, 0x85, 0x7d, 0xa9, 0x10, 0x85, 0x81, // PPU $0000, 16 chunks
    0xa2, 0x00, 0x86, 0x85, //                                          LDX #0 / STX $85
    { label: 'pal' }, 0xb1, 0x17, 0x95, 0xe0, 0xc8, 0xe8, 0xe0, 0x10, { rel: 0xd0, to: 'pal' }, // the 16 palette bytes
    0xe6, 0x32, 0xe6, 0x82, 0x60, //                                    INC $32 / INC $82 / RTS
    { label: 'robot' }, 0xa9, ART_ENTRY[0], 0x85, 0x7e, 0xa9, ART_ENTRY[1], 0x85, 0x7f,
    0xa9, NEW_LAYOUT & 0xff, 0x85, 0x83, 0xa9, NEW_LAYOUT >> 8, 0x85, 0x84,
    0xa0, ROBOT_GROUP, { rel: 0xd0, to: 'common' }, //                  LDY #$70 / BNE common
    // the header's portrait (0F:$E0BA): nibble 0 in a robot boss room is the robot
    // (talk in a level only, $CB = 1, $CC = 4: the area-clear screen, the map and the intro keep $4C, the last room, and
    // their boxes have no portrait either; the robot's art would replace their sprites)
    { label: 'header' }, 0x29, 0x0f, { rel: 0xd0, to: 'set' }, //       AND #$0F / BNE set
    0xa5, 0xcb, 0xc9, 0x01, { rel: 0xd0, to: 'none' }, //               LDA $CB / CMP #1 / BNE none
    0xa5, 0xcc, 0xc9, 0x04, { rel: 0xd0, to: 'none' }, //               LDA $CC / CMP #4 / BNE none
    0xa5, 0x4c, ...ROBOT_ROOMS.flatMap((r) => [0xc9, r, { rel: 0xf0, to: 'isRobot' }]), // LDA $4C / CMP #room / BEQ
    { label: 'none' }, 0xa9, 0x00, { rel: 0xf0, to: 'set' }, //         LDA #0 / BEQ set
    { label: 'isRobot' }, 0xa9, ROBOT + 1, //                           LDA #16
    { label: 'set' }, 0x85, 0x76, 0xc6, 0x76, 0x60, //                  STA $76 / DEC $76 / RTS
    { label: 'layouts' }, layoutTable[0], { label: 'layouts1' }, ...layoutTable.slice(1),
  ], labels);
  if (code.length > ROBOT_0B_SIZE) throw new Error(`robot portrait: 0B code too big (${code.length})`);
  rom.set(code, off0B(at));

  // fixed bank: the position table down, the robot's layout after it; state 1 and the header parser into bank 0B
  const pos = [...rom.subarray(off0F(POS_TABLE), off0F(POS_TABLE) + 8)];
  rom.fill(0xff, off0F(LAYOUT_TABLE), off0F(LOADER_END));
  rom.set(pos, off0F(NEW_POS));
  rom.set(ROBOT_LAYOUT, off0F(NEW_LAYOUT));
  rom.set([0xbd, (NEW_POS + 4) & 0xff, NEW_POS >> 8], off0F(0xc2d3));
  rom.set([0x7d, NEW_POS & 0xff, NEW_POS >> 8], off0F(0xc5ee));
  rom.set([0x7d, (NEW_POS + 1) & 0xff, NEW_POS >> 8], off0F(0xc5fa));
  rom.set([labels.load & 0xff, labels.load >> 8], off0F(STATES + 2));
  rom.set([0x20, labels.header & 0xff, labels.header >> 8, 0xea, 0xea, 0xea], off0F(HEADER));
  // the art and the palettes
  ROBOT_TILES.forEach((t, i) => rom.set(t, off09(ART_WINDOW + 16 * ROBOT_SLOTS[i])));
  rom.set(ROBOT_PALETTES, off0B(GROUPS + ROBOT_GROUP));
}
