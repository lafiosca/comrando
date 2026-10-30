import { assemble } from '../asm.ts';
import { ITEMS } from '../world.ts';
import { expect } from './rom.ts';

// The overworld map: the hidden passage's roads, the region gates (6-8, 8-10, the Flak Map), travel speed, trucks.

/**
 * Vanilla bug: the hidden-passage check (0D:$A5FF) hides 14->17, 18->15 and 15->18 until the passage is found ($04F7)
 * but forgets 17->14. That road is never drawn, yet NZ17's TRANSFER menu offers "AREA14" and flying it enters the
 * underground passage stage early. Rewrite the routine in place with NZ17 added (route offset 4, like 14 and 18). The
 * compare operands for 14/18/15 stay at $A602/$A606/$A60A; 17's is at $A60E (all set per layout by applyMapLayout).
 */
export function fixPassageGate(rom: Uint8Array) {
  const AT = 0x3660f; // 0D:$A5FF
  expect(rom, AT, [
    0xa5, 0x4d, 0xc9, 0x0e, 0xf0, 0x0d, 0xc9, 0x12, 0xf0, 0x18, 0xc9, 0x0f, 0xd0, 0xf1, 0xa9, 0x06, 0x4c, 0x14, 0xa6,
    0xa9, 0x04, 0xcd, 0x9a, 0x04, 0xd0, 0xe5, 0xad, 0xf7, 0x04, 0xd0, 0xe0, 0x4c, 0x48, 0xa5, 0xa9, 0x04, 0x4c, 0x14, 0xa6,
  ], 'passage gate');
  rom.set([
    0xa5, 0x4d, //             LDA $4D
    0xc9, 0x0e, 0xf0, 0x0c, // CMP #14 / BEQ four
    0xc9, 0x12, 0xf0, 0x08, // CMP #18 / BEQ four
    0xc9, 0x0f, 0xf0, 0x08, // CMP #15 / BEQ six
    0xc9, 0x11, 0xd0, 0xed, // CMP #17 / BNE $A5FE (RTS)
    0xa9, 0x04, 0xd0, 0x02, // four: LDA #4 / BNE cmp
    0xa9, 0x06, //             six:  LDA #6
    0xcd, 0x9a, 0x04, 0xd0, 0xe2, // cmp: CMP $049A / BNE $A5FE
    0xad, 0xf7, 0x04, 0xd0, 0xdd, //      LDA $04F7 / BNE $A5FE
    0x4c, 0x48, 0xa5, //       JMP $A548 (skip this road)
    0xea, 0xea, //             (unused; same 39 bytes as vanilla)
  ], AT);
}

/**
 * Remove the two map road gates (0D:$A5CE road 6->8: areas 3+6 cleared and γ; 0D:$A5E9 road 8->10: δ and area 7
 * cleared). Each gate first compares the current node; pointing that compare at a node that doesn't exist ($FF) makes
 * the gate never apply.
 */
export function removeRoadGates(rom: Uint8Array) {
  expect(rom, 0x365de, [0xa5, 0x4d, 0xc9, 0x06, 0xd0, 0x14], 'road gate 6->8');
  expect(rom, 0x365f9, [0xa5, 0x4d, 0xc9, 0x08, 0xd0, 0x0f], 'road gate 8->10');
  rom[0x365e1] = 0xff;
  rom[0x365fc] = 0xff;
}

/**
 * Two-way 6<->8 road gate (after removeRoadGates). The vanilla 6->8 check at 0D:$A5CE is rewritten in place to also
 * cover 8->6, keyed on the layouts at map numbers 6 and 8 (`id6`, `id8`) and their road-list offsets (6's road to 8
 * is offset 6, 8's road to 6 is offset 10). On a match it jumps to unrolled `LDA $04xx / BEQ refuse` lines at free
 * 0D:$9C1F, one per flag (`flags`: low bytes of $04xx: items, area-cleared flags), so A, X and Y-as-message survive:
 * the callers keep the refusal message id in Y ($64). Returns Z set = blocked. The route test takes 24 of the 27
 * bytes, leaving 0D:$A5E6-$A5E8 for the Flak Map gate's jump (`addFlakMap`).
 */
