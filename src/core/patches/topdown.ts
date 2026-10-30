import { assemble } from '../asm.ts';
import { chrSource, PASSAGE_LIST, PASSAGE_LIST_END, setChrRecord, TRUCK_BLANK_CHR_ID, TRUCK_DROP_CHR_ID } from '../pickups.ts';
import { expect } from './rom.ts';

// The top-down stages (truck convoys, the underground passage): holding fire, enemy drops and the eagle pickup.

/** 0D space for topDownFire ($9F60 up to it: topDownDrops' arm code; from $9FAC: machineGunAuto). */
const TOPDOWN_FIRE = 0x9f78, TOPDOWN_FIRE_END = 0x9fac;

/**
 * Holding B in the top-down stages (trucks, the underground passage). Their fire code (0D:$8296 `LDA #$40 / BIT $F8 /
 * BEQ $8295`, then a jump on the weapon `$04CA`) fires on a new press only, whatever the weapon, so the side-scroll
 * fixes above don't reach it. Here, a new press fires as before, and holding B also fires:
 * - `machine`: the Machine Gun (weapon 3) starts its next 3-round burst as soon as one is over (`$07F4` rounds left = 0;
 *   its routine 0D:$8322 spaces the rounds itself);
 * - `rapid`: the normal gun with the Rapid-Fire Device selected (`$04D8` = 4) repeats every 8 frames from the press
 *   (counter `$01D4`, as fixRapidFire).
 */
export function topDownFire(rom: Uint8Array, { machine, rapid }: { machine: boolean; rapid: boolean }) {
  const SITE = 0x10 + 0x0d * 0x4000 + 0x8296 - 0x8000;
  const at = 0x10 + 0x0d * 0x4000 + TOPDOWN_FIRE - 0x8000;
  expect(rom, SITE, [0xa9, 0x40, 0x24, 0xf8, 0xf0, 0xf9], 'top-down fire button');
  const code = assemble(TOPDOWN_FIRE, [
    0xa5, 0xf8, 0x29, 0x40, { rel: 0xd0, to: 'fire' }, //  LDA $F8 / AND #$40 / BNE fire (a new press)
    0xa5, 0xfa, 0x29, 0x40, { rel: 0xf0, to: 'ret' }, //   LDA $FA / AND #$40 / BEQ ret (not held: Z set)
    0xac, 0xca, 0x04, //                                   LDY $04CA (weapon)
    ...(machine ? [
      0xc0, 0x03, { rel: 0xd0, to: 'gun' }, //             CPY #3 / BNE gun
      0xad, 0xf4, 0x07, { rel: 0xd0, to: 'no' }, //         LDA $07F4 / BNE no (a burst going)
      { rel: 0xf0, to: 'fire' }, //                         BEQ fire
    ] : []),
    { label: 'gun' },
    ...(rapid ? [
      0x98, { rel: 0xd0, to: 'no' }, //                     TYA / BNE no (not the normal gun)
      0xad, 0xd8, 0x04, 0xc9, 0x04, { rel: 0xd0, to: 'no' }, // LDA $04D8 / CMP #4 / BNE no (no Rapid-Fire Device)
      0xce, 0xd4, 0x01, { rel: 0xd0, to: 'no' }, //         DEC $01D4 / BNE no (not yet)
      { rel: 0xf0, to: 'fire' }, //                         BEQ fire
    ] : []),
    { label: 'no' }, 0xa9, 0x00, //                        LDA #0 (Z set: no shot)
    { label: 'ret' }, 0x60,
    { label: 'fire' }, 0xa9, 0x08, 0x8d, 0xd4, 0x01, 0x60, // LDA #8 / STA $01D4 / RTS (Z clear: fire)
  ]);
  if (TOPDOWN_FIRE + code.length > TOPDOWN_FIRE_END) throw new Error('top-down fire: routine too big');
  expect(rom, at, new Array(TOPDOWN_FIRE_END - TOPDOWN_FIRE).fill(0x00), 'free space 0D:$9F78');
  rom.set(code, at);
  rom.set([0x20, TOPDOWN_FIRE & 0xff, TOPDOWN_FIRE >> 8, 0xf0, 0xfa, 0xea], SITE); // JSR / BEQ $8295 / NOP
}

