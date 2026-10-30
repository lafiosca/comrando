// NZ18's Destroyers (docs/design.md#destroyers). Three men ask whether you're with the Federation; YES to the real one makes both
// of his building rooms pay out his item (pickups.ts `destroyerPickups`), YES to an impostor turns the zone hostile and
// spoils the pickup for this visit and hits Ladd (3 pips) (the flags reset when you're back on the map). Per seed: their names and which one
// is real. See docs/rom-notes.md#destroyers.

import type { Rng } from './rng.ts';
import { messageForY, wrap } from './text.ts';
import { ITEMS, type Item } from './world.ts';

/** Object slots $0B-$0D (NZ18's object list) -> where each man stands. */
export const DESTROYER_POSITIONS = ['right of door B', 'by door A', 'left of door B'] as const;
const NAMES = [
  'MURPHY',
  'RIPLEY',
  'DUTCH',
  'BISHOP',
  'VASQUEZ',
  'REESE',
  'MCCLANE',
  'SLATER',
  'QUAID',
  'HAUSER',
  'KIMBLE',
  'TASKER',
  'DECKARD',
  'FLYNN',
  'RIGGS',
  'HANNIBAL',
  'RICHTER',
  'REYNOLDS',
];

/** 0F:$F884 + (slot - $0B): talk script per man. Script 4 is the real one (YES sets $04C5 bit 0), 6 and 7 impostors. */
const SCRIPT_TABLE = 0x3f894;
/** Each script's opening line (message Y). */
const INTRO_Y: Record<number, number> = { 4: 0xa2, 6: 0x9c, 7: 0xa0 };
/** Shown only after YES to the real one (vanilla: "...δ IS IN TOWN LOCATED BETWEEN THOSE MOUNTAINS..."). */
const REAL_YES_Y = 0xa6;
/** Joe's rescue line (vanilla: "...A MAN CALLED DESTROYER-3 IN AREA 18..."). */
const JOE_Y = 0x5a;
/** Impostor YES (0D:$A3BA): `LDA #2 / ORA $04C5 / STA $04C5`. */
const IMPOSTOR_YES = 0x363ca;
/** 0D:$BFC2-$BFDC: free zero fill after the passage clear screen's code ($BFA0-$BFC1). */
const MOLE_HIT = 0x10 + 0x0d * 0x4000 + 0xbfc2 - 0x8000;

export interface Destroyers {
  /** Name per position (DESTROYER_POSITIONS order). */
  names: string[];
  /** Position index of the real one. */
  real: number;
}

export function pickDestroyers(rng: Rng): Destroyers {
  return { names: rng.shuffle([...NAMES]).slice(0, 3), real: rng.int(3) };
}

/** Patch the scripts and return the seed's lines (message number -> text) for the one text repack. */
export function applyDestroyers(rom: Uint8Array, d: Destroyers, item: Item, zone: number): Map<number, string> {
  if (rom[SCRIPT_TABLE] !== 4 || rom[SCRIPT_TABLE + 1] !== 6 || rom[SCRIPT_TABLE + 2] !== 7)
    throw new Error('destroyers: unexpected script table');
  const impostors = [6, 7];
  const scripts = d.names.map((_, i) => (i === d.real ? 4 : impostors.shift()!));
  rom.set(scripts, SCRIPT_TABLE);
  // impostor YES: also raise the zone's alert ($04C4, as a shot or a wiretap alarm would) and hit Ladd for 3 pips: two
  // taken here, then the hit touching that man would give (0F:$EF54 with X = his slot: knocked back, a pip lost,
  // invincibility flash; below 0 pips, a death)
  const was = [0xa9, 0x02, 0x0d, 0xc5, 0x04, 0x8d, 0xc5, 0x04];
  if (was.some((b, i) => rom[IMPOSTOR_YES + i] !== b)) throw new Error('destroyers: unexpected impostor YES');
  if (rom.subarray(MOLE_HIT, MOLE_HIT + 27).some((b) => b !== 0)) throw new Error('destroyers: 0D:$BFC2 not free');
  const slot = (script: number) => 0x0b + scripts.indexOf(script);
  // biome-ignore format: hand-assembled 6502, one instruction group per line
  rom.set([
    0xa9, 0x02, 0x8d, 0xc5, 0x04, 0x8d, 0xc4, 0x04, // LDA #2 / STA $04C5 / STA $04C4
    0xce, 0x79, 0x07, 0xce, 0x79, 0x07, //             DEC $0779 x2 (pips)
    0xa2, slot(6), 0xa5, 0x88, 0xc9, 0x06, 0xf0, 0x02, 0xa2, slot(7), // X = the talking impostor's slot (script $88)
    0x4c, 0x54, 0xef, //                                JMP $EF54 (enemy contact)
  ], MOLE_HIT);
  rom.set([0x20, 0xc2, 0xbf, 0xea, 0xea, 0xea, 0xea, 0xea], IMPOSTOR_YES); // JSR; its RTS comes back to INC $CE / RTS
  const name = (i: number) => d.names[i];
  const lines = new Map<number, string>();
  scripts.forEach((s, i) => lines.set(messageForY(INTRO_Y[s]), wrap(`I AM ${name(i)}.\nARE YOU WITH THE FEDERATION?`)));
  const plural = item === 'pills' || item === 'boots';
  lines.set(
    messageForY(REAL_YES_Y),
    wrap(`GOOD.\nTHE ${ITEMS[item].name} ${plural ? 'ARE' : 'IS'} IN MY ROOM. TAKE ${plural ? 'THEM' : 'IT'}.`),
  );
  lines.set(
    messageForY(JOE_Y),
    wrap(`ONLY ${name(d.real)} IN AREA ${zone} IS ONE OF US.\nTHE OTHER TWO ARE IMPOSTORS.`),
  );
  return lines;
}
