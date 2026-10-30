// The final scene's dialogue as any number of lines, each with its own speaker (bosses.ts ENDINGS).
//
// Vanilla: talk script 8 (0D:$A3D7, Killt) shows messages $C8 then $5C, and script 9 (0D:$A3EC, Master-D) $CA then
// $66; each is a step list indexed by $CE, called by the talk mode (0D:$A27F) whenever no message is printing ($74 = 0),
// and ends with INC $CD. Killt dies and Master-D rises between the two scripts. Here one routine, in script 8's place
// (both dispatch entries point at it), prints extra texts (no message numbers; text.ts writeMessages) from a table of
// their addresses, so Ladd can speak in between. The table sits in bank 0B with the text: a hop maps bank 0B, reads
// the line's address and enters the message printer past its pointer fetch (0F:$E0AE), as roomtalk.ts does.
//
// The cockpit scene after the chopper is script 5 (0D:$A303, started by the cockpit object, type $44, at 0E:$B25C):
// step 0 sets it up, then messages $CE (Ladd: "YOUR NUMBER'S UP! MONSTER!"), $D0 (Master-D: "AH***!") and four blank
// ones whose headers drive the ending ($84, $98, $DA, $AA), then its end ($A34F), then INC $CD ($A2AE). Its step
// table (0D:$A32B) becomes a dispatcher over the same line table: step 0, the cockpit lines and the four blank
// messages (their pointers, read from the table), the end. The script flashes the screen while $CE < 7 (0D:$A307);
// that moves to the new end.
//
// The radio after the escape (0D:$9297, steps by $CF): step 2 ends by printing HQ's #128 ($92CE `INC $CF / LDY #$FC /
// JMP $D730`), step 3 waits for it ($74 = 0) and prints the officer's #129, step 4 waits and ends (INC $CD, $CE = $CF =
// 0). Here step 2 ends by setting $CE to the radio's first line (nothing else in the scene uses it), and step 3 prints
// the radio's lines from the same table, one each time no message is printing ($CE counts them), then ends.

import { assemble } from './asm.ts';

const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const off0D = (cpu: number) => 0x10 + 0x0d * 0x4000 + cpu - 0x8000;
const DISPATCH = 0xa28d; // 0D: talk script entries (script n at + 2n)
const SCRIPTS = 0xa3d7; // 0D: scripts 8 and 9 ($A3D7-$A400), replaced
const VANILLA_SCRIPTS = [
  0xa5, 0xce, 0x20, 0xa0, 0xd6, 0xe2, 0xa3, 0xe7, 0xa3, 0xae, 0xa2, 0xa0, 0xc8, 0x4c, 0xfd, 0xa2, 0xa0, 0x5c, 0x4c, 0xfd, 0xa2,
  0xa5, 0xce, 0x20, 0xa0, 0xd6, 0xf7, 0xa3, 0xfc, 0xa3, 0xae, 0xa2, 0xa0, 0xca, 0x4c, 0xfd, 0xa2, 0xa0, 0x66, 0x4c, 0xfd, 0xa2,
];
const COCKPIT = 0xa32b; // 0D: script 5's LDA $CE / JSR $D6A0 and step table ($A32B-$A341), replaced
const VANILLA_COCKPIT = [0xa5, 0xce, 0x20, 0xa0, 0xd6, 0x42, 0xa3, 0x59, 0xa3, 0x5d, 0xa3, 0x61, 0xa3, 0x65, 0xa3, 0x69, 0xa3, 0x6d, 0xa3, 0x4f, 0xa3, 0xae, 0xa2];
const FLASH = 0xa307; // 0D: CMP #7 (flash while $CE < 7)
/** The cockpit scene's blank messages that drive the ending (message Y), shown after its lines. */
const COCKPIT_TAIL = [0x84, 0x98, 0xda, 0xaa];
const RADIO_STEPS = 0x929c; // 0D: the radio scene's step table (steps 0-5)
const RADIO = 0x92ce; // 0D: step 2's tail and steps 3-4 ($92CE-$92EF), replaced
const VANILLA_RADIO = [
  0xe6, 0xcf, 0xa0, 0xfc, 0x4c, 0x30, 0xd7, 0x60, 0xa5, 0x74, 0xd0, 0xfb, 0xe6, 0xcf, 0xa0, 0xfe, 0x4c, 0x30, 0xd7,
  0xa5, 0x74, 0xd0, 0xf0, 0xe6, 0xcf, 0xe6, 0xcd, 0xa9, 0x00, 0x85, 0xce, 0x85, 0xcf, 0x60,
];
const HOP = 0xbfe4; // 0D free ($00 fill $BFE4-$BFF7): LDA #$0B / JSR $DCAA returns into bank 0B at $BFE9
const HOP_0B = HOP + 5; // 0B free ($00 fill $BFE4-$BFF9)