/**
 * Truck-stage bullet drops: enemies killed in the overhead stages (truck convoys $13/$14, the underground passage $15)
 * drop a bullet 1 time in 3, like the side-scrolling areas' drops (docs/rom-notes.md#top-down-stages).
 * - Overhead enemies die through one of two state machines (0D:$9171, no drop; 0D:$91CA, whose end at $91F2 turns the
 *   body into type $0D, the +1-continue pickup: types 7 and 9 only). Every death now takes $91CA (the five per-type
 *   state tables' `71 91` -> `CA 91`), and its end jumps to `conv`: types 7 and 9 keep their continue; anything else
 *   rolls the frame counter ($36 < $55): a bullet (type $0D with `$065A` = 1 marking the kind) or nothing.
 * - The pickup's art (0D:$8B50) and touch (0D:$9050) branch on that mark: a bullet is an 8x16 sprite of tile $FC
 *   (metasprite at free 0A:$BFD8), and touching it gives one bullet through 0F:$D7BA (counter, rank-ups).
 * - The bionic arm picks drops up too, as it sweeps enemies and their shots away: the touch test (0D:$9046
 *   `JSR $8EF1`, the object against Ladd) also tries the arm's sweep box (0D:$8F4D, against slot 4; the arm is type 5).
 * - Tiles $FC-$FD: no stage loads art there (the passage and convoy $13 never write them, convoy $14 loads them blank)
 *   and none draws them (a census of all three stages run to their end, deaths and every weapon included).
 *   Every other sprite pair is in use: $9A was the jeep explosion's, $60 Ladd's death's (it put a bullet on his head).
 *   The background table is no use either: each stage rewrites all of it after loading its sprites. Extra CHR records
 *   (pickups.ts) load the side-scroll bullet's tile (bank 8 tile 9) into $FC and a blank into $FD, appended to the three
 *   stages' sprite CHR lists: the convoy stages' in place (03:$BA62, taking the passage list's bytes; $14's needs no
 *   blank, and both fit only so), the passage's in its own space (03:$B6CA, where placePassageItem puts its list).
 */
