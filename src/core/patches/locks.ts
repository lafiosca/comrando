import { assemble } from '../asm.ts';
import { doorPanels, PANEL_BANK } from '../doorpanels.ts';
import { expect } from './rom.ts';

// Door locks opened by communicating (and Area 12's boss), and the comm-room flags that open them.

/**
 * Area 12 Door Locks (option; docs/rom-notes.md#area-12): locks on Area 12's inner doors. Its towers: $5E (door 1:
 * power system 1, room $58) and $5F (door 1: the boss room $21, an officer and no core, skippable in vanilla; door 2:
 * power system 2, $59). Its comm rooms: $35 (off the start room $0B; message Y = $BC) and $36 (off the hub $64; $C2).
 * - `comms`: COMMUNICATE with Area 12's comm in $35 sets per-visit flag $04C8 (opens power system 1), in $36 $04C9
 *   (power system 2).
 * - `boss`: beating the officer in $21 sets BOSS_21 (opens power system 2).
 * - `both`: $35 opens power system 1, $36 the boss room, the officer power system 2.
 * Mechanics:
 * - Comm flags (unused per-visit bytes, cleared on map entry; the Destroyers' talk writes $04C8 in NZ18 only): rows
 *   for commFlagSetter (area12FlagRows).
 * - Boss flag: a boss's death ends at 0E:$8A7A `INC $40 / JMP $D6CA` (the room's event count); that jumps to 0E:$BF28
 *   (free zero fill after trueDark's table), which also sets BOSS_21 in room $21. It persists through deaths (the
 *   stack-page gap); a new game clears it.
 * - Door locks: rows for applyDoorLocks (area12LockRows).
 * Resuming Area 12 starts past all of it (room $60).
 */
const A12_FLAG1 = 0x04c8, A12_FLAG2 = 0x04c9;
export const BOSS_21 = 0x01dd; // (stack-page gap $01DD-$01E8: traced unused; the timer has $01CE and $01D5-$01D7, the CHR loader $01D8-$01DC)
export function area12CommLock(rom: Uint8Array, mode: 'comms' | 'boss' | 'both') {
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  const HOOK = 0xbf28; // 0E
  const boss = mode !== 'comms';
  if (boss) {
    expect(rom, off(0x0e, 0x8a7a), [0xe6, 0x40, 0x4c, 0xca, 0xd6], 'boss death end');
    expect(rom, off(0x0e, HOOK), new Array(16).fill(0x00), 'free space 0E:$BF28');
    rom.set([
      0xa5, 0x4c, 0xc9, 0x21, 0xd0, 0x03, //               LDA $4C / CMP #$21 / BNE +3
      0x8d, BOSS_21 & 0xff, BOSS_21 >> 8, //                 STA boss (A = $21: set)
      0xe6, 0x40, 0x4c, 0xca, 0xd6, //                      INC $40 / JMP $D6CA (as before)
    ], off(0x0e, HOOK));
    rom.set([0x4c, HOOK & 0xff, HOOK >> 8, 0xea, 0xea], off(0x0e, 0x8a7a));
  }
}

/** Area 12's comm flags (commFlagSetter): message id → flag. */
export const area12FlagRows = (mode: 'comms' | 'boss' | 'both'): [number, number][] => (mode === 'boss' ? [] : [[0xbc, A12_FLAG1], [0xc2, A12_FLAG2]]);

/** Area 12's lock rows (applyDoorLocks): tower $5E's door 1 (power system 1) and tower $5F's doors. */
export function area12LockRows(mode: 'comms' | 'boss' | 'both'): LockRow[] {
  return [
    ...(mode !== 'boss' ? [{ room: 0x5e, door: 0x2b, flag: A12_FLAG1 }] : []),
    ...(mode === 'both' ? [{ room: 0x5f, door: 0x2b, flag: A12_FLAG2 }] : []),
    { room: 0x5f, door: 0x2c, flag: mode === 'comms' ? A12_FLAG2 : BOSS_21 },
  ];
}