/** Speakers' message headers (box style 0, as the vanilla final scene): Killt $0A, Master-D $0E, Ladd $03, Hal $06 (his line in the chopper room, $CC). */
export const SPEAKER = { killt: 0x0a, masterD: 0x0e, ladd: 0x03, hal: 0x06 } as const;

/** Bytes the line table needs in bank 0B (reserve them with writeMessages), for this many new lines. */
export const endingTableSize = (lines: number) => 2 * (lines + COCKPIT_TAIL.length);

/**
 * Print `killt` (script 8: up to Killt's death), then `masterD` (script 9), `cockpit` (script 5, after the
 * chopper) and `radio` (after the escape; none: vanilla's): bank 0B addresses of extra texts. `table` is the bank 0B space reserved for their addresses
 * (endingTableSize). Call after writeMessages (the cockpit's blank messages are read from the pointer table).
 */
export function applyEndingScript(rom: Uint8Array, killt: number[], masterD: number[], cockpit: number[], radio: number[], table: number) {
  if (!killt.length || !masterD.length) throw new Error('ending: each script needs a line');
  const tail = COCKPIT_TAIL.map((y) => rom[off0B(0x8004 + y)] | (rom[off0B(0x8005 + y)] << 8));
  const lines = [...killt, ...masterD, ...cockpit, ...tail, ...radio];
  if (lines.length > 127) throw new Error('ending: too many lines');
  if (cockpit.length + COCKPIT_TAIL.length + 1 > 0x7f) throw new Error('ending: too many cockpit lines');
  if (!VANILLA_SCRIPTS.every((b, i) => rom[off0D(SCRIPTS) + i] === b)) throw new Error('ending: unexpected talk scripts 8 and 9');
  const free = (o: number, n: number) => rom.subarray(o, o + n).every((b) => b === 0x00 || b === 0xff); // (EPROM fill)
  if (!free(off0D(HOP), 5) || !free(off0B(HOP_0B), 13)) throw new Error('ending: 0D/0B:$BFE4 not free');
  // 0D: X = the line (script 8: $CE; script 9: past script 8's), or the script is over
  const code = assemble(SCRIPTS, [
    0xa5, 0xce, 0xa6, 0x88, 0xe0, 0x09, //  LDA $CE / LDX $88 / CPX #9
    { rel: 0xf0, to: 's9' }, //             BEQ s9
    0xc9, killt.length, { rel: 0xb0, to: 'done' }, { rel: 0x90, to: 'go' }, // CMP #n8 / BCS done / BCC go
    { label: 's9' }, 0xc9, masterD.length, { rel: 0xb0, to: 'done' }, // CMP #n9 / BCS done
    0x69, killt.length, //                  ADC #n8 (C clear)
    { label: 'go' }, 0xaa, 0xe6, 0xce, //   TAX / INC $CE
    0x4c, HOP & 0xff, HOP >> 8, //          JMP hop
    { label: 'done' }, 0xe6, 0xcd, 0x60, // INC $CD / RTS (the script is over)
  ]);
  if (code.length > VANILLA_SCRIPTS.length) throw new Error('ending: script code too big');
  rom.fill(0xff, off0D(SCRIPTS), off0D(SCRIPTS) + VANILLA_SCRIPTS.length);
  rom.set(code, off0D(SCRIPTS));
  rom.set([0xa9, 0x0b, 0x20, 0xaa, 0xdc], off0D(HOP)); // LDA #$0B / JSR $DCAA (X survives)
  const lo = table, hi = table + lines.length;
  rom.set([
    0xbd, lo & 0xff, lo >> 8, 0x85, 0x7a, //  LDA lo,X / STA $7A
    0xbd, hi & 0xff, hi >> 8, 0x85, 0x7b, //  LDA hi,X / STA $7B
    0x4c, 0xae, 0xe0, //                      JMP $E0AE (print from ($7A); returns to the talk mode's caller)
  ], off0B(HOP_0B));
  rom.set([...lines.map((a) => a & 0xff), ...lines.map((a) => a >> 8)], off0B(table));
  // 0D: the cockpit (script 5): X = its line past scripts 8 and 9's
  if (!VANILLA_COCKPIT.every((b, i) => rom[off0D(COCKPIT) + i] === b) || rom[off0D(FLASH)] !== 0xc9 || rom[off0D(FLASH) + 1] !== 7) {
    throw new Error('ending: unexpected cockpit script');
  }
  const n5 = cockpit.length + tail.length, base = killt.length + masterD.length;
  const cock = assemble(COCKPIT, [
    0xa5, 0xce, { rel: 0xf0, to: 'step0' }, //      LDA $CE / BEQ step 0 ($A342)
    0xc9, n5 + 1, { rel: 0xf0, to: 'end' }, //      CMP #n+1 / BEQ end ($A34F)
    { rel: 0xb0, to: 'over' }, //                   BCS over
    0x69, base - 1, 0xaa, 0xe6, 0xce, //            ADC #base-1 (C clear) / TAX / INC $CE
    0x4c, HOP & 0xff, HOP >> 8, //                  JMP hop
    { label: 'over' }, 0x4c, 0xae, 0xa2, //         over: JMP $A2AE (INC $CD / RTS: the script is over)
  ], { step0: 0xa342, end: 0xa34f });
  if (cock.length > VANILLA_COCKPIT.length) throw new Error('ending: cockpit code too big');
  rom.set(cock, off0D(COCKPIT));
  rom[off0D(FLASH) + 1] = n5 + 1; // (flash through the last message)
  for (const i of [0, 1]) rom.set([SCRIPTS & 0xff, SCRIPTS >> 8], off0D(DISPATCH + 2 * (8 + i)));
  if (radio.length) applyRadio(rom, radio.length, lines.length - radio.length);
}

