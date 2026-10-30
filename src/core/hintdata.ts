import type { RouteStep, RouteVisit, SpoilerHint } from './spoiler.ts';
import type { DESTROYER_POSITIONS } from './destroyers.ts';
import type { CommAssignment } from './comms.ts';
import type { Placement } from './logic.ts';
import type { Door } from './patches/buildingdoors.ts';
import type { NonsenseSlot } from './nonsense.ts';
import type { Message } from './text.ts';
import type { Item, Location, Rules } from './world.ts';

// Hint data shared by the hint picker (hints.ts) and the route builder (route.ts): what a line can tell (Fact), the
// hint slots (comm rooms, wiretaps, door talkers) and their message numbers, the item words, the map's regions, and
// the hint options' input and output.

/** What a line tells (places are map numbers; 0 the underground-passage stage). */
export type Fact =
  | { kind: 'alpha'; areas: number[] }
  | { kind: 'find'; item: Item; place: number; decoy?: number; region?: Region }
  | { kind: 'need'; item: Item; place: number }
  | { kind: 'passage'; place: number }
  | { kind: 'visit'; place: number }
  /** One of the impostor Destroyers (`mole` indexes `moles`). Only Joe vouches for the real one. */
  | { kind: 'mole'; place: number; mole: number }
  /** Joe's trail: an earlier line sends the player to a decoy area, whose boss says he was just transferred. */
  | { kind: 'trail'; place: number }
  /** These areas have no comm room (O6, O7): nothing to bring. */
  | { kind: 'noroom'; areas: number[] }
  | {
      kind: 'comm';
      comm: Item;
      areas: number[];
      form: 'area' | 'door' | 'also' | 'held' | 'here' | 'next';
      heldAt?: number;
    };

export interface Slot {
  id: string;
  kind: 'comm' | 'wire' | 'talker';
  /** Area layout (comm rooms) or zone layout (talkers). */
  layout: number;
  ys: number[];
  /** Map number. */
  place: number;
  facts: Fact[];
  /** Facts the path needs (placed before the leftovers); only later ones may be dropped for length. */
  keep?: number;
  cap: number;
  read: boolean;
  /** Vanilla text that turns false under the shuffles; always rewritten. */
  forced?: boolean;
  /** Vanilla text that is false even in vanilla; always rewritten. */
  lie?: boolean;
  /** Vanilla text naming Joe's area: always rewritten with hints on, so his whereabouts come only from the chain. */
  joeLine?: boolean;
  /** Door talker: what's behind its door. */
  door?: Item;
  /** The man inside a building room (room $3E's): the door you go through to meet him. */
  inside?: Door;
  /** A talker by a door whose line isn't about it (NZ13's door-A man): his whole message is the clue. */
  own?: boolean;
  flavor?: string;
}

/** Comm-room slots by layout: COMMUNICATE (one message) or a wiretap pair (line, reply), or a one-line wiretap (O5A's
 * #32 "AAA**WHERE AM I?…", O8A's #64 Joe's "CAN SOMEONE HEAR ME?… NEAR THE OCEAN", O9A's #71): the
 * exchange on two pages of one message, no portrait (INTERCEPT). */