/**
 * Is the selected road the gated one? From layout `idA` the gated road is at offset `offA` in its road list, from
 * `idB` at `offB`; on a match `match` runs (a JMP), else Z clear and RTS. 24 bytes, ending in that RTS.
 */
function gateRouteTest(idA: number, idB: number, offA: number, offB: number, match: number[]): number[] {
  return [
    0xa5, 0x4d, //             LDA $4D
    0xc9, idA, 0xf0, 0x07, //  CMP #idA / BEQ fromA
    0xc9, idB, 0xd0, 0x0d, //  CMP #idB / BNE done (Z clear: not gated)
    0xa9, offB, 0x2c, //       LDA #offB / BIT (skips the next LDA)
    0xa9, offA, //             fromA: LDA #offA
    0xcd, 0x9a, 0x04, //       CMP $049A
    0xd0, 0x03, //             BNE done
    ...match, //               (3 bytes)
    0x60, //                   done: RTS
  ];
}

export function setRoadGate(rom: Uint8Array, id6: number, id8: number, flags: number[]) {
  if (!flags.length || flags.length > 6) throw new Error('road gate: 1-6 flags');
  const AT = 0x365de; // 0D:$A5CE
  const FLAGS = 0x35c2f; // 0D:$9C1F
  expect(rom, AT, [
    0xa5, 0x4d, 0xc9, 0xff, 0xd0, 0x14, 0xad, 0x9a, 0x04, 0xc9, 0x06, 0xd0, 0x0d,
    0xad, 0xed, 0x04, 0xf0, 0x08, 0xad, 0xf0, 0x04, 0xf0, 0x03, 0xad, 0xe2, 0x04, 0x60,
  ], 'road gate 6->8 (removed)');
  expect(rom, FLAGS, new Array(33).fill(0xff), 'free space 0D:$9C1F');
  rom.set(gateRouteTest(id6, id8, 6, 10, [0x4c, 0x1f, 0x9c]), AT); // JMP $9C1F (flags; their RTS returns to the caller)
  const code: number[] = [];
  flags.forEach((f, i) => code.push(0xad, f, 0x04, 0xf0, 5 * (flags.length - 1 - i))); // LDA $04xx / BEQ rts
  code.push(0x60); // RTS: Z from the last flag (set = blocked)
  rom.set(code, FLAGS);
}

/** The Flak Map's flag: stack-page RAM below the stack ($01CE-$01E8 unused), cleared by a new game, kept on continue. */
export const FLAK_FLAG = 0x01d3;
/** Message Y for the 8<->10 refusal: #114 ("1 2 3 4 5 6 7 8 9 0"), from the unused number-entry screen. */
export const FLAK_REFUSAL_Y = 0xe0;

/**
 * The Flak Map and its two-way 8<->10 road gate (after removeRoadGates, and after setRoadGate when that's used).
 * - Gate: the vanilla 8->10 check at 0D:$A5E9 (21 bytes; $A5FE stays the RTS the passage check branches to) becomes a
 *   route test for both directions (map 8's road 4 to 10, map 10's road 6 to 8), keyed on the layouts at map numbers 8
 *   and 10. On a match it branches back to a JMP at $A5E6 (freed by the compact 6<->8 test) to 0D:$9C71: `LDA $01D3 /
 *   BNE ok / LDY #$E0 / LDA #0 / ok: RTS`. Blocked: Z set and Y = the refusal message, which the route-select caller
 *   ($A56D) shows.
 * - Getting it: the area-clear reward (0A:$B151) and the building pickup (0F:$F63E) both do `LDA #1 / STA $04CA,Y`
 *   with Y = the item's inventory offset; their STA becomes `JSR $C694` (free 0F:$C694-$C69F): the Flak Map's offset
 *   stores to FLAK_FLAG instead, anything else as before.
 */
