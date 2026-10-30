// Lines a room's talk box shows without a message number (the table of 128 is full): the comedic boss lines
// (bosses.ts), Ladd's reply when such a boss dies, and the building pickups' "WE'VE OBTAINED" (pickups.ts).
// writeMessages packs them as extra texts.
//
// A hook in the talk mode (0D:$A2AA `LDY $8F / BNE print`, and its twin at $A2BF) maps bank 0B and looks the room
// ($4C) up in a table there (in space writeMessages reserves: roomLinesSize). A listed room prints its line (the printer past its pointer fetch, 0F:$E0AE, as timer.ts
// does); any other room prints message Y = $8F as before. See docs/rom-notes.md#talk-and-scripts.
// A room's second line (a pickup's, a boss's death reply) only answers talk opened with $8F = ALT_Y, not the room's
// talkers: its table entry is the room + $80, and the key looked up is the room, + $80 when $8F = ALT_Y (rooms are
// all below $80).

import { assemble } from './asm.ts';

const off0D = (cpu: number) => 0x10 + 0x0d * 0x4000 + cpu - 0x8000;
const off0B = (cpu: number) => 0x10 + 0x0b * 0x4000 + cpu - 0x8000;
const TALK = 0xa2aa; // 0D: LDY $8F / BNE $A2FD (INC $CE / JMP $D730: print) / INC $CD / RTS
const TALK2 = 0xa2bf; // 0D: LDY $8F / BNE $A2FD / INC $CD / LDY #7 / JMP $D754 (sound)
const CODE = 0xbf80; // 0D free ($00 fill $BF7F-$BFDF); bank 0B continues the trampoline at $BF85 (free $FF fill)

/** Message Y of talk that shows a room's second line (the building pickup's, pickups.ts; a boss's death reply). */
export const ALT_Y = 0xfa;

export interface RoomLine {
  room: number;
  /** The room's second line: only for talk with $8F = ALT_Y (a pickup's, a boss's death reply), not its talkers. */
  alt?: boolean;
  /** CPU address in bank 0B of the message (from writeMessages). */
  addr: number;
}

const CODE_SIZE = 38;
/** Bank 0B bytes the lookup for `n` lines needs (reserve them with writeMessages). */
export const roomLinesSize = (n: number) => (n ? CODE_SIZE + 3 * n : 0);