export const ROOM_SLOTS: [string, number, 'comm' | 'wire', number[], boolean?, boolean?][] = [
  ['O1B', 1, 'comm', [0x1c]],
  ['O1A wiretap', 1, 'wire', [0x18, 0x1a]],
  ['O1B wiretap', 1, 'wire', [0x1e, 0x20]],
  ['O2A', 2, 'comm', [0x50]],
  ['O2A wiretap', 2, 'wire', [0x52, 0x54], false, true],
  ['O3A', 3, 'comm', [0x68]],
  ['O3A wiretap', 3, 'wire', [0x6a, 0x6c]],
  ['O4A', 4, 'comm', [0x2a], true],
  ['O4A wiretap', 4, 'wire', [0x2c, 0x2e]],
  ['O5A', 5, 'comm', [0x3a]],
  ['O5A wiretap', 5, 'wire', [0x3c]],
  ['O5B', 5, 'comm', [0x3e], false, true],
  ['O5B wiretap', 5, 'wire', [0x40, 0x42]],
  ['O8A', 8, 'comm', [0x7a], true],
  ['O8A wiretap', 8, 'wire', [0x7c], false, true],
  ['O8B', 8, 'comm', [0x7e], false, true],
  ['O8B wiretap', 8, 'wire', [0x80, 0x82]],
  ['O9A', 9, 'comm', [0x88], true],
  ['O9A wiretap', 9, 'wire', [0x8a]],
  ['O10A', 10, 'comm', [0xb0]],
  ['O10A wiretap', 10, 'wire', [0xb2, 0xb4]],
  ['O11A', 11, 'comm', [0xb6]],
  ['O11A wiretap', 11, 'wire', [0xb8, 0xf0]],
];
/** Door talkers by zone layout: message Y, door (zone room, slot). NZ14's guard wants the Permit. */
export const TALKERS: [number, number, number, number][] = [
  [13, 0x26, 0x0c, 1],
  [14, 0x76, 0x0d, 0],
  [16, 0x4a, 0x0f, 0],
  [17, 0x8e, 0x10, 0],
];
export const PERMIT_ZONE = 14;
/** NZ13's door-A man (`$52`, 0E:$B5FF[0]): #20 "SUPER JOE? I'M SORRY,BUT I DON'T KNOW ANYONE NAMED SUPER JOE." (a
 * door talker too; his line says nothing of the door). */
export const NZ13A_Y = 0x24;
/** Room $3E's man (vanilla NZ16 door B): #40 "DON'T BE HASTY. ADVANCE WITH CAUTION." His line travels with the room
 * (patches.ts `setInsideTalkersByRoom`); with hints on he gives a clue in that voice. */
export const HASTY_ROOM = 0x3e;
/** Room $40's informer: the P.O.W.-camp line, as O15's door-B talker says it. */
export const INFORMER_ROOM = 0x40;
/** Wiretaps whose vanilla exchange is between allies (O4A, O10A, O11A: ally portraits); clues there are enemy chatter. */
export const ALLY_WIRES = new Set([0x2c, 0xb2, 0xb8]);
export const ENEMY_SOLDIER = 0x45,
  ENEMY_COMMANDER = 0x49,
  INTERCEPT = 0x40; // message headers (box style + portrait; $40: the radio box, no portrait)
/** O5B's comm-room agent: the Federation spy in an enemy uniform (#33, header $45). */
export const SPY_SLOT = 'O5B';
export const HASTY_Y = 0x4c;
/** O3A's COMMUNICATE (#52 $68) says "WE ARE GOING TO OPEN THE DOOR OF THE BOSS'S ROOM", but Area 3 has no locked door
 * (vanilla bug: the flag setter at 0B:$AFC9 tests $2A twice; docs/rom-notes.md#comm-rooms), unless option "Comm
 * Locks" locks it. */
export const LIES = new Map([['O3A', 3]]);
export const RESTRICTED = { wire: 0, talker: 1, comm: 2 };
/** The comm rooms whose COMMUNICATE opens a locked layout's door (O1A's is the briefing, not a hint slot). */
/** The comm rooms of each layout, in the order met (O6 has none, O7's is cut, O12's are its own). */
export const COMM_ROOMS: Record<number, string> = {
  1: 'AB',
  2: 'A',
  3: 'A',
  4: 'A',
  5: 'AB',
  8: 'AB',
  9: 'A',
  10: 'A',
  11: 'A',
};
export const UNLOCK_ROOMS: Record<number, string[]> = {
  1: ['O1A'],
  2: ['O2A'],
  3: ['O3A'],
  4: ['O4A'],
  5: ['O5A', 'O5B'],
  8: ['O8A', 'O8B'],
  9: ['O9A'],
  10: ['O10A'],
  11: ['O11A'],
};
export const KEY_ITEMS = new Set<Item>([
  'rocket',
  'threeway',
  'flare',
  'permit',
  'iff',
  'flak',
  'joe',
  'alpha',
  'beta',
  'gamma',
  'delta',
]); // comm-locked layouts besides O1 (always α, which the player knows)