/** A door lock: in room `room`, the door of object type `door` ($2A + door index) stays locked while `flag` is 0. */
export interface LockRow { room: number; door: number; flag: number }
const DOOR_FLAG1 = 0x04bf, DOOR_FLAG2 = 0x04c0;
/** 0C (free $FF fill $B710-$B8FF, after the new-game routine): the door locks' code (applyDoorLocks), then the turrets'. */
export const DOOR_CODE = 0xb710, TURRET_CODE = 0xb7c0; // the vanilla per-visit comm-door flags (cleared on map entry)
/** The vanilla locks: O1's door to $47, O4's boss door, O8's (complex $53) boss door. */
const VANILLA_LOCKS: LockRow[] = [
  { room: 0x00, door: 0x2b, flag: DOOR_FLAG1 }, { room: 0x03, door: 0x2b, flag: DOOR_FLAG1 },
  { room: 0x53, door: 0x2b, flag: DOOR_FLAG1 }, { room: 0x53, door: 0x2b, flag: DOOR_FLAG2 },
];
/** Layouts option "Comm Locks" can lock, each layout's boss door: its room, door and comm rooms' messages (in
 * the order met: the first sets $04BF, a second $04C0). Every other layout with a comm room is locked already (O1, O4,
 * O8) or has its own option (O12); O6 has none, O7's is cut (no door leads there). Not O11: its
 * level ($0A) has 2 BG tile groups its 8 × 8 map rows leave free, one more by its one duplicate pair, and a sealed panel
 * takes 4 (doorpanels.ts); a locked door drawn open is out. */
export const COMM_LOCKS: Record<number, { room: number; door: number; ys: number[] }> = {
  2: { room: 0x48, door: 0x2c, ys: [0x50] }, // $48: door 2 (boss), comm room $2A behind door 1
  3: { room: 0x49, door: 0x2c, ys: [0x68] }, // $49: door 2, comm room $32 behind door 1
  5: { room: 0x4b, door: 0x2a, ys: [0x3a, 0x3e] }, // $4B (after comm rooms $2C, $2D): door 0
  9: { room: 0x08, door: 0x2b, ys: [0x88] }, // the level: door 1, comm room $2F behind door 0
  10: { room: 0x09, door: 0x2b, ys: [0xb0] },
};
export const EXTRA_COMM_LOCKS = Object.keys(COMM_LOCKS).map(Number);

/** The lock rows of option "Comm Locks" for `layouts` (COMM_LOCKS keys). */
export const commLockRows = (layouts: readonly number[]): LockRow[] =>
  layouts.flatMap((n) => COMM_LOCKS[n].ys.map((_, i) => ({ room: COMM_LOCKS[n].room, door: COMM_LOCKS[n].door, flag: i ? DOOR_FLAG2 : DOOR_FLAG1 })));


/**
 * Door locks, table-driven (docs/rom-notes.md#door-locks). Bank 0E is full, so the door's state 0 (0E:$A7B6-$A802:
 * its setup, then the hardcoded checks for rooms $00, $03, $53) becomes a far call like the turrets'
 * (destructibleTurrets): when the PPU queue is idle (else it retries next frame), `INC $32` (the NMI uploads the
 * palette instead of the queue this frame, so the copy can't reach the PPU), 0F:$E65C copies a trampoline from bank
 * 0C into the queue buffer and `JMP $03FB` maps bank 0C (`$65` kept right) and runs `main` there.
 * - State 0: the setup as before, then rows of (room, door type, flag address): a door whose row's flag is 0 locks
 *   (state 2, its panel in `$066D,X` (index · 4), step `$065A,X` = 0). `rows` come after the vanilla ones.
 * - State 2 (locked; vanilla: nothing): the sealed door is drawn in the background (doorpanels.ts: each locked
 *   doorway has its own four BG tile groups, loaded open): one step per frame, a 64-byte block of the closed panel
 *   (bank 02, through 0F:$E65C) to the next group, the PPU address set before the NMI can use the queue (`$32` = 1
 *   again: the NMI runs the queue before the palette). After 4 steps it does nothing. The emblem sprite (0A:$AC2B)
 *   flickered and its tiles clashed with enemies' (O9's soldiers: playtest); no lock draws it now.
 * Other code entering the old region: type $5E's state 0 is $A7B6 (as the door's: a JMP to the stub), and the boss
 * rooms' exit object (type $2E, 0E:$A834) sets door 0 and jumps to $A7BF, which stays "state 1, no lock"
 * (INC $0647,X / RTS); its index stays 0 (playtest: through the stub it became 4, and leaving power system
 * 1 came out of tower $5F's door 2).
 */
