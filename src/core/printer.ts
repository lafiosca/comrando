// Runs of spaces print instantly. The message printer (0F:$C441, every other frame) types one character per call: it
// reads text byte ($7A),$79, copies the glyph into the text box's next pattern tile ($7C/$7D) and counts down $78, so
// padding (no newline code; text.ts wrap) took as long as letters, and the portrait kept talking through it. A page's
// tiles are cleared before it is typed (0F:$C433), so a space never needs drawing: the hook skips each space that is
// followed by another, unless it is the message's or the page's last cell, and the run's last space prints as usual
// (single spaces between words keep their timing). Box styles 0 and 2 ($75: the in-room talk, the story) have pages
// of 64 cells, so the page's last cell is text byte 65 mod 64; style 1 (the radio: comm rooms, the intro briefing;
// the Nonsense briefings' page breaks kept the portrait talking) has 96, the last cells bytes 97 and 193
// (a message is at most 255 cells); style 3 (other page sizes) types as before. The
// hook sits in bank 0B with the text (mapped while printing).

import { assemble } from './asm.ts';

const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const off0F = (cpu: number) => 0x10 + 0x0f * 0x4000 + cpu - 0xc000;
const FETCH = 0xc458; // 0F: LDY $79 / LDA ($7A),Y, then LDX #0 (the glyph upload) with A = the character

/** Bank 0B bytes the hook needs (reserve them with writeMessages). */
export const FAST_SPACES_SIZE = 61;

export function applyFastSpaces(rom: Uint8Array, at: number) {
  if (![0xa4, 0x79, 0xb1, 0x7a, 0xa2, 0x00].every((b, i) => rom[off0F(FETCH) + i] === b)) throw new Error('printer: unexpected fetch');
  const code = assemble(at, [
    0xa4, 0x79, //                                  LDY $79
    { label: 'next' }, 0xb1, 0x7a, //               LDA ($7A),Y
    { rel: 0xd0, to: 'out' }, //                    BNE out (a letter)
    0xa5, 0x78, 0xc9, 0x02, { rel: 0x90, to: 'space' }, // LDA $78 / CMP #2 / BCC space (the message's last cell)
    0xc8, 0xb1, 0x7a, { rel: 0xd0, to: 'space' }, // INY / LDA ($7A),Y / BNE space (a single space; Y = the next cell)
    0xa5, 0x75, 0x4a, { rel: 0x90, to: 'p64' }, //   LDA $75 / LSR A / BCC p64 (box styles 0, 2)
    { rel: 0xd0, to: 'space' }, //                  BNE space (style 3)
    0xc0, 98, { rel: 0xf0, to: 'space' }, 0xc0, 194, { rel: 0xf0, to: 'space' }, // CPY #98 / BEQ / CPY #194 / BEQ (style 1: the page's last cell)
    { rel: 0xd0, to: 'skip' }, //                   BNE skip
    { label: 'p64' }, 0x98, 0x29, 0x3f, 0xc9, 0x02, { rel: 0xf0, to: 'space' }, // TYA / AND #$3F / CMP #2 / BEQ space (the page's last cell)
    { label: 'skip' },
    0x84, 0x79, 0xc6, 0x78, //                      STY $79 / DEC $78 (skip it)
    0x18, 0xa5, 0x7c, 0x69, 0x10, 0x85, 0x7c, //    CLC / LDA $7C / ADC #$10 / STA $7C (the next cell's tile)
    { rel: 0x90, to: 'next' }, 0xe6, 0x7d, { rel: 0xd0, to: 'next' }, // BCC next / INC $7D / BNE next
    { label: 'space' }, 0xa9, 0x00, //              LDA #0
    { label: 'out' }, 0x60, //                      RTS
  ]);
  if (code.length > FAST_SPACES_SIZE) throw new Error(`printer: hook is ${code.length} bytes`);
  rom.set(code, off0B(at));
  rom.set([0x20, at & 0xff, at >> 8, 0xea], off0F(FETCH)); // JSR hook / NOP
}
