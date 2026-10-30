// Seed-specific story text: keep what the game says about Super Joe and Area 12 true for this seed.
// Message numbers/ids and where each is shown: docs/rom-notes.md#text-and-messages.

import { type Message, messageForY, readMessage, wrap } from './text.ts';
import { AREA12_REFUSAL_Y } from './patches/area12.ts';
import { FLAK_REFUSAL_Y } from './patches/roads.ts';
import { type Area12Condition, HINT_COMM_AREAS, type Item, VANILLA_COMMS } from './world.ts';

/** Boss room per area (room ids $16-$21, inferred from the door tables; see docs/rom-notes.md#bosses). */
const BOSS_ROOM: Record<number, number> = {
  1: 0x16,
  2: 0x17,
  3: 0x1f,
  4: 0x18,
  5: 0x19,
  6: 0x1a,
  7: 0x1b,
  8: 0x20,
  9: 0x1c,
  10: 0x1d,
  11: 0x1e,
  12: 0x21,
};
/** 0F:$E6ED + (room - $16): the message id ($8F) a room's NPC/boss says when you meet them. */
const ROOM_MESSAGE_TABLE = 0x3e6fd;
/** Header (box style, no portrait) of the vanilla refusal message $64. */
const REFUSAL_HEADER = 0xb0;
/** Message #28 ("HERE'S ANOTHER COMMUNICATOR FOR YOU…", never shown in vanilla), reused for Joe's captor's line. */
const CAPTOR_LINE_Y = 0x34;
/** Message #113 ("GOOD", a leftover never shown), reused for the transfer line in a portrait other than Area 9's. */
const TRANSFER_LINE_Y = 0xde;
/** Area 9's boss: "YOUR EFFORT IS WASTED. WE'VE JUST TRANSFERED JOE TO ANOTHER LOCATION." (commander portrait). */
const TRANSFER_Y = 0x8c;
/** Header of the robot bosses' "PI PI PI***" line (message y $48: Areas 3, 5, 10); $00 shows no portrait. */
const ROBOT_HEADER = 0;

export interface StoryOptions {
  /** Area (identity/layout) whose clear frees Joe. */
  joeArea: number;
  /** Area (layout) whose boss says Joe was just transferred (vanilla 9); none when no clue sends the player there. */
  transferArea?: number;
  area12: Area12Condition;
  /** Map number where an area's layout now is (map layout shuffle); identity when unshuffled. */
  spot: (id: number) => number;
  /** 6<->8 road gate preset ('iff' | 'vanilla' | 'open'). Its refusal is message $64. */
  gate?: string;
  /** 8<->10 road gate preset ('flak' | 'vanilla' | 'open'). Its refusal is message #114. */
  gate10?: string;
  /** Lists of three or more areas take an Oxford comma (option "Fix Typos"). */
  oxford?: boolean;
  /** The dark layouts (the Flare lines name them): 4, and more with option "Dark Areas". */
  dark?: readonly number[];
  /** The communicator each layout uses (#23 and #63 name the areas theirs works in); vanilla by default. */
  commOf?: (id: number) => Item;
  /** Map number of the zone holding the interrogation room (#70 names it with option "Fix Typos"); vanilla 17. */
  interrogation?: number;
  /** Option "Fix Typos". */
  typos?: boolean;
}

/** Layouts a communicator works in, as #23 and #63 count them: each communicator has 3 (comms.ts assignComms), but O6
 * has no comm room (vanilla γ "IN AREAS 7 AND 9" counts O7, whose room is empty; O12's agents use theirs). */
const COMM_LAYOUTS = [...HINT_COMM_AREAS, 7, 12].sort((a, b) => a - b);

/** "1,4 AND 5" — map numbers for a set of layouts, ascending. */
export function areaList(ids: readonly number[], spot: (id: number) => number, oxford = false): string {
  const n = ids.map(spot).sort((a, b) => a - b);
  // (vanilla style "1,4 AND 5"; `oxford`: "1,4,AND 5", spaced by typos.ts spaceCommas: "1, 4, AND 5")
  return n.length === 1
    ? `${n[0]}`
    : `${n.slice(0, -1).join(',')}${oxford && n.length > 2 ? ',' : ''} AND ${n[n.length - 1]}`;
}