export function applyDoorLocks(rom: Uint8Array, rows: LockRow[]) {
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  const STUB = 0xa7b6, STUB_END = 0xa803, STATES = 0xa7b0, TRAMP = DOOR_CODE;
  const all = [...VANILLA_LOCKS, ...rows];
  expect(rom, off(0x0e, STATES), [0xb6, 0xa7, 0x03, 0xa8, 0xd1, 0xa7], 'door states');
  expect(rom, off(0x0e, STUB), [0x38, 0xbd, 0x49, 0x05, 0xe9, 0x2a, 0x9d, 0x80, 0x06, 0xfe, 0x47, 0x06,
    0xbc, 0x49, 0x05, 0xa5, 0x4c, 0xf0, 0x09, 0xc9, 0x03, 0xf0, 0x1d, 0xc9, 0x53, 0xf0, 0x23, 0x60], 'door setup and lock check');
  const { panels, data } = doorPanels(rom, all);
  const panelOf = (r: LockRow) => panels.findIndex((p) => p.room === r.room && p.door === r.door);
  const UPLOAD = 0xbf68, UPLOAD_END = 0xbfe0, labels: Record<string, number> = {};
  const code = assemble(TRAMP, [
    0xa9, 0x0c, 0x20, 0xbe, 0xdc, { abs: 0x4c, to: 'main' }, //   (copied to $03FB) LDA #$0C / JSR $DCBE / JMP main
    { label: 'main' }, 0xa9, 0x00, 0x8d, 0xfa, 0x03, //           LDA #0 / STA $03FA: cancel the copy
    0xbd, 0x47, 0x06, 0xf0, 0x03, 0x4c, UPLOAD & 0xff, UPLOAD >> 8, // LDA $0647,X / BEQ +3 / JMP upload (state 2)
    0x38, 0xbd, 0x49, 0x05, 0xe9, 0x2a, 0x9d, 0x80, 0x06, 0xfe, 0x47, 0x06, // the setup (as before): $0680 = door index, state 1
    0xa0, all.length - 1, //                                      LDY #last row
    { label: 'loop' }, { abs: 0xb9, to: 'rooms' }, 0xc5, 0x4c, { rel: 0xd0, to: 'next' }, // LDA rooms,Y / CMP $4C / BNE
    { abs: 0xb9, to: 'doors' }, 0xdd, 0x49, 0x05, { rel: 0xd0, to: 'next' }, //             LDA doors,Y / CMP $0549,X / BNE
    { abs: 0xb9, to: 'lo' }, 0x85, 0x17, { abs: 0xb9, to: 'hi' }, 0x85, 0x18, //             ($17) = the flag
    0x84, 0x19, 0xa0, 0x00, 0xb1, 0x17, { rel: 0xf0, to: 'lock' }, 0xa4, 0x19, // STY $19 / LDY #0 / LDA ($17),Y / BEQ lock / LDY $19
    { label: 'next' }, 0x88, { rel: 0x10, to: 'loop' }, //        DEY / BPL loop
    { label: 'back' }, 0xa9, 0x0e, 0x4c, 0xbe, 0xdc, //           LDA #$0E / JMP $DCBE
    { label: 'lock' }, 0xfe, 0x47, 0x06, 0xa4, 0x19, //           INC $0647,X (state 2) / LDY $19
    { abs: 0xb9, to: 'panel4' }, 0x9d, 0x6d, 0x06, //            LDA panel4,Y / STA $066D,X
    0xa9, 0x00, 0x9d, 0x5a, 0x06, { rel: 0xf0, to: 'back' }, //   LDA #0 / STA $065A,X / BEQ back
    { label: 'rooms' }, ...all.map((r) => r.room), { label: 'doors' }, ...all.map((r) => r.door),
    { label: 'lo' }, ...all.map((r) => r.flag & 0xff), { label: 'hi' }, ...all.map((r) => r.flag >> 8),
    { label: 'panel4' }, ...all.map((r) => 4 * panelOf(r)),
    { label: 'srcLo' }, ...data.map((a) => (a - 1) & 0xff), { label: 'srcHi' }, ...data.map((a) => (a - 1) >> 8),
  ], labels);
  if (TRAMP + code.length > TURRET_CODE) throw new Error('door locks: code too big');
  expect(rom, off(0x0c, TRAMP), new Array(code.length).fill(0xff), 'free space 0C:$B710');
  rom.set(code, off(0x0c, TRAMP));
  // the panel upload and its groups, in 0C's zero fill at $BF68 (the blocks' addresses with the rows)
  const upload = assemble(UPLOAD, [
    0xbd, 0x6d, 0x06, 0x18, 0x7d, 0x5a, 0x06, 0xa8, //            LDA $066D,X / CLC / ADC $065A,X / TAY
    { abs: 0xb9, to: 'groups' }, 0x85, 0x19, //                   LDA groups,Y / STA $19
    0xbc, 0x5a, 0x06, 0xb9, labels.srcLo & 0xff, labels.srcLo >> 8, 0x85, 0x17, 0xb9, labels.srcHi & 0xff, labels.srcHi >> 8, 0x85, 0x18, // LDY $065A,X / ($17) = block - 1
    0xa9, 0x01, 0x85, 0x32, //                                    LDA #1 / STA $32
    0xa9, PANEL_BANK, 0xa0, 0x00, 0x20, 0x5c, 0xe6, //            LDA #bank / LDY #0 / JSR $E65C
    0xa5, 0x19, 0x4a, 0x4a, 0x09, 0x10, 0x8d, 0xf8, 0x03, //      LDA $19 / LSR / LSR / ORA #$10 / STA $03F8
    0xa5, 0x19, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x0a, 0x8d, 0xf9, 0x03, // LDA $19 / ASL x6 / STA $03F9
    0xfe, 0x5a, 0x06, //                                          INC $065A,X
    0xa9, 0x0e, 0x4c, 0xbe, 0xdc, //                              LDA #$0E / JMP $DCBE
    { label: 'groups' }, ...panels.flatMap((p) => p.groups),
  ]);
  if (UPLOAD + upload.length > UPLOAD_END) throw new Error(`door locks: panel tables too big (${upload.length})`);
  expect(rom, off(0x0c, UPLOAD), new Array(upload.length).fill(0x00), 'free space 0C:$BF68');
  rom.set(upload, off(0x0c, UPLOAD));
  const src = TRAMP - 1;
  // the stub at $A7C3, reached by a JMP at $A7B6 (the door's state 0, and type $5E's); $A7BF keeps vanilla's meaning
  // for the boss rooms' exit object (type $2E: `STA $0680,X` (door 0) / `JMP $A7BF`): state 1, no lock
  const ENTRY = 0xa7b6, EXIT_ENTRY = 0xa7bf, STUB_AT = 0xa7c3;
  const stub = assemble(STUB_AT, [
    { label: 'locked' }, 0xbd, 0x5a, 0x06, 0xc9, 0x04, { rel: 0xb0, to: 'rts' }, // (state 2) LDA $065A,X / CMP #4 / BCS rts
    { label: 'call' }, 0xad, 0xfa, 0x03, { rel: 0xd0, to: 'rts' }, // LDA $03FA / BNE rts (the queue is busy: next frame)
    0xe6, 0x32, //                                               INC $32 (this frame's NMI: the palette, not the queue)
    0xa9, src & 0xff, 0x85, 0x17, 0xa9, src >> 8, 0x85, 0x18, // the trampoline's address - 1
    0xa9, 0x0c, 0xa0, 0xa7, 0x20, 0x5c, 0xe6, //                 LDA #$0C / LDY #$A7 / JSR $E65C
    0x4c, 0xfb, 0x03, //                                         JMP $03FB
    { label: 'rts' }, 0x60,
  ]);
  if (STUB_AT + stub.length > STUB_END) throw new Error('door locks: stub too big');
  rom.fill(0xea, off(0x0e, STUB), off(0x0e, STUB_END));
  const call = STUB_AT + 7;
  rom.set([0x4c, call & 0xff, call >> 8], off(0x0e, ENTRY)); //   JMP stub (state 0)
  rom.set([0xfe, 0x47, 0x06, 0x60], off(0x0e, EXIT_ENTRY)); //       INC $0647,X / RTS
  rom.set(stub, off(0x0e, STUB_AT));
  rom.set([STUB_AT & 0xff, STUB_AT >> 8], off(0x0e, STATES + 4)); // state 2: the panel's steps
}

