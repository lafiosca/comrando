import { expect } from './rom.ts';

// Super Joe's placement and Area 12's entry condition.

/** RAM flag bytes in page $04 (low byte) that the Area 12 condition can require. */
export const flagAreaCleared = (node: number) => 0xea + node; // $04EA+node
/**
 * Joe rescued. Vanilla uses $04F1 (= area 7 cleared), which would be set by a normal Area 7 clear once Joe moves, so
 * the rescue sets $04F6 instead: area 12's cleared flag, which is only ever set when the game is won and is not read
 * anywhere during play.
 */
export const FLAG_JOE = flagAreaCleared(12); // $04F6

/**
 * Put Joe's rescue on area `host`'s clear (any of 1-11). Vanilla runs the rescue sequence instead of the normal clear
 * when $4D == 7 (0F:$CA0D `LDA $4D / CMP #$07`), and the sequence only sets $04F1 (0D:$930C `STA $04F1`). We point the
 * compare at `host` and replace that store with a call to 0D:$9CA0, which marks the host area cleared and sets
 * FLAG_JOE (preserving A and Y). Applied for every seed (host 7 included) so the flag is always the same.
 */
export function placeJoe(rom: Uint8Array, host: number) {
  if (host < 1 || host > 11) throw new Error(`Joe can't be rescued in area ${host}`);
  const CLEAR_DISPATCH = 0x3ca1d; // 0F:$CA0D
  const STORE = 0x3531c; // 0D:$930C
  const ROUTINE = 0x35cb0; // 0D:$9CA0
  expect(rom, CLEAR_DISPATCH, [0xa5, 0x4d, 0xc9, 0x07, 0xf0], 'Joe clear dispatch');
  expect(rom, STORE, [0x8d, 0xf1, 0x04, 0x4c, 0x1a, 0x95], 'Joe flag store');
  expect(rom, ROUTINE, new Array(17).fill(0xff), 'free space 0D:$9CA0');
  rom[CLEAR_DISPATCH + 3] = host;
  rom.set([0x20, 0xa0, 0x9c], STORE); // JSR $9CA0
  rom.set([
    0x98, 0x48, //             TYA / PHA
    0xa4, 0x4d, //             LDY $4D        (the host area)
    0xa9, 0x01, //             LDA #1
    0x99, 0xea, 0x04, //       STA $04EA,Y    host area cleared
    0x8d, FLAG_JOE, 0x04, //   STA $04F6      Joe rescued
    0x68, 0xa8, //             PLA / TAY
    0xa9, 0x01, //             LDA #1         (as before the original store)
    0x60, //                   RTS
  ], ROUTINE);
}

/**
 * Message Y for Area 12's refusal: #115 "NO.IS INCORRECT.", part of a leftover number-entry screen (#113-#115) that
 * nothing displays (docs/rom-notes.md#text-and-messages). Vanilla used $64 ("YOU DON'T HAVE ENOUGH POWER."), shared with the
 * road gates. (Not #69: that's the escape cyborg's line, shown via LDA #$86 / JSR $D78A at 0E:$B74B.)
 */
export const AREA12_REFUSAL_Y = 0xe2;

/**
 * Area 12's descent check (0D:$A4E7) originally needs $04F4 and $04F5 (areas 10, 11 cleared). Replace the two loads
 * with a call to a small routine in free space (0D:$9C40) that requires every flag in a list.
 */
export function setArea12Condition(rom: Uint8Array, flags: number[]) {
  if (!flags.length || flags.length > 16) throw new Error('area 12 condition: 1-16 flags');
  const CALL_SITE = 0x364fd; // 0D:$A4ED
  const ROUTINE = 0x35c50; // 0D:$9C40 (free $FF space 0D:$9C1F-$9CFF)
  expect(rom, CALL_SITE, [0xad, 0xf4, 0x04, 0xf0, 0x28, 0xad, 0xf5, 0x04, 0xf0, 0x23], 'area 12 check');
  expect(rom, ROUTINE, new Array(0x20 + 17).fill(0xff), 'free space 0D:$9C40');
  // JSR $9C40 ; BEQ $A51A (refuse) ; NOP x5
  rom.set([0x20, 0x40, 0x9c, 0xf0, 0x28, 0xea, 0xea, 0xea, 0xea, 0xea], CALL_SITE);
  // $9C40: preserve X, check each $04xx flag in the table at $9C60 (0-terminated); return with Y=$4D (the caller's
  // node) and A=1 (all set) or A=0 (one missing), so the caller's BEQ refuses on failure.
  rom.set([
    0x8a, //             TXA
    0x48, //             PHA
    0xa2, 0x00, //       LDX #0
    0xbd, 0x60, 0x9c, // loop: LDA $9C60,X
    0xf0, 0x09, //       BEQ ok
    0xa8, //             TAY
    0xb9, 0x00, 0x04, // LDA $0400,Y
    0xf0, 0x0a, //       BEQ fail
    0xe8, //             INX
    0xd0, 0xf2, //       BNE loop
    0x68, 0xaa, 0xa4, 0x4d, 0xa9, 0x01, 0x60, // ok:   PLA TAX LDY $4D LDA #1 RTS
    0x68, 0xaa, 0xa4, 0x4d, 0xa9, 0x00, 0x60, // fail: PLA TAX LDY $4D LDA #0 RTS
  ], ROUTINE);
  rom.set([...flags, 0x00], ROUTINE + 0x20);

  // On refusal, vanilla shows the message but leaves the map menu advanced into TRANSFER mode. Instead jump to
  // $9C80: reset the menu state ($0491 = 1) so the DESCEND/TRANSFER prompt comes back after the message.
  const REFUSE = 0x3652a; // 0D:$A51A: LDY #$64 / JMP $D730
  const REFUSE_ROUTINE = 0x35c90; // 0D:$9C80
  expect(rom, REFUSE, [0xa0, 0x64, 0x4c, 0x30, 0xd7], 'area 12 refusal');
  expect(rom, REFUSE_ROUTINE, new Array(10).fill(0xff), 'free space 0D:$9C80');
  rom.set([0x4c, 0x80, 0x9c, 0xea, 0xea], REFUSE); // JMP $9C80
  // Area 12's refusal gets its own message (#115, unused in vanilla): $64 stays with the 6<->8 road gate.
  rom.set([0xa9, 0x01, 0x8d, 0x91, 0x04, 0xa0, AREA12_REFUSAL_Y, 0x4c, 0x30, 0xd7], REFUSE_ROUTINE); // LDA #1 STA $0491 LDY #id JMP $D730
}