export function topDownDrops(rom: Uint8Array, eagle: Eagles = 'vanilla') {
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  const CODE = 0x9db0, CODE_END = 0x9e00; // 0D (after the gate display's frame block)
  const ART = 0xbfd8; // 0A free ($BFA4-$BFD5: the door lock's alternate art)
  const LISTS = 0xba62; // 03: the stages' lists (40 43 FF, 40 42 FF, 40 41 FF)
  for (const t of [0x85a8, 0x86b3, 0x8860, 0x89c2, 0x8aad]) expect(rom, off(0x0d, t), [0x71, 0x91], `overhead death table $${t.toString(16)}`);
  expect(rom, off(0x0d, 0x91f2), [0xa9, 0x0d, 0x9d, 0x49, 0x05, 0x60], 'overhead death end');
  expect(rom, off(0x0d, 0x8b50), [0xa0, 0xf8, 0xa9, 0xb9, 0x20, 0xc7, 0xd6], 'continue pickup art');
  expect(rom, off(0x0d, 0x9046), [0x20, 0xf1, 0x8e], 'continue pickup touch test');
  expect(rom, off(0x0d, 0x9050), [0xad, 0xfa, 0x04, 0xc9, 0x09, 0xf0, 0x03, 0xee, 0xfa, 0x04], 'continue pickup touch');
  const ARM = 0x9f60, ARM_END = TOPDOWN_FIRE; // 0D (after the gate display's build block, before topDownFire's)
  expect(rom, off(0x0d, ARM), new Array(ARM_END - ARM).fill(0x00), 'free space 0D:$9F60');
  expect(rom, off(0x0d, CODE), new Array(CODE_END - CODE).fill(0x00), 'free space 0D:$9DB0');
  expect(rom, off(0x0a, ART), new Array(5).fill(0xff), 'free space 0A:$BFD8');
  expect(rom, 0x204e0, new Array(16).fill(0x00), 'a blank tile (bank 8)');
  expect(rom, off(0x03, LISTS), [0x40, 0x43, 0xff, 0x40, 0x42, 0xff, 0x40, 0x41, 0xff], 'truck stage CHR lists');
  const labels: Record<string, number> = {};
  const code = assemble(CODE, [
    { label: 'conv' }, //                                   X = the dead enemy, about to become the pickup
    ...(eagle === 'none' ? [] : [0xbd, 0x49, 0x05, 0xc9, 0x07, { rel: 0xf0, to: 'cont' }, 0xc9, 0x09, { rel: 0xf0, to: 'cont' }]), // types 7, 9: the eagle (Nothing: they roll as the rest)
    0xa5, 0x36, 0xc9, 0x55, { rel: 0xb0, to: 'none' }, //   LDA $36 / CMP #$55 / BCS none (2 in 3)
    0xa9, 0x01, 0x2c, //                                    LDA #1 (bullet) / BIT (skips the next LDA)
    { label: 'cont' }, 0xa9, 0x00,
    0x9d, 0x5a, 0x06, 0xa9, 0x0d, 0x9d, 0x49, 0x05, 0x60, // STA $065A,X / LDA #$0D / STA $0549,X / RTS
    { label: 'none' }, 0x4c, 0xca, 0xd6, //                 JMP $D6CA (gone, as the no-drop death ends)
    { label: 'art' },
    0xbd, 0x5a, 0x06, { rel: 0xd0, to: 'bulletArt' }, 0xa0, 0xf8, 0xa9, 0xb9, 0x4c, 0xc7, 0xd6, // continue: $B9F8
    { label: 'bulletArt' }, 0xa0, ART & 0xff, 0xa9, ART >> 8, 0x4c, 0xc7, 0xd6,
    { label: 'touch' },
    0xbd, 0x5a, 0x06, { rel: 0xd0, to: 'bullet' },
    ...(eagle === 'oneup' ? [0x8a, 0x48, 0x20, 0xc3, 0xd7, 0x68, 0xaa, 0x60] : [0xad, 0xfa, 0x04, 0xc9, 0x09, 0xf0, 0x03, 0xee, 0xfa, 0x04, 0x60]), // the eagle: a 1UP, or a continue (up to 9) as vanilla
    { label: 'bullet' }, 0x8a, 0x48, 0x20, 0xba, 0xd7, 0x68, 0xaa, 0x60, // TXA / PHA / JSR $D7BA (+1 bullet) / PLA / TAX
  ], labels);
  if (CODE + code.length > CODE_END) throw new Error('top-down drops: code too big');
  rom.set(code, off(0x0d, CODE));
  for (const t of [0x85a8, 0x86b3, 0x8860, 0x8aad, 0x89c2]) rom[off(0x0d, t)] = 0xca;
  rom.set([0x4c, labels.conv & 0xff, labels.conv >> 8, 0xea, 0xea, 0xea], off(0x0d, 0x91f2));
  if (eagle === 'none') noType8Eagle(rom);
  rom.set([0x20, labels.art & 0xff, labels.art >> 8, 0xea, 0xea, 0xea, 0xea], off(0x0d, 0x8b50));
  rom.set([0x20, labels.touch & 0xff, labels.touch >> 8, ...new Array(7).fill(0xea)], off(0x0d, 0x9050));
  const arm = assemble(ARM, [
    0x20, 0xf1, 0x8e, { rel: 0x90, to: 'done' }, //          JSR $8EF1 / BCC done (Ladd touches it)
    0x20, 0x4d, 0x8f, { rel: 0xb0, to: 'done' }, //          JSR $8F4D / BCS done (the arm's sweep box misses)
    0xad, 0x4d, 0x05, 0xc9, 0x05, { rel: 0xf0, to: 'hit' }, // LDA $054D / CMP #5 / BEQ hit (slot 4 is the arm)
    0x38, 0x60, //                                           SEC / RTS
    { label: 'hit' }, 0x18,
    { label: 'done' }, 0x60,
  ]);
  if (ARM + arm.length > ARM_END) throw new Error('top-down drops: arm code too big');
  rom.set(arm, off(0x0d, ARM));
  rom.set([0x20, ARM & 0xff, ARM >> 8], off(0x0d, 0x9046));
  // one 8x16 sprite: tile $FC (top; $FD blank), palette 1. (Not $9A, the jeep explosion's, nor $60, Ladd's death's:
  // both showed up in playtests)
  rom.set([0x01, 0xfc, 0xfc, 0xf8, 0x01], off(0x0a, ART));
  setChrRecord(rom, TRUCK_DROP_CHR_ID, [...chrSource(0x200a0), 0x0f, 0xc0, 0x01]); // bank 8 tile 9 -> sprite tile $FC
  setChrRecord(rom, TRUCK_BLANK_CHR_ID, [...chrSource(0x204e0), 0x0f, 0xd0, 0x01]); // a blank (bank 8) -> $FD
  const ptr = (room: number) => off(0x03, 0xb8e7 + 2 * room);
  // the passage's list (its own, or placePassageItem's) + the record, in the passage space (pickups.ts PASSAGE_LIST)
  const passageIds: number[] = [];
  for (let a = off(0x03, rom[ptr(0x15)] | (rom[ptr(0x15) + 1] << 8)); rom[a] < 0x80; a++) passageIds.push(rom[a]);
  const passage = [...passageIds, TRUCK_DROP_CHR_ID, TRUCK_BLANK_CHR_ID, 0xff];
  if (PASSAGE_LIST + passage.length > PASSAGE_LIST_END) throw new Error('top-down drops: passage CHR list too long');
  rom.set(passage, off(0x03, PASSAGE_LIST));
  rom.set([PASSAGE_LIST & 0xff, PASSAGE_LIST >> 8], ptr(0x15));
  // the convoy stages' lists in place, over the passage's old one
  rom.set([0x40, 0x43, TRUCK_DROP_CHR_ID, TRUCK_BLANK_CHR_ID, 0xff, 0x40, 0x42, TRUCK_DROP_CHR_ID, 0xff], off(0x03, LISTS));
  rom.set([LISTS & 0xff, LISTS >> 8], ptr(0x13));
  rom.set([(LISTS + 5) & 0xff, (LISTS + 5) >> 8], ptr(0x14));
}