/** The comm flags of option "Comm Locks" for `layouts` (commFlagSetter): message id → flag (a second room's: $04C0). */
export const commLockFlagRows = (layouts: readonly number[]): [number, number][] =>
  layouts.flatMap((n) => COMM_LOCKS[n].ys.map((y, i) => [y, i ? DOOR_FLAG2 : DOOR_FLAG1] as [number, number]));

/**
 * The comm flags, table-driven: COMMUNICATE in a comm room shows its message, and the flag setter (0B:$AFC9: Y = 1)
 * matches the message id. In place of the vanilla chain ($14 → its special path, then $2A, $2A again (a slip), $7A,
 * $7E), after the $14 test: a loop over ids → flag addresses (page 4) at 0B:$BFA4-$BFBF (free zero fill; 12 rows),
 * with `rows` after the vanilla ones; $14's path stores at the end (its `BNE` re-aimed). X is free there.
 */
export function commFlagSetter(rom: Uint8Array, rows: [number, number][]) {
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  const SITE = 0xafcd, SITE_END = 0xafe5, TABLE = 0xbfa4, TABLE_END = 0xbfc0, PATH14 = 0xafeb;
  const all: [number, number][] = [[0x2a, DOOR_FLAG1], [0x7a, DOOR_FLAG2], [0x7e, DOOR_FLAG1], ...rows];
  if (2 * all.length > TABLE_END - TABLE) throw new Error('comm flags: too many');
  if (all.some(([, f]) => f >> 8 !== 0x04)) throw new Error('comm flags: page 4 only');
  expect(rom, off(0x0b, SITE), [0xc9, 0x2a, 0xf0, 0x0c, 0xc9, 0x2a, 0xf0, 0x08, 0xc9, 0x7a, 0xf0, 0x08, 0xc9, 0x7e, 0xd0, 0x03,
    0x8c, 0xbf, 0x04, 0x60, 0x8c, 0xc0, 0x04, 0x60], 'comm flag setter');
  expect(rom, off(0x0b, PATH14), [0xd0, 0xf0], "message $14's path");
  expect(rom, off(0x0b, TABLE), new Array(TABLE_END - TABLE).fill(0x00), 'free space 0B:$BFA4');
  const ids = TABLE, flags = TABLE + all.length;
  const code = assemble(SITE, [
    0xa2, all.length - 1, //                                 LDX #n-1
    { label: 'loop' }, 0xdd, ids & 0xff, ids >> 8, { rel: 0xf0, to: 'hit' }, 0xca, { rel: 0x10, to: 'loop' }, 0x60, // CMP ids,X / BEQ / DEX / BPL / RTS
    { label: 'hit' }, 0xbd, flags & 0xff, flags >> 8, 0xaa, 0x98, 0x9d, 0x00, 0x04, 0x60, // LDA flags,X / TAX / TYA (1) / STA $0400,X / RTS
    { label: 'path14' }, 0x8c, 0xbf, 0x04, 0x60, //          ($14's path) STY $04BF / RTS
  ]);
  if (SITE + code.length !== SITE_END) throw new Error('comm flags: setter size');
  rom.set(code, off(0x0b, SITE));
  rom.set([0xd0, (SITE_END - 4 - (PATH14 + 2)) & 0xff], off(0x0b, PATH14));
  rom.set([...all.map(([y]) => y), ...all.map(([, f]) => f & 0xff)], off(0x0b, TABLE));
}