/** The radio after the escape: `n` lines from the line table, from index `base`. */
function applyRadio(rom: Uint8Array, n: number, base: number) {
  if (!VANILLA_RADIO.every((b, i) => rom[off0D(RADIO) + i] === b)) throw new Error('ending: unexpected escape radio');
  if (base + n > 0xff) throw new Error('ending: too many lines');
  // (the RTS at $92D5 stays: step 2 branches to it)
  const code = assemble(RADIO, [
    0xe6, 0xcf, 0xa9, base, 0x85, 0xce, //  (step 2's tail) INC $CF / LDA #base / STA $CE (the line)
    0xea, { label: 'rts' }, 0x60, //        NOP / RTS
    { label: 'step3' }, 0xa5, 0x74, { rel: 0xd0, to: 'rts' }, // LDA $74 / BNE rts (a message is printing)
    0xa6, 0xce, 0xe0, base + n, { rel: 0xb0, to: 'done' }, // LDX $CE / CPX #base+n / BCS done
    0xe6, 0xce, 0x4c, HOP & 0xff, HOP >> 8, // INC $CE / JMP hop (print line X)
    { label: 'done' }, 0xe6, 0xcd, 0xa9, 0x00, 0x85, 0xce, 0x85, 0xcf, 0x60, // INC $CD / LDA #0 / STA $CE / STA $CF / RTS
  ]);
  if (code.length > VANILLA_RADIO.length) throw new Error('ending: radio code too big');
  rom.fill(0xff, off0D(RADIO), off0D(RADIO) + VANILLA_RADIO.length);
  rom.set(code, off0D(RADIO));
  const step3 = RADIO + 8;
  if (step3 !== 0x92d6) throw new Error('ending: radio step 3 moved');
  for (const i of [3, 4, 5]) rom.set([step3 & 0xff, step3 >> 8], off0D(RADIO_STEPS + 2 * i));
}