/** "AREA 4" or "AREAS 4 AND 9", from an areaList. */
export const areaWord = (a: string) => `${a.includes(' AND ') ? 'AREAS' : 'AREA'} ${a}`;

/** Vanilla lines that name enemy areas by number, keyed by message Y, with the layouts they refer to ('dark': the dark
 * areas; a function: map numbers worked out for the seed). */
interface Seed {
  spot: (id: number) => number;
  commOf: (id: number) => Item;
  dark: readonly number[];
  interrogation: number;
  typos: boolean;
}
type Referent = number[] | 'dark' | ((o: Seed) => number[]);
const AREA_LINES: [number, Referent, (a: string) => string][] = [
  [0x1c, [4], (a) => `AREA ${a} IS AN\nARSENAL.\nMAYBE WE CAN\nFIND GOOD WEAPON WE CAN USE.`],
  [0x1e, [4], (a) => `SECOND BATTALION IS HEADING TOWARDS AREA ${a}.`],
  [0x20, 'dark', (a) => `HEY,IF YOU'RE GOING TO ${areaWord(a)},DON'T FORGET TO TAKE A FLARE GUN WITH YOU.`],
  [
    0x26,
    'dark',
    (a) =>
      `WELCOME,\nMY FRIEND.\nWE'VE PREPARED SOME FLARE BOMBS FOR YOU.\nYOU WILL NEED THEM IN ${areaWord(a)}.\nPUSH START BUTTON TO USE THEM.`,
  ],
  // (O4A's "this communicator": the one its room takes; vanilla α, in 1, 4 and 5)
  [
    0x2a,
    (o) => COMM_LAYOUTS.filter((id) => o.commOf(id) === o.commOf(4)).map(o.spot),
    (a) => `THIS IS M-8.\nUSE THIS COMMUNICATOR IN ${areaWord(a)}.\nWE HAD TO HIDE THE OTHER 3 WHICH YOU MUST FIND.`,
  ],
  [0x50, [3, 6], (a) => `IF YOU HAVE A WIDE CANNON AND ROCKET LAUNCHER,GO TOWARDS AREAS ${a}.`],
  // (the areas other than O8, where it's said: vanilla γ is 7, 8 and 9)
  [
    0x7a,
    (o) => COMM_LAYOUTS.filter((id) => id !== 8 && o.commOf(id) === 'gamma').map(o.spot),
    (a) => `γ CAN BE VERY USEFUL IN ${areaWord(a)}.`,
  ],
  // (vanilla "AREA 7", where the interrogation room is NZ17: with option "Fix Typos" the zone
  // holding it, else Area 7's layout)
  [
    0x88,
    (o) => [o.typos ? o.interrogation : o.spot(7)],
    (a) =>
      `THIS IS M-2.\nWE'VE CAPTURED THE ENEMY.\nI WANT TO KNOW ABOUT THE UNDERGROUND PATH BUT I DON'T KNOW WHERE TO START. WOULD YOU PLEASE COME TO AREA ${a}?`,
  ],
  [
    0xf8,
    [1],
    (a) =>
      `THE COMMAND IS AS FOLLOWS***\nENTER INTO THE ENEMY AREA.\nRESCUE SUPER JOE WHILE STAYING IN TOUCH WITH AGENTS.\nTHERE ARE MANY AGENTS IN AREA ${a} NOW.\nFIRST,GO SEE THEM.\nWE RELY ON YOU.`,
  ],
];

/**
 * Seed story: rewrites the boss-line table in place and returns the message replacements for the caller to write
 * (all of a seed's text must go through one `writeMessages` call).
 */