/** Show `lines` in their rooms' talk boxes (one line per room); the lookup goes at 0B `at` (roomLinesSize). */
export function applyRoomLines(rom: Uint8Array, lines: RoomLine[], at: number) {
  if (!lines.length) return;
  if (new Set(lines.map((l) => l.room | (l.alt ? 0x80 : 0))).size !== lines.length) throw new Error('room lines: one line per room (and one second line)');
  const n = lines.length, LOOKUP = at, ROOMS = LOOKUP + CODE_SIZE, LO = ROOMS + n, HI = LO + n;
  if (lines.some((l) => l.room >= 0x80)) throw new Error('room lines: room $80 or above');
  // 0D: trampoline (LDA #$0B / JSR $DCAA returns into bank 0B at $BF85; Y = $8F survives), then the two talk-path hooks
  const HOOK_A = CODE + 5, HOOK_B = HOOK_A + 7;
  const hooks = [
    0xa9, 0x0b, 0x20, 0xaa, 0xdc, //                trampoline
    0xa4, 0x8f, 0xd0, 0xf7, 0x4c, 0xae, 0xa2, //    A: LDY $8F / BNE trampoline / JMP $A2AE (INC $CD / RTS)
    0xa4, 0x8f, 0xd0, 0xf0, 0x4c, 0xc3, 0xa2, //    B: LDY $8F / BNE trampoline / JMP $A2C3 (INC $CD / sound)
  ];
  // 0B: find the key; none -> print message Y = $8F (INC $CE / JMP $D730, as 0D:$A2FD)
  const lookup = [
    0xa5, 0x4c, 0xc0, ALT_Y, 0xd0, 0x02, 0x09, 0x80, // LDA $4C / CPY #alt / BNE + / ORA #$80
    0xa2, n - 1, //                                 +: LDX #n-1
    0xdd, ROOMS & 0xff, ROOMS >> 8, 0xf0, 0x08, //  loop: CMP ROOMS,X / BEQ found
    0xca, 0x10, 0xf8, //                            DEX / BPL loop
    0xe6, 0xce, 0x4c, 0x30, 0xd7, //                INC $CE / JMP $D730 (Y = $8F)
    0xbd, LO & 0xff, LO >> 8, 0x85, 0x7a, //        found: LDA LO,X / STA $7A
    0xbd, HI & 0xff, HI >> 8, 0x85, 0x7b, //        LDA HI,X / STA $7B
    0xe6, 0xce, 0x4c, 0xae, 0xe0, //                INC $CE / JMP $E0AE (print from ($7A))
    ...lines.map((l) => l.room | (l.alt ? 0x80 : 0)), ...lines.map((l) => l.addr & 0xff), ...lines.map((l) => l.addr >> 8),
  ];
  if (lookup.length - 3 * n !== CODE_SIZE) throw new Error('room lines: lookup size');
  if (!rom.subarray(off0D(CODE), off0D(CODE) + hooks.length).every((b) => b === 0)) throw new Error('room lines: 0D:$BF80 not free');
  if (!rom.subarray(off0B(CODE + 5), off0B(CODE + 8)).every((b) => b === 0xff)) throw new Error('room lines: 0B:$BF85 not free');
  const sites: [number, number[], number][] = [
    [TALK, [0xa4, 0x8f, 0xd0, 0x4f, 0xe6, 0xcd, 0x60], HOOK_A],
    [TALK2, [0xa4, 0x8f, 0xd0, 0x3a, 0xe6, 0xcd, 0xa0, 0x07], HOOK_B],
  ];
  for (const [at, bytes] of sites) if (!bytes.every((b, i) => rom[off0D(at) + i] === b)) throw new Error('room lines: unexpected talk mode code');
  rom.set(hooks, off0D(CODE));
  rom.set([0x4c, LOOKUP & 0xff, LOOKUP >> 8], off0B(CODE + 5)); // (in bank 0B) JMP lookup
  rom.set(lookup, off0B(LOOKUP));
  for (const [at, , hook] of sites) rom.set([0x4c, hook & 0xff, hook >> 8, 0xea], off0D(at)); // JMP hook / NOP
}

/** Each boss room's boss (object type; type table 0E:$803A), $16-$21. */
export const BOSS_TYPE: Record<number, number> = {
  0x16: 0x6b, 0x17: 0x6b, 0x18: 0x03, 0x19: 0x67, 0x1a: 0x5a, 0x1b: 0x5a, 0x1c: 0x6b, 0x1d: 0x67, 0x1e: 0x6b, 0x1f: 0x67, 0x20: 0x6b, 0x21: 0x03,
};

/**
 * When the boss of one of `rooms` dies, its reply shows (talk with $8F = ALT_Y: the room's second line) before it goes.
 * Bosses die their own ways, each ending in `JMP $D6CA` (object gone): the commanders' type $6B through the shared hit
 * routine (0E:$817B, its death at $8156 ends at $8178), the robots' $67 through the shared death timer ($8287, ending
 * at $825B), the cyborgs' $5A at $B900 (after `DEC $0680,X / BNE`; Area 12's escape uses it too), the officers' $03
 * (Areas 4 and 12) at $8A7A `INC $40 / JMP $D6CA` (area12CommLock moves that to 0E:$BF28; `$40` is what a boss
 * room's exit waits for, nonzero). Each of those `JMP $D6CA` goes to GO instead: for a listed room's boss type, the
 * first time, it opens the talk and puts 1 back in the death timer $0680 (objects wait out the talk; the timed deaths
 * come back the next frame); the next time $8F still holds ALT_Y, so it marks it spent (LSR) and the boss goes as
 * before. The boss's death isn't the area clear (only the core starts that). The code is in four pieces of free 0E
 * (EPROM fill the other patches leave).
 */