export function addFlakMap(rom: Uint8Array, id8: number, id10: number) {
  const GIVE = 0x3c6a4; // 0F:$C694
  const GIVE_SITES = [0x2b161, 0x3f64e]; // 0A:$B151, 0F:$F63E
  const offset = ITEMS.flak.inventory;
  setRoad10Gate(rom, id8, id10, [
    0xad, FLAK_FLAG & 0xff, FLAK_FLAG >> 8, // LDA $01D3
    0xd0, 0x04, //             BNE ok
    0xa0, FLAK_REFUSAL_Y, //   LDY #refusal
    0xa9, 0x00, //             LDA #0 (Z set: blocked)
    0x60, //                   ok: RTS
  ]);
  expect(rom, GIVE, new Array(12).fill(0xff), 'free space 0F:$C694');
  rom.set([
    0xc0, offset, 0xf0, 0x04, // CPY #flak / BEQ flak
    0x99, 0xca, 0x04, 0x60, //   STA $04CA,Y / RTS
    0x8d, FLAK_FLAG & 0xff, FLAK_FLAG >> 8, 0x60, // flak: STA $01D3 / RTS
  ], GIVE);
  for (const at of GIVE_SITES) {
    expect(rom, at, [0x99, 0xca, 0x04], 'item store');
    rom.set([0x20, 0x94, 0xc6], at); // JSR $C694
  }
}

/**
 * The 8<->10 road gate (after removeRoadGates, and after setRoadGate when that's used): the route test (see
 * addFlakMap) jumps to `check` at 0D:$9C71 (up to 15 bytes; Z set = blocked, Y = the refusal message). With `flags`
 * (low bytes of $04xx: items, area-cleared flags) instead of code, the check is `LDA $04xx / BEQ no` per flag (at most
 * two), then `LDY #$E0` (message #114) on refusal. Vanilla only gated 8->10; the road is the only way in or out of 10-12.
 */
export function setRoad10Gate(rom: Uint8Array, id8: number, id10: number, check: number[] | { flags: number[] }) {
  const GATE1 = 0x365de, GATE2 = 0x365f9; // 0D:$A5CE, 0D:$A5E9
  const JUMP = 0x365f6; // 0D:$A5E6
  const CHECK = 0x35c81; // 0D:$9C71
  if (!Array.isArray(check)) {
    const f = check.flags;
    if (f.length < 1 || f.length > 2) throw new Error('road gate 8<->10: 1-2 flags');
    check = [
      ...(f.length === 2 ? [0xad, f[0], 0x04, 0xf0, 0x05] : []), // LDA $04xx / BEQ no
      0xad, f.at(-1)!, 0x04, 0xd0, 0x04, //                        LDA $04yy / BNE ok
      0xa0, FLAK_REFUSAL_Y, 0xa9, 0x00, //                          no: LDY #refusal / LDA #0 (Z set: blocked)
      0x60, //                                                      ok: RTS
    ];
  }
  if (check.length > 15) throw new Error('road gate 8<->10: check too long');
  if (rom[GATE1 + 3] === 0xff) rom.set([0xa9, 0x01, 0x60], GATE1); // no 6<->8 gate: LDA #1 / RTS (Z clear)
  else expect(rom, GATE1 + 23, [0x60], 'compact 6<->8 gate');
  expect(rom, GATE2, [0xa5, 0x4d, 0xc9, 0xff, 0xd0, 0x0f], 'road gate 8->10 (removed)');
  expect(rom, GATE2 + 21, [0x60], 'shared RTS 0D:$A5FE');
  expect(rom, CHECK, new Array(15).fill(0xff), 'free space 0D:$9C71');
  rom.set([0x4c, 0x71, 0x9c], JUMP); // JMP $9C71
  rom.set([
    0xa5, 0x4d, //             LDA $4D
    0xc9, id8, 0xf0, 0x07, //  CMP #id8 / BEQ from8
    0xc9, id10, 0xd0, 0x0b, // CMP #id10 / BNE $A5FE (RTS, Z clear)
    0xa9, 0x06, 0x2c, //       LDA #6 (10's road to 8) / BIT (skips the next LDA)
    0xa9, 0x04, //             from8: LDA #4 (8's road to 10)
    0xcd, 0x9a, 0x04, //       CMP $049A
    0xf0, 0xe9, //             BEQ $A5E6 (the JMP)
    0xea, //                   NOP, then $A5FE: RTS
  ], GATE2);
  rom.set(check, CHECK);
}