export const NAMES: Partial<Record<Item, string>> = {
  rocket: 'ROCKET LAUNCHER',
  wide: 'WIDE CANNON',
  threeway: '3-WAY GUN',
  pendant: 'PENDANT',
  helmet: 'HELMET',
  vest: 'BULLETPROOF VEST',
  flare: 'FLARE',
  pills: 'ENERGY RECOVERY PILLS',
  permit: 'PERMIT',
  boots: 'IRON BOOTS',
  rapid: 'RAPID-FIRE DEVICE',
  flak: 'FLAK MAP',
  alpha: 'α COMMUNICATOR',
  beta: 'β COMMUNICATOR',
  gamma: 'γ COMMUNICATOR',
  delta: 'δ COMMUNICATOR',
  iff: 'IFF CODE',
  machine: 'MACHINE GUN',
};
export const SYMBOL: Partial<Record<Item, string>> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ' };
export const PLURAL = new Set<Item>(['pills', 'boots']);
/** Where an item opens the way: layout (enemy area) or zone layout. */
/** Pseudo map number of the underground-passage stage (flown on either hidden road once the passage is known). */
export const UNDERGROUND = 0;
/** Buildings with ammo or a 1UP (buildings.ts roomContents), listed in a zone's route steps. */
export const AMMO_ROOMS = [0x37, 0x3a, 0x3b, 0x43, 0x44];
export const NEEDED_AT: Partial<Record<Item, number>> = { rocket: 6, threeway: 7, permit: PERMIT_ZONE }; // (and the Flare in each dark area)
export const FLAVOR = [
  'STAY ALERT.\nTHE ENEMY IS EVERYWHERE.',
  "WE'LL CONTACT YOU AGAIN LATER.",
  "GOOD LUCK.\nWE'RE COUNTING ON YOU.",
];
export const WIRE_FLAVOR: [string, string][] = [
  ['ANY NEWS?', 'NOTHING.\nKEEP YOUR EYES OPEN.'],
  ['IS THE BASE SECURE?', 'YES, SIR.\nNOTHING TO REPORT.'],
];
/** The P.O.W.-camp line (#27: NZ15 B's talker and the informer room $40). With hints on it points at the hint slot
 * holding Joe's whereabouts instead of naming his area. */
export const JOE_POINTER_Y = 0x32;
/** Joe's rescue line (vanilla: Destroyer-3 has the Machine Gun). With hints on: the real Destroyer, unless the player
 * already got past them, and which communicator Area 12's agents use. */
export const JOE_RESCUE_Y = 0x5a;

/**
 * How much the hints say. Every level but 'vanilla' and 'nonsense' leads a full path ('vanilla' keeps the vanilla lines,
 * corrected for the seed (story.ts); 'nonsense' is no hints at all, every
 * hint slot, the briefings and Area 12's comm rooms saying lines of nonsense.ts instead); 'terse' says only that (one line per room; item
 * clues about Areas 1-11 45% two-area guesses, 30% by region), 'normal' adds random extras (30% / 10%), 'verbose'
 * fills every line and names areas exactly.
 */
export type HintLevel = 'terse' | 'normal' | 'verbose' | 'vanilla' | 'nonsense';