export function applyStory(
  rom: Uint8Array,
  {
    joeArea,
    transferArea,
    area12,
    spot,
    gate,
    gate10,
    dark = [4],
    oxford = false,
    typos = false,
    commOf = (id) => VANILLA_COMMS[id],
    interrogation = 17,
  }: StoryOptions,
): Map<number, string | Message> {
  const withAreas = area12 === 'joe+10+11',
    vanilla12 = area12 === 'vanilla';
  const h = spot(joeArea);
  // (a vanilla line stays unless the areas it names changed)
  const areasOf = (ids: Referent, o: Seed) =>
    (typeof ids === 'function' ? ids(o) : (ids === 'dark' ? o.dark : ids).map(o.spot)).sort((a, b) => a - b);
  const seed: Seed = { spot, commOf, dark, interrogation, typos };
  const vanilla: Seed = {
    spot: (id) => id,
    commOf: (id) => VANILLA_COMMS[id],
    dark: [4],
    interrogation: 17,
    typos: false,
  };
  const moved = AREA_LINES.map(
    ([y, ids, line]) => [y, areasOf(ids, seed), areasOf(ids, vanilla), line] as const,
  ).filter(([, now, was]) => now.join() !== was.join());
  const text = new Map<number, string | Message>([
    ...moved.map(
      ([y, areas, , line]) => [messageForY(y), wrap(line(areaList(areas, (n) => n, oxford)))] as [number, string],
    ),
    // Area 12 descent refused (0D:$A51A): its own message (#115, unused in vanilla), in the box style of the vanilla
    // refusal $64 ("YOU DON'T HAVE ENOUGH POWER."), which stays with the 6<->8 road gate.
    [
      messageForY(AREA12_REFUSAL_Y),
      {
        header: REFUSAL_HEADER,
        text: wrap(
          withAreas
            ? 'AREA 12 NEEDS SUPER JOE AND AREAS 10 AND 11 DESTROYED.'
            : vanilla12
              ? "WE CAN'T ATTACK AREA 12 UNTIL AREAS 10 AND 11 ARE DESTROYED."
              : "WE CAN'T ATTACK AREA 12 UNTIL SUPER JOE IS RESCUED.",
        ),
      },
    ], // the map's text box shows 4 lines, no paging
    // The road gate keeps the vanilla line for the vanilla requirement; the IFF Code gate says what it needs.
    ...(gate === 'iff'
      ? [[messageForY(0x64), wrap('WE NEED THEIR IFF CODE TO FLY BETWEEN AREAS 6 AND 8.')] as [number, string]]
      : []),
    ...(gate10 === 'flak' || gate10 === 'vanilla'
      ? ([
          [
            messageForY(FLAK_REFUSAL_Y),
            {
              header: REFUSAL_HEADER,
              text: wrap(
                gate10 === 'flak'
                  ? 'WE NEED A FLAK MAP TO FLY BETWEEN AREAS 8 AND 10.'
                  : 'WE NEED δ AND AREA 7 DESTROYED TO FLY BETWEEN AREAS 8 AND 10.',
              ),
            },
          ],
        ] as [number, Message][])
      : []),
    // Hal, Area 11 comm room. Vanilla: "...I CANNOT ENTER UNLESS YOU BLOW UP AREAS 10 AND 11..."
    // (the vanilla condition keeps the vanilla line)
    ...(vanilla12
      ? []
      : [
          [
            messageForY(0xb6),
            wrap(
              "I AM HAL.\nI'M IN FRONT OF AREA 12 NOW.\n" +
                (withAreas
                  ? 'I CANNOT ENTER UNTIL SUPER JOE IS RESCUED AND YOU BLOW UP AREAS 10 AND 11,SO PLEASE DO IT FAST.\n'
                  : 'I CANNOT ENTER UNTIL SUPER JOE IS RESCUED,SO PLEASE DO IT FAST.\n') +
                "BAZOOKA? YES,I HAVE IT.\nDON'T WORRY ABOUT ANYTHING.\nLET ME HANDLE THE REST.",
            ),
          ] as [number, string],
        ]),
    // Joe's whereabouts, all pointed at the area that actually holds him.
    [messageForY(0x32), wrap(`WE'VE LOCATED\nJOE!\nHE'S AT P.O.W. CAMP IN AREA ${h}.\nPLEASE HURRY.`)], // vanilla 7
    [
      messageForY(0x3e),
      wrap(
        `ARE YOU FROM THE FEDERATION?\nI'M A SPY FOR THE FEDERATION.\nI JUST SAW THAT JOE WAS TAKEN AWAY.THEY HEADED TOWARDS AREA ${h}.`,
      ),
    ], // vanilla 8
    [
      messageForY(0x54),
      wrap(`YOU IMBECILE,\nHOW LONG HAVE YOU BEEN IN THE FORCE!\nIT'S IN AREA ${h}.\nKEEP IT IN MIND.`),
    ], // vanilla 9
    [
      messageForY(0x7e),
      wrap(`AREA ${h} LOOKS LIKE THE DISPOSAL AREA.\nJOE MUST HAVE BEEN TAKEN THERE.\nPLEASE HURRY.`),
    ], // vanilla 9
    // Joe's tip about the machine gun names the zone the Destroyers' layout now sits at (vanilla 18).
    [
      messageForY(0x5a),
      wrap(
        `I HAVE GIVEN A SPECIAL MACHINE-GUN TO A MAN CALLED\nDESTROYER-3 IN AREA ${spot(18)}.\nYOU SHOULD USE THAT GUN.`,
      ),
    ],
  ]);

  // The Area 7 boss says "SO,YOU'VE FINALLY COME. JOE IS HERE, BUT YOU'RE GOING TO DIE HERE." (message $9A). The
  // message header picks the close-up portrait, so a line can't just move to another boss: Area 7's boss takes Area 6's
  // line (same officer portrait), and Joe's captor gets the Joe line in its own portrait, written into message #28
  // (unused in vanilla) unless the captor already uses the officer portrait.
  if (joeArea !== 7) {
    const at = (area: number) => ROOM_MESSAGE_TABLE + BOSS_ROOM[area] - 0x16;
    if (rom[at(7)] !== 0x9a || rom[at(6)] !== 0x70) throw new Error('story: unexpected boss lines');
    const header = readMessage(rom, messageForY(rom[at(joeArea)]))!.header;
    rom[at(7)] = 0x70;
    if (header === readMessage(rom, messageForY(0x9a))!.header) rom[at(joeArea)] = 0x9a;
    else {
      rom[at(joeArea)] = CAPTOR_LINE_Y;
      text.set(messageForY(CAPTOR_LINE_Y), {
        header,
        text: wrap(
          header === ROBOT_HEADER
            ? 'PI PI PI***\nINTRUDER FOUND.\nJOE IS HERE.\nATTACK.'
            : "SO,YOU'VE COME.\nJOE IS HERE,\nBUT YOU'RE GOING TO DIE HERE.",
        ), // no longer than #28's old text
      });
    }
  }
  // The boss who says Joe was just moved (vanilla Area 9's) is the decoy area of Joe's trail (hints.ts), or nobody:
  // Area 9's boss gets another commander line, and a boss with another portrait gets the line in its own (message #113).
  if (transferArea !== 9) {
    const at = (area: number) => ROOM_MESSAGE_TABLE + BOSS_ROOM[area] - 0x16;
    if (transferArea === joeArea) throw new Error("story: the transfer boss can't hold Joe");
    if (joeArea !== 9) rom[at(9)] = 0x56; // "ATTACK!! LET'S SHOW WHAT THE 2ND PLATOON CAN DO!" (Area 2's)
  }
  if (transferArea !== undefined && transferArea !== 9) {
    const at = (area: number) => ROOM_MESSAGE_TABLE + BOSS_ROOM[area] - 0x16;
    const header = readMessage(rom, messageForY(rom[at(transferArea)]))!.header;
    if (header === readMessage(rom, messageForY(TRANSFER_Y))!.header) rom[at(transferArea)] = TRANSFER_Y;
    else {
      rom[at(transferArea)] = TRANSFER_LINE_Y;
      text.set(messageForY(TRANSFER_LINE_Y), {
        header,
        text: wrap(
          header === ROBOT_HEADER
            ? 'PI PI PI***\nJOE IS NOT HERE.\nHE HAS BEEN TRANSFERRED.\nATTACK.'
            : "YOUR EFFORT IS WASTED.\nWE'VE JUST TRANSFERRED JOE TO ANOTHER LOCATION.",
        ),
      });
    }
  }
  return text;
}