/**
 * Faster map travel, for the helicopter only (doubled trucks hit too often, the same one twice). The
 * helicopter and the truck convoys move by 0D:$A6E2 (helicopter: 0D:$A64B; trucks: $A893), adding an 8.8 step per frame
 * from the 8-direction table at 0F:$FEE2 ($0040 = 1/4 px straight, $002D diagonal; through the pointer at 0F:$FCD6),
 * and arrive when within 2 px of a node (0D:$A718), so a step of up to 1 px can't overshoot. The routine is rewritten in
 * place (it reads the table directly, which frees the pointer loads): the trucks' entry takes one step, the helicopter's
 * (still $A6E2) `factor` steps: `JSR step` per extra step, then falls into it. The table stays vanilla.
 * After an encounter the map object (truck or hidden-passage stage) sleeps for $7E frames of helicopter flight (set at
 * 0D:$A6BE, counted down at $A876 only while flying); that's scaled too, or at double speed flying straight back over
 * a hidden passage skips its stage (playtest).
 */
export function setMapSpeed(rom: Uint8Array, factor: number) {
  if (factor < 1 || factor > 2) throw new Error('map speed: 1-2x');
  if (factor === 1) return;
  const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
  const COOLDOWN = off(0x0d, 0xa6be); // LDA #$7E / STA $04A3,X
  expect(rom, COOLDOWN, [0xa9, 0x7e, 0x9d, 0xa3, 0x04], 'encounter cooldown');
  rom[COOLDOWN + 1] = Math.round(0x7e / factor);
  const MOVE = 0xa6e2, MOVE_END = 0xa718, TABLE = 0xfee2;
  expect(rom, off(0x0d, MOVE), [0xad, 0xd6, 0xfc, 0x85, 0x17, 0xad, 0xd7, 0xfc, 0x85, 0x18, 0xbd, 0x7f, 0x04], 'map move routine');
  expect(rom, off(0x0d, 0xa64b), [0x20, 0xe2, 0xa6], 'helicopter move call');
  expect(rom, off(0x0d, 0xa893), [0x20, 0xe2, 0xa6], 'truck move call');
  expect(rom, 0x10 + 15 * 0x4000 + 0xfcd6 - 0xc000, [TABLE & 0xff, TABLE >> 8], 'map step table pointer');
  const t = (lo: number) => [0xb9, (TABLE + lo) & 0xff, (TABLE + lo) >> 8]; // LDA table+lo,Y (Y = direction · 4)
  const code = assemble(MOVE, [
    ...new Array(factor - 1).fill(0).flatMap(() => [{ abs: 0x20, to: 'step' }]), // (the helicopter: JSR step ×, then into it)
    { label: 'step' }, 0xbd, 0x7f, 0x04, 0x0a, 0x0a, 0xa8, //   LDA $047F,X (direction) / ASL / ASL / TAY
    0x18, ...t(0), 0x7d, 0x5b, 0x04, 0x9d, 0x5b, 0x04, //         CLC / x lo
    ...t(1), 0x7d, 0x52, 0x04, 0x9d, 0x52, 0x04, //               x hi
    0x18, ...t(2), 0x7d, 0x6d, 0x04, 0x9d, 0x6d, 0x04, //         CLC / y lo
    ...t(3), 0x7d, 0x64, 0x04, 0x9d, 0x64, 0x04, //               y hi
    0x60,
  ], {});
  if (MOVE + code.length > MOVE_END) throw new Error('map speed: move routine too big');
  rom.fill(0xea, off(0x0d, MOVE), off(0x0d, MOVE_END));
  rom.set(code, off(0x0d, MOVE));
  const step = MOVE + 3 * (factor - 1);
  rom.set([0x20, step & 0xff, step >> 8], off(0x0d, 0xa893)); // (the trucks: one step)
}

/**
 * Remove the map's enemy trucks (no truck encounters). The map init at 0D:$A94A spawns trucks from the table at
 * $A99F in a do-while loop, then (at $A97F) sets up the two hidden-passage objects. Jumping straight to $A97F skips
 * the trucks but keeps the passage objects (the helmet's overhead stage). An empty table wouldn't work: the loop
 * spawns its first entry before checking for the $FF end marker.
 */
export function disableTrucks(rom: Uint8Array) {
  const LOOP = 0x3695a; // 0D:$A94A: LDY #0 / LDX #1 / ...
  expect(rom, LOOP, [0xa0, 0x00, 0xa2, 0x01], 'truck spawn loop');
  rom.set([0x4c, 0x7f, 0xa9], LOOP); // JMP $A97F
}
