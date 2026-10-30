// Final-time display (option "Final time", docs/rom-notes.md#timer): the game's real time from START on the title
// screen (new game) to the end of the escape, shown in the ending after Ladd's "MISSION ACCOMPLISHED" message.
//
// Counting: every frame's NMI. The game switches NMI off while it loads screens (~10-14 frames per transition), so
// every write to PPUCTRL ($2000, 13 sites, all in the fixed bank; not the reset one) goes through a helper that records
// what the game wanted (WANT) but keeps NMI on. The NMI vector points at a stub that counts the frame, then runs the
// game's handler ($C058) only if the game wanted NMI on, else returns. So the game sees exactly the NMIs it asked for
// and no frame goes uncounted.
// Start: the title's new-game branch (START, not CONTINUE) zeroes the count. Stop: the ending's first scene converts
// the count into the time line (a message in RAM); a new ending step prints it.

import { type Asm, assemble } from './asm.ts';

const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + (cpu - (bank === 0x0f ? 0xc000 : 0x8000));

// RAM: $01CE-$01E8 lies below the deepest stack seen ($01E9; the stack is the top of page 1), and the randomizer uses
// $01D0-$01D4 and $01D8-$01DC of it. The message goes in the map's object tables ($0440-$04BD), which the ending never
// touches; a new game clears them and the map rebuilds them.
const WANT = 0x01ce; // the PPUCTRL value the game last wrote
const FRAMES = 0x01d5; // 3 bytes, little-endian
const MSG = 0x0490; // the time message: header, length, 32 characters ($0490-$04B1)
const TEXT = MSG + 2;
const LINE2 = TEXT + 16;
// scratch while converting, inside line 1 (written last)
const SC = TEXT; // 5 bytes: frames << 16, counted down
const CNT = TEXT + 5;
const OI = TEXT + 6; // output index into line 2
const K = TEXT + 7; // unit index

// fixed bank 0F:$FFB6-$FFDF and $FFE7-$FFEF (free)
const HELPER = 0xffb6; // STA WANT / ORA #$80 / STA $2000 / LDA WANT / RTS
const STUB = 0xffc2; // the NMI vector's new target
const START = 0xffd8; // new game: zero the count (continues at $FFE7)
const START2 = 0xffe7;
// Printing the RAM message: from bank 1, `LDA #$0B / JSR $DCAA` (the printer's own bank switch) returns into bank 0B
// at the same address, where `JMP $E0AE` continues the printer past its pointer fetch; it ends `JMP $DCA8`, which maps
// the main bank (1) back and returns to the caller.
const PRINT_RAM = 0xbfbb; // bank 1 ($BF00 block); bank 0B continues at $BFC0 (free)
const GAME_NMI = 0xc058;
const NMI_VECTOR = 0xfffa;

/** NTSC frames per second (21.477272 MHz master clock / 4 / 341 / 262 - 0.5 dot). */
const FPS = 39375000 / 655171;
/** Units counted digit by digit: 10 h, 1 h, 10 min, 1 min, 10 s, 1 s, 100 ms, 10 ms, 1 ms (frames << 16 per unit). */
const UNITS = [36000, 3600, 600, 60, 10, 1, 0.1, 0.01, 0.001].map((s) => BigInt(Math.round(s * FPS * 65536)));
/** Dialogue codes (text.ts): a digit d is 2 + 2d. */
const CH = { ' ': 0x00, H: 0x05, M: 0x0f, S: 0x1b, '.': 0x30 } as const;
const LINE1 = [0x0f, 0x07, 0x1b, 0x1b, 0x07, 0x13, 0x11, 0x00, 0x1d, 0x07, 0x0f, 0x1e, 0, 0, 0, 0]; // "MISSION TIME    "
const NONE = 0xff;
const HEADER = 0xb0; // Ladd's ending message box (#7)

const lo = (a: number) => a & 0xff, hi = (a: number) => a >> 8;
const abs = (op: number, a: number) => [op, lo(a), hi(a)];

function expect(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (!bytes.every((b, i) => rom[at + i] === b)) throw new Error(`timer: unexpected bytes at ${what}`);
}

