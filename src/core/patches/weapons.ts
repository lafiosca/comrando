import { assemble } from '../asm.ts';
import { expect } from './rom.ts';

// Weapons in the side-scrolling areas: the Rapid-Fire Device, the Machine Gun's full auto, and which weapons break
// NZ15's barriers.

/**
 * Rapid-fire device (item 4 selected, normal gun): vanilla reads B *held* and fires only when the global frame counter
 * is a multiple of 8 (0D:$B94A `LDA $36 / AND #7 / BNE skip`), so taps fire up to 7 frames late or not at all (a 2-frame
 * tap fires 1 time in 4). Instead: a new press fires at once, and holding B repeats every 8 frames from that press
 * (counter $01D4, in the unused stack-page gap). The 3-bullet limit stays. See docs/rom-notes.md#weapons-and-fire.
 */
export function fixRapidFire(rom: Uint8Array) {
  const SITE = 0x3795a; // 0D:$B94A
  const ROUTINE = 0x35cfc; // 0D:$9CEC (free $FF space after the map markers' visit routine)
  expect(rom, SITE, [0xa5, 0x36, 0x29, 0x07, 0xd0, 0x2d], 'rapid-fire timer');
  expect(rom, ROUTINE, new Array(19).fill(0xff), 'free space 0D:$9CEC');
  rom.set([
    0xa5, 0xf8, 0x29, 0x40, 0xd0, 0x05, // LDA $F8 / AND #$40 / BNE fire   (B newly pressed)
    0xce, 0xd4, 0x01, 0xd0, 0x07, //       DEC $01D4 / BNE out             (held: not yet; Z clear)
    0xa9, 0x08, 0x8d, 0xd4, 0x01, //       fire: LDA #8 / STA $01D4
    0xa9, 0x00, 0x60, //                   LDA #0 / out: RTS               (Z set: fire)
  ], ROUTINE);
  rom.set([0x20, 0xec, 0x9c, 0xea], SITE); // JSR $9CEC / NOP; the BNE skip after it stays
}

/**
 * Full-auto Machine Gun. 0D:$B919 picks the fire button's state: B newly pressed ($F8 bit 6) for every weapon, B held
 * ($FA) for the normal gun with the Rapid-Fire Device. The Machine Gun (weapon 3) fires a 3-round burst per press, one
 * round every 8 frames: $B9E9 starts a burst only when the last one is over (`$07E9` rounds left = 0; it sets `$07EA`
 * = 0, so the first round goes at once), $B9F7 counts `$07EA` down and fires a round each time it passes 0 (then 7).
 * The 19-byte choice is rewritten as a call to a routine at free 0D:$9FAC (zero fill after the gate display's build
 * block; unread in a 250k-frame trace) that returns the state in A (Y = weapon kept; the `AND #$40` at $B92C stays).
 * For the Machine Gun: a new press starts a burst as before; B only held starts the next burst itself with `$07EA` = 7
 * (its first round 8 frames after the last, not the next frame) and returns "no press". Not while `$07EB` is set (the
 * final boss's scripted bazooka, bullet type 5 from 0D:$B930): there a held B would add machine-gun bursts to it.
 */
