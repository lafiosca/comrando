import { expect } from './rom.ts';

// Neutral-zone buildings: which door leads to which building, and who talks inside.

/** A neutral-zone building door: zone level room ($0C-$12) and door slot (0 = door A, 1 = door B). */
export interface Door {
  zone: number;
  slot: number;
}
export const BUILDING_ROOMS = Array.from({ length: 14 }, (_, i) => 0x37 + i);
/** Vanilla door for building room `b`. */
export const vanillaDoor = (b: number): Door => ({ zone: 0x0c + ((b - 0x37) >> 1), slot: (b - 0x37) & 1 });

/**
 * Put each building interior behind a door (docs/rom-notes.md#buildings). Entering uses the door table
 * 0B:$ABA3 (room*4 + slot -> destination); a building's exit is its slot 0, whose destination is the zone and whose
 * entry index (0B:$AD63) picks the spawn in front of door A (1) or B (2) — identical positions in every zone.
 */
export function setBuildingDoors(rom: Uint8Array, doors: Map<number, Door>) {
  const DOOR_TABLE = 0x2ebb3, ENTRY_TABLE = 0x2ed73;
  for (const b of BUILDING_ROOMS) {
    const v = vanillaDoor(b);
    expect(rom, DOOR_TABLE + v.zone * 4 + v.slot, [b], `door ${v.zone.toString(16)}/${v.slot}`);
    expect(rom, DOOR_TABLE + b * 4, [v.zone], `exit of room ${b.toString(16)}`);
    expect(rom, ENTRY_TABLE + b * 4, [v.slot + 1], `exit entry of room ${b.toString(16)}`);
  }
  for (const [b, d] of doors) {
    rom[DOOR_TABLE + d.zone * 4 + d.slot] = b;
    rom[DOOR_TABLE + b * 4] = d.zone;
    rom[ENTRY_TABLE + b * 4] = d.slot + 1;
  }
}

/**
 * Talkers of types $52-$54 pick their line by zone (0E:$B5E4: SEC / LDA $4D / SBC #$0D / TAY / LDA $B5FF,Y), shared
 * between outdoor door talkers and the people inside rooms $3E and $40 — so a moved room would speak its new zone's
 * line. Call 0E:$BF40 instead: inside a building ($4C >= $37) read a per-room table at $BF80; outside, the original.
 */
export function setInsideTalkersByRoom(rom: Uint8Array) {
  const SITE = 0x3b5f4; // 0E:$B5E4
  const ROUTINE = 0x3bf50; // 0E:$BF40 (free $FF space 0E:$BF40-$BF5F)
  const TABLE = 0x3bf90; // 0E:$BF80 (free $FF space 0E:$BF80-$BF9F), 14 entries for rooms $37-$44
  expect(rom, SITE, [0x38, 0xa5, 0x4d, 0xe9, 0x0d, 0xa8, 0xb9, 0xff, 0xb5], 'talker message lookup');
  expect(rom, ROUTINE, new Array(0x17).fill(0xff), 'free space 0E:$BF40');
  expect(rom, TABLE, new Array(14).fill(0xff), 'free space 0E:$BF80');
  rom.set([0x20, 0x40, 0xbf, 0xea, 0xea, 0xea, 0xea, 0xea, 0xea], SITE); // JSR $BF40
  rom.set([
    0xa5, 0x4c, //       LDA $4C
    0xc9, 0x37, //       CMP #$37
    0x90, 0x07, //       BCC zone
    0xe9, 0x37, //       SBC #$37
    0xa8, //             TAY
    0xb9, 0x80, 0xbf, // LDA $BF80,Y      inside: line by room
    0x60, //             RTS
    0x38, //             zone: SEC
    0xa5, 0x4d, //       LDA $4D
    0xe9, 0x0d, //       SBC #$0D
    0xa8, //             TAY
    0xb9, 0xff, 0xb5, // LDA $B5FF,Y      outside: original per-zone line
    0x60, //             RTS
  ], ROUTINE);
  const table = new Array(14).fill(0x00);
  table[0x3e - 0x37] = 0x4c; // room $3E: #40 "DON'T BE HASTY. ADVANCE WITH CAUTION." (vanilla NZ16)
  table[0x40 - 0x37] = 0x32; // room $40: #27 the P.O.W. camp line (vanilla NZ17)
  rom.set(table, TABLE);
}