/** Install the final-time display. */
export function addFinalTimer(rom: Uint8Array) {
  // --- fixed bank: helper, NMI stub, RAM-message print ---
  const fixed = [
    ...abs(0x8d, WANT), 0x09, 0x80, ...abs(0x8d, 0x2000), ...abs(0xad, WANT), 0x60, // helper
    ...abs(0xee, FRAMES), 0xd0, 0x08, ...abs(0xee, FRAMES + 1), 0xd0, 0x03, ...abs(0xee, FRAMES + 2), // count
    ...abs(0x2c, WANT), 0x10, 0x03, ...abs(0x4c, GAME_NMI), 0x40, // BIT WANT / BPL rti / JMP game / rti: RTI
    0x85, 0x4d, ...abs(0x8d, FRAMES), ...abs(0x4c, START2), // start: STA $4D (A = 0) / STA FRAMES / JMP
  ];
  if (fixed.length !== 42) throw new Error('timer: fixed-bank code size');
  const start2 = [...abs(0x8d, FRAMES + 1), ...abs(0x8d, FRAMES + 2), 0xa9, 0x05, 0x60]; // ... / LDA #5 / RTS
  expect(rom, off(0x0f, START2), new Array(9).fill(0xff), 'free space 0F:$FFE7');
  rom.set(start2, off(0x0f, START2));
  expect(rom, off(0x0f, HELPER), new Array(42).fill(0xff), 'free space 0F:$FFB6');
  rom.set(fixed, off(0x0f, HELPER));
  expect(rom, off(0x0f, NMI_VECTOR), [lo(GAME_NMI), hi(GAME_NMI)], 'NMI vector');
  rom.set([lo(STUB), hi(STUB)], off(0x0f, NMI_VECTOR));
  // every STA $2000 in the fixed bank except reset's ($C003) goes through the helper
  let sites = 0;
  for (let cpu = 0xc010; cpu < 0xffb6; cpu++) {
    const at = off(0x0f, cpu);
    if (rom[at] === 0x8d && rom[at + 1] === 0x00 && rom[at + 2] === 0x20) { rom.set(abs(0x20, HELPER), at); sites++; }
  }
  if (sites !== 12) throw new Error(`timer: expected 12 PPUCTRL writes, found ${sites}`);

  // --- start: the title's new-game branch (START, not CONTINUE) ends STA $4D / LDA #5 / STA $CC / RTS (to the
  // story); it now calls the fixed-bank start (zero the count, A = 5) ---
  const NEW_GAME_TAIL = 0xc8a2;
  expect(rom, off(0x0f, NEW_GAME_TAIL), [0x85, 0x4d, 0xa9, 0x05, 0x85, 0xcc, 0x60], 'new-game branch tail');
  rom.set([...abs(0x20, START), 0x85, 0xcc, 0x60, 0xea], off(0x0f, NEW_GAME_TAIL));

  // --- stop: the ending's first scene (1:$BBBE, JSR $D778 ...) converts the count first ---
  const SCENE0 = 0xbbbe, CONVERT = 0x9f00;
  expect(rom, off(0x01, SCENE0), [0x20, 0x78, 0xd7, 0xe6, 0xce], 'ending scene 0');
  rom.set(abs(0x20, CONVERT), off(0x01, SCENE0));
  const convert: Asm[] = [
    // only in the ending ($CB = 4): the attract mode's intro runs the same scene code, and the message's RAM is the
    // map's object tables, which CONTINUE doesn't clear (a header byte left in slot 8's state crashed the map)
    0xa5, 0xcb, 0xc9, 0x04, { rel: 0xf0, to: 'ending' }, ...abs(0x4c, 0xd778),
    { label: 'ending' },
    // SC = frames << 16; OI = K = 0; Y = 0 (unit table offset)
    0xa9, 0x00, ...abs(0x8d, SC), ...abs(0x8d, SC + 1), ...abs(0x8d, OI), ...abs(0x8d, K),
    ...abs(0xad, FRAMES), ...abs(0x8d, SC + 2), ...abs(0xad, FRAMES + 1), ...abs(0x8d, SC + 3), ...abs(0xad, FRAMES + 2), ...abs(0x8d, SC + 4),
    0xa0, 0x00,
    { label: 'unit' },
    { abs: 0x20, to: 'count' }, //              A = this unit's digit; Y -> next unit
    // leading zeros (hours, tens of minutes) are skipped with their H: "0M 31.947S", "12M 03.500S", "1H 05M 09.123S"
    0xc9, 0x00, { rel: 0xd0, to: 'put' },
    ...abs(0xae, K), 0xe0, 0x03, { rel: 0xb0, to: 'put' },
    ...abs(0xae, OI), { rel: 0xf0, to: 'next' },
    { label: 'put' },
    0x0a, 0x69, 0x02, { abs: 0x20, to: 'out' }, // digit code 2 + 2d (carry is clear: d <= 9)
    { label: 'suffix' },
    ...abs(0xae, K), { abs: 0xbd, to: 'suf1' }, { rel: 0x30, to: 'next' }, { abs: 0x20, to: 'out' }, // ($FF: none)
    ...abs(0xae, K), { abs: 0xbd, to: 'suf2' }, { rel: 0x30, to: 'next' }, { abs: 0x20, to: 'out' },
    { label: 'next' },
    ...abs(0xee, K), ...abs(0xad, K), 0xc9, UNITS.length, { rel: 0xd0, to: 'unit' },
    // header, length, line 1
    0xa9, HEADER, ...abs(0x8d, MSG), ...abs(0xad, OI), 0x18, 0x69, 16, ...abs(0x8d, MSG + 1),
    0xa2, 15, { label: 'line1' }, { abs: 0xbd, to: 'line1text' }, ...abs(0x9d, TEXT), 0xca, { rel: 0x10, to: 'line1' },
    ...abs(0x4c, 0xd778), //                       the scene's own first call
    // out: A -> line 2 (uses X)
    { label: 'out' }, ...abs(0xae, OI), ...abs(0x9d, LINE2), ...abs(0xee, OI), 0x60,
    // count: A = how many times the unit at Y fits in SC (subtracting it); Y advances 5
    { label: 'count' }, 0xa9, 0x00, ...abs(0x8d, CNT),
    { label: 'sub' }, 0xa2, 0x00, 0x38,
    { label: 'sbyte' }, ...abs(0xbd, SC), { abs: 0xf9, to: 'units' }, ...abs(0x9d, SC), 0xc8, 0xe8, 0x8a, 0x49, 0x05, { rel: 0xd0, to: 'sbyte' },
    { rel: 0x90, to: 'undo' },
    ...abs(0xee, CNT), 0x98, 0x38, 0xe9, 0x05, 0xa8, { rel: 0xb0, to: 'sub' }, // (carry set: always)
    { label: 'undo' }, 0x98, 0x38, 0xe9, 0x05, 0xa8, 0xa2, 0x00, 0x18,
    { label: 'abyte' }, ...abs(0xbd, SC), { abs: 0x79, to: 'units' }, ...abs(0x9d, SC), 0xc8, 0xe8, 0x8a, 0x49, 0x05, { rel: 0xd0, to: 'abyte' },
    ...abs(0xad, CNT), 0x60,
  ];
  // (its tables sit with the ending step at 1:$BF00, below)
  const STEPS = 0xbf00;
  const data: Asm[] = [
    { label: 'suf1' }, NONE, CH.H, NONE, CH.M, NONE, CH['.'], NONE, NONE, CH.S, // after each digit
    { label: 'suf2' }, NONE, CH[' '], NONE, CH[' '], NONE, NONE, NONE, NONE, NONE,
    { label: 'line1text' }, ...LINE1,
    { label: 'units' }, ...UNITS.flatMap((u) => Array.from({ length: 5 }, (_, i) => Number((u >> BigInt(8 * i)) & 0xffn))),
  ];
  const labels: Record<string, number> = {};
  const steps: Asm[] = [
    0xa5, 0xcf, ...abs(0x20, 0xd6a0),
    0x9a, 0xbd, 0x9f, 0xbd, 0xc7, 0xbd, 0xcf, 0xbd, 0x18, 0xba, { word: 'show' }, 0x18, 0xba, 0xe4, 0xbd,
    { label: 'show' },
    0xe6, 0xcf, //                                 INC $CF
    0xa9, lo(MSG), 0x85, 0x7a, 0xa9, hi(MSG), 0x85, 0x7b, // ($7A) = the time message
    ...abs(0x20, PRINT_RAM),
    0xa9, 0x58, 0x85, 0x88, 0xa9, 0x02, 0x85, 0x89, // wait 600 frames (Ladd's message: $3FC)
    0x60,
    ...data,
  ];
  const stepCode = assemble(STEPS, steps, labels);
  const code = assemble(CONVERT, convert, labels);
  if (code.length > 0x100) throw new Error(`timer: conversion code too big (${code.length})`);
  expect(rom, off(0x01, CONVERT), new Array(code.length).fill(0xff), 'free space 01:$9F00');
  rom.set(code, off(0x01, CONVERT));

  // --- display: scene 3's step table (1:$BD89: LDA $CF / JSR $D6A0 / steps) gets a step after Ladd's message and
  // its wait: print the time, then wait again ---
  const SCENE3 = 0xbd89;
  expect(rom, off(0x01, SCENE3), [0xa5, 0xcf, 0x20, 0xa0, 0xd6, 0x9a, 0xbd, 0x9f, 0xbd, 0xc7, 0xbd, 0xcf, 0xbd, 0x18, 0xba, 0xe4, 0xbd], 'ending scene 3 steps');
  rom.set([...abs(0x4c, STEPS)], off(0x01, SCENE3));
  expect(rom, off(0x01, STEPS), new Array(stepCode.length).fill(0xff), 'free space 01:$BF00');
  rom.set(stepCode, off(0x01, STEPS));
  if (STEPS + stepCode.length > PRINT_RAM) throw new Error('timer: ending step code overlaps the print call');
  expect(rom, off(0x01, PRINT_RAM), new Array(5).fill(0xff), 'free space 01:$BFBB');
  rom.set([0xa9, 0x0b, ...abs(0x20, 0xdcaa)], off(0x01, PRINT_RAM)); // LDA #$0B / JSR $DCAA
  expect(rom, off(0x0b, PRINT_RAM + 5), new Array(3).fill(0xff), 'free space 0B:$BFC0');
  rom.set(abs(0x4c, 0xe0ae), off(0x0b, PRINT_RAM + 5)); //    (in bank 0B) JMP $E0AE

  // (the final screen shows the time among finalscreen.ts's lines: the timer is never on in a fully vanilla seed)
}