export function talkOnBossDeath(rom: Uint8Array, rooms: number[]) {
  if (!rooms.length) return;
  if (rooms.some((r) => !BOSS_TYPE[r]) || new Set(rooms).size !== rooms.length) throw new Error('boss death: boss rooms, one reply each');
  if (rooms.length > 4) throw new Error('boss death: at most 4 replies');
  const off0E = (cpu: number) => 0x10 + 0x0e * 0x4000 + cpu - 0x8000;
  // [start, end, fill]: the tables, GO, its type check, the talk
  const TABLES = [0xbf38, 0xbf40, 0x00], GO = [0xbfe4, 0xbffa, 0x00], CHECK = [0xbf8e, 0xbfa0, 0xff], TALK = [0xbf57, 0xbf60, 0xff];
  const ROOMS = TABLES[0], TYPES = ROOMS + rooms.length;
  const sites = [0x8178, 0x825b, 0xb900, rom[off0E(0x8a7a)] === 0x4c ? 0xbf33 : 0x8a7c];
  for (const at of sites) if (![0x4c, 0xca, 0xd6].every((b, i) => rom[off0E(at) + i] === b)) throw new Error(`boss death: unexpected code at 0E:$${at.toString(16)}`);
  if (rom[off0E(sites[3] - 2)] !== 0xe6 || rom[off0E(sites[3] - 1)] !== 0x40) throw new Error('boss death: unexpected officer death');
  const talk = TALK[0], go = GO[0] + 12;
  const pieces: [number[], number[]][] = [
    [TABLES, [...rooms, ...rooms.map((r) => BOSS_TYPE[r])]],
    [GO, assemble(GO[0], [
      0xa5, 0x4c, 0xa0, rooms.length - 1, //          LDA $4C / LDY #n-1
      { label: 'loop' }, 0xd9, ROOMS & 0xff, ROOMS >> 8, { rel: 0xf0, to: 'found' }, // CMP rooms,Y / BEQ found
      0x88, { rel: 0x10, to: 'loop' }, //             DEY / BPL loop
      0x4c, 0xca, 0xd6, //                            go: JMP $D6CA (as before)
      { label: 'found' }, 0xbd, 0x49, 0x05, 0x4c, CHECK[0] & 0xff, CHECK[0] >> 8, // LDA $0549,X / JMP check
    ])],
    [CHECK, assemble(CHECK[0], [
      0xd9, TYPES & 0xff, TYPES >> 8, { rel: 0xd0, to: 'go' }, // CMP types,Y / BNE go (not the boss)
      0xa5, 0x8f, 0xc9, ALT_Y, { rel: 0xd0, to: 'talk' }, // LDA $8F / CMP #alt / BNE talk
      0x46, 0x8f, { rel: 0x90, to: 'go' }, //         LSR $8F (the talk is over: spent; C = 0) / BCC go
    ], { go, talk })],
    [TALK, [
      0xfe, 0x80, 0x06, //                            INC $0680,X (0 -> 1: back here after the talk)
      0xa9, ALT_Y, 0x4c, 0x8a, 0xd7, //               LDA #alt / JMP $D78A (talk mode, message Y = A)
    ]],
  ];
  for (const [[start, end, fill], code] of pieces) {
    if (start + code.length > end) throw new Error(`boss death: too big at 0E:$${start.toString(16)}`);
    for (let a = start; a < end; a++) if (rom[off0E(a)] !== fill) throw new Error(`boss death: 0E:$${start.toString(16)} not free`);
    rom.set(code, off0E(start));
  }
  for (const at of sites) rom.set([0x4c, GO[0] & 0xff, GO[0] >> 8], off0E(at));
}