export interface HintInput {
  locations: Location[];
  placement: Placement;
  rules: Rules;
  /** Map number of a layout, and the layout at a map number. */
  spot: (id: number) => number;
  at: (n: number) => number;
  comms: CommAssignment;
  doors: Map<number, Door>;
  /** What each building item room holds. */
  itemRooms: Map<number, Item>;
  /** The route spoiler's locations, if not `locations` (no hints: an area with a comm room is cleared without its comm
   * in hand; the seed's logic keeps that rule). */
  routeLocations?: Location[];
  /** 'vanilla': only the lines the shuffles made false are rewritten (story.ts, buildings.ts). */
  level: HintLevel;
  /** The real Destroyer's name (the clue for the Destroyer rooms), and where he stands. */
  trust: string;
  trustAt: (typeof DESTROYER_POSITIONS)[number];
  /** The two impostors' names. */
  moles: string[];
  /** Option "Fix Typos": quoted vanilla lines get their comma spaces (typos.ts spaceCommas). */
  typosFixed?: boolean;
  /** Option "Area 12 Door Locks": what opens its doors (patches.ts area12CommLock). */
  area12Locks?: 'none' | 'comms' | 'boss' | 'both';
  /** The door the real Destroyer stands by (his item's room, as the player would expect). */
  trustDoor: 'A' | 'B';
  /** The weapon NZ15's barriers need, if any. */
  nz15?: Item;
  /** The dark layouts (the Flare lights them): 4, and more with option "Dark Areas". */
  dark?: readonly number[];
  /** The comm-locked layouts: 1, 4, 8, and more with option "Comm Locks". */
  locked?: readonly number[];
}

/** Area 12's steps by option "Area 12 Door Locks" (Comm A in $35, Comm B in $36, the officer in $21 behind tower $5F's
 * door 1; power systems 1 and 2 bring its barriers down). */
export function area12Steps(mode: 'none' | 'comms' | 'boss' | 'both'): RouteStep[] {
  const comms = mode === 'comms' || mode === 'both',
    officer = mode === 'boss' || mode === 'both';
  return [
    ...(comms ? [{ act: 'comm', room: 'A', opens: 'powerA' } as const] : []),
    { act: 'destroy', target: 'powerA' },
    ...(mode === 'comms'
      ? [{ act: 'comm', room: 'B', opens: 'powerB' } as const]
      : mode === 'both'
        ? [{ act: 'comm', room: 'B', opens: 'minibossDoor' } as const]
        : []),
    ...(officer ? [{ act: 'defeat', target: 'miniboss', opens: 'powerB' } as const] : []),
    { act: 'destroy', target: 'powerB' },
    { act: 'defeat', target: 'masterD' },
    { act: 'escape' },
  ];
}

export interface HintOutput {
  /** Message number -> text (headers kept). */
  messages: Map<number, string | Message>;
  /** Door talker message Y -> sentence to add after the talker's contents line. */
  talkerAddenda: Map<number, string>;
  spoiler: SpoilerHint[];
  /** The intended route: the steps a player following the clues takes, each with the clue that sent them there. */
  route: RouteVisit[];
  /** Map number of the decoy area on Joe's trail (its boss says he was transferred), if a line names it. */
  trailArea?: number;
  /** Placed lines that only help get something their own slot can't be read without (should be none). */
  circularLines: string[];
  /** Nonsense: the messages that say its lines instead (generate.ts draws them). */
  nonsenseSlots: NonsenseSlot[];
  /** What each hint line tells, by its message Y (a wiretap's: its first), for the simulator. */
  facts: Map<number, Fact[]>;
  /** What Joe's rescue line tells (hints on): Area 12's communicator, and whether it names the real Destroyer. */
  rescueTells?: { comm: Item; trust: boolean };
}

/** Regions by the map's road gates (map numbers never move): before the 6<->8 gate, between it and the 8<->10 gate,
 * and past that (the enemy compound). A region clue names where an item in Areas 1-11 is only by region. */
export type Region = 'west' | 'central' | 'compound';
export const REGION_AREAS: Record<Region, number[]> = {
  west: [1, 2, 3, 4, 5, 6],
  central: [7, 8, 9],
  compound: [10, 11],
};
export const regionOf = (p: number) => (Object.keys(REGION_AREAS) as Region[]).find((r) => REGION_AREAS[r].includes(p));
export const IN_REGION: Record<Region, string> = {
  west: 'IN THE WEST',
  central: 'IN THE CENTRAL REGION',
  compound: 'IN THE ENEMY COMPOUND',
};

export const areaList = (ns: number[]) => {
  const s = [...ns].sort((a, b) => a - b);
  return s.length === 1
    ? `AREA ${s[0]}`
    : `AREAS ${s.slice(0, -1).join(', ')}${s.length > 2 ? ',' : ''} AND ${s[s.length - 1]}`; // (Oxford comma)
};