/** Option "Top-Down Eagles": what the elite enemies' eagle pickup (types 7 and 9) gives. */
export type Eagles = 'vanilla' | 'oneup' | 'none';

/**
 * No eagles (option "Top-Down Eagles": Nothing, without truck drops): the elite enemies' death end (0D:$91F2 `LDA #$0D /
 * STA $0549,X / RTS`, the body becomes the eagle) ends as the other enemies' does, `JMP $D6CA` (gone).
 */
export function noEagles(rom: Uint8Array) {
  const at = 0x10 + 0x0d * 0x4000 + 0x91f2 - 0x8000;
  expect(rom, at, [0xa9, 0x0d, 0x9d, 0x49, 0x05, 0x60], 'overhead death end');
  rom.set([0x4c, 0xca, 0xd6, 0xea, 0xea, 0xea], at);
  noType8Eagle(rom);
}

/**
 * Overhead type 8, the jeep (handler 0D:$96A1, the type table's $8590) dies through its own state 2 (0D:$9753: 10 frames, then
 * `LDA #$0D / STA $0549,X` at $9771, the eagle), not $9171/$91CA: with no eagles (either drops setting) it ends gone,
 * `JMP $D6CA`, as the others.
 */
function noType8Eagle(rom: Uint8Array) {
  const at = 0x10 + 0x0d * 0x4000 + 0x9771 - 0x8000;
  expect(rom, at, [0xa9, 0x0d, 0x9d, 0x49, 0x05, 0xa9, 0x00], 'overhead type 8 death');
  rom.set([0x4c, 0xca, 0xd6, 0xea, 0xea], at);
}

/**
 * Eagle 1UPs (option "Top-Down Eagles": 1-UP): the top-down stages' eagle pickup (the +1 continue, 0D:$9050) gives a life
 * instead, through the game's 1UP (0F:$D7C3: its sound, lives + 1 up to 9). With truck drops on, `topDownDrops` does it.
 */
export function eagleOneUps(rom: Uint8Array) {
  const at = 0x10 + 0x0d * 0x4000 + 0x9050 - 0x8000;
  expect(rom, at, [0xad, 0xfa, 0x04, 0xc9, 0x09, 0xf0, 0x03, 0xee, 0xfa, 0x04], 'eagle pickup (continue)');
  rom.set([0x8a, 0x48, 0x20, 0xc3, 0xd7, 0x68, 0xaa, 0xea, 0xea, 0xea], at); // TXA / PHA / JSR $D7C3 / PLA / TAX (X: the pickup, removed next)
}