export function machineGunAuto(rom: Uint8Array) {
  const SITE = 0x37929; // 0D:$B919
  const ROUTINE = 0x10 + 0x0d * 0x4000 + 0x9fac - 0x8000, END = 0x10 + 0x0d * 0x4000 + 0x9fe0 - 0x8000;
  expect(rom, SITE, [0xac, 0xca, 0x04, 0xd0, 0x0c, 0xad, 0xd8, 0x04, 0xc9, 0x04, 0xd0, 0x05, 0xa5, 0xfa, 0x4c, 0x2c, 0xb9, 0xa5, 0xf8, 0x29, 0x40], 'fire button choice');
  const code = assemble(0x9fac, [
    0xc0, 0x03, { rel: 0xf0, to: 'mg' }, //               CPY #3 / BEQ mg
    0x98, { rel: 0xd0, to: 'press' }, //                  TYA / BNE press (any other weapon but the normal gun)
    0xad, 0xd8, 0x04, 0xc9, 0x04, { rel: 0xd0, to: 'press' }, // LDA $04D8 / CMP #4 / BNE press (no Rapid-Fire Device)
    0xa5, 0xfa, 0x60, //                                  LDA $FA / RTS (held)
    { label: 'press' }, 0xa5, 0xf8, 0x60, //              LDA $F8 / RTS (newly pressed)
    { label: 'mg' },
    0xa5, 0xf8, 0x29, 0x40, { rel: 0xd0, to: 'ret' }, //   LDA $F8 / AND #$40 / BNE ret (a new press: as before)
    0x24, 0xfa, { rel: 0x50, to: 'ret' }, //               BIT $FA / BVC ret (not held: A is 0, no press)
    0xad, 0xeb, 0x07, 0x0d, 0xe9, 0x07, { rel: 0xd0, to: 'no' }, // LDA $07EB / ORA $07E9 / BNE no (Hal's bazooka: its
    //                                                     shots only, playtest; or a burst going)
    0xa9, 0x03, 0x8d, 0xe9, 0x07, 0xa9, 0x07, 0x8d, 0xea, 0x07, // the next burst, its first round in 8 frames
    { label: 'no' }, 0xa9, 0x00, //                        LDA #0 (no press)
    { label: 'ret' }, 0x60,
  ]);
  if (ROUTINE + code.length > END) throw new Error('machine gun: routine too big');
  expect(rom, ROUTINE, new Array(END - ROUTINE).fill(0x00), 'free space 0D:$9FAC');
  rom.set(code, ROUTINE);
  rom.set([0xac, 0xca, 0x04, 0x20, 0xac, 0x9f, 0x4c, 0x2c, 0xb9, ...new Array(10).fill(0xea)], SITE); // LDY $04CA / JSR / JMP $B92C
}

/** Shot types (object type of a player's bullet, $0549), by weapon: fire routines at 0D:$82A2 + 2·selected weapon. */
export const SHOT_TYPE = { normal: 0, rocket: 1, wide: 2, machine: 3, threeway: 4 } as const;

/**
 * NZ15's barriers need the Machine Gun (or `type`).
 * - Vanilla bug: an alert in a neutral zone (any shot fired there) deactivates every object except a keep-list
 *   (0F:$DFF3: doors $2A/$2B, barriers $35, $64, $86, $6E, $2E), but the barrier entry's `CMP #$35` was assembled as
 *   `BRK` (0F:$E000 = $00, not $C9). BRK goes to an RTI ($C0B2), skipping the $35, so barriers aren't kept and any shot
 *   in NZ15 removes them (playtest). One byte restores the check.
 * - The barrier damage check (0F:$EC8B) is `JSR $ECB3 / BCS miss` (collision), then "room $05 (Area 6) needs shot type 1,
 *   anything else type 4". After the collision test it now jumps to 0E:$BFC0 (bank 0E is mapped for object handlers),
 *   which adds room $0E (NZ15) -> `type`.
 */
export function setBarrierWeapons(rom: Uint8Array, nz15: number) {
  const KEEP = 0x3e010; // 0F:$E000
  const CHECK = 0x3ec9b + 5; // 0F:$EC90, after JSR $ECB3 / BCS $EC72
  const ROUTINE = 0x3bfd0; // 0E:$BFC0 (free $FF space 0E:$BFC0-$BFDF)
  expect(rom, KEEP, [0x00, 0x35, 0xf0, 0x13], 'alert keep-list barrier entry');
  expect(rom, CHECK, [0xa5, 0x4c, 0xc9, 0x05, 0xf0, 0x09, 0xb9, 0x49, 0x05, 0xc9, 0x04, 0xd0, 0xeb], 'barrier damage check');
  expect(rom, ROUTINE, new Array(32).fill(0xff), 'free space 0E:$BFC0');
  rom[KEEP] = 0xc9; // CMP #$35
  rom.set([0x4c, 0xc0, 0xbf], CHECK); // JMP $BFC0
  rom.set([
    0xa5, 0x4c, //             LDA $4C
    0xc9, 0x0e, 0xf0, 0x0a, // CMP #$0E / BEQ nz15
    0xc9, 0x05, 0xf0, 0x03, // CMP #$05 / BEQ area6
    0xa9, SHOT_TYPE.threeway, 0x2c, // LDA #4 / BIT (skips the next LDA)
    0xa9, SHOT_TYPE.rocket, 0x2c, //   area6: LDA #1 / BIT
    0xa9, nz15, //             nz15: LDA #type
    0xd9, 0x49, 0x05, //       CMP $0549,Y (the shot that hit)
    0xf0, 0x03, //             BEQ hit
    0x4c, 0xea, 0xeb, //       JMP $EBEA (the shot bounces off)
    0x4c, 0xd7, 0xeb, //       hit: JMP $EBD7 (the barrier breaks)
  ], ROUTINE);
}
