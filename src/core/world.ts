// World model: items, locations and what each location requires. See docs/design.md#logic and docs/rom-notes.md#gates-and-roads.
//
// Scope so far: the shuffled locations are the area-clear rewards of Areas 1-11, and Super Joe's rescue is one of
// those "items" (whichever area holds him plays the rescue scene). Building pickups and the passage stage keep their
// vanilla items (they still count for logic). Locations sit at map numbers, reached over the map's roads from map 1:
// the hidden passages need the interrogation (the 'passage' event), and the optional 6<->8 road gate needs its
// requirements. Area 12 needs the configured condition (Joe by default).

export type Item =
  | 'rocket'
  | 'wide'
  | 'machine'
  | 'threeway'
  | 'pendant'
  | 'helmet'
  | 'vest'
  | 'flare'
  | 'pills'
  | 'permit'
  | 'boots'
  | 'rapid'
  | 'alpha'
  | 'beta'
  | 'gamma'
  | 'delta'
  | 'joe'
  | 'oneup'
  | 'iff' // randomizer key item for the 6<->8 road gate (no equipment slot): captured enemy IFF code
  | 'flak' // randomizer key item for the 8<->10 road gate (no equipment slot): a map of the enemy's flak positions
  | 'passage'; // event: the underground passage was revealed (interrogation room, sets $04F7)

export interface ItemInfo {
  name: string;
  /** Offset from $04CA of the inventory byte set when received; 0 = extra life (area-clear 1UP). */
  inventory: number;
  /** Offset of the item's name in the area-clear text block (0A:$B17B + offset), if the game has one. */
  clearText?: number;
}

/**
 * Area-clear names the vanilla name block lacks (it is full). Their offsets (>= $96) only identify them now: with any
 * of them in play the clear screen reads every name from bank 0B (clearscreen.ts).
 */
export const CLEAR_NAMES: Partial<Record<Item, { text: string; offset: number }>> = {
  alpha: { text: 'α COMMUNICATOR', offset: 0x96 },
  beta: { text: 'β COMMUNICATOR', offset: 0xa5 },
  gamma: { text: 'γ COMMUNICATOR', offset: 0xb4 },
  iff: { text: 'IFF CODE', offset: 0xc3 },
  flak: { text: 'FLAK MAP', offset: 0xcc }, // $CC-$D4
  delta: { text: 'δ COMMUNICATOR', offset: 0xd9 },
  flare: { text: 'FLARE', offset: 0xe8 },
};
const name = (i: Item) => CLEAR_NAMES[i]!.offset;

export const ITEMS: Record<Item, ItemInfo> = {
  rocket: { name: 'Rocket Launcher', inventory: 0x02, clearText: 0x20 },
  wide: { name: 'Wide Cannon', inventory: 0x03, clearText: 0x14 },
  machine: { name: 'Machine Gun', inventory: 0x04 },
  threeway: { name: '3-Way Gun', inventory: 0x05, clearText: 0x47 },
  pendant: { name: 'Pendant', inventory: 0x08, clearText: 0x0c },
  helmet: { name: 'Helmet', inventory: 0x09, clearText: 0x62 },
  vest: { name: 'Bulletproof Vest', inventory: 0x0a, clearText: 0x4d },
  flare: { name: 'Flare', inventory: 0x0f, clearText: name('flare') },
  pills: { name: 'Energy Recovery Pills', inventory: 0x10, clearText: 0x7b },
  permit: { name: 'Permit', inventory: 0x11, clearText: 0x74 },
  boots: { name: 'Iron Boots', inventory: 0x12, clearText: 0x69 },
  rapid: { name: 'Rapid-Fire Device', inventory: 0x13, clearText: 0x30 },
  alpha: { name: 'α Communicator', inventory: 0x16, clearText: name('alpha') },
  beta: { name: 'β Communicator', inventory: 0x17, clearText: name('beta') },
  gamma: { name: 'γ Communicator', inventory: 0x18, clearText: name('gamma') },
  delta: { name: 'δ Communicator', inventory: 0x19, clearText: name('delta') },
  joe: { name: 'Super Joe', inventory: -1 },
  oneup: { name: '1UP', inventory: 0, clearText: 0x91 },
  // Flag $04F8 (unused by the game, cleared by a new game, kept on continue); name via the 0A:$BFA0 helper (patches.ts).
  iff: { name: 'IFF Code', inventory: 0x2e, clearText: name('iff') },
  // Inventory offset $1A ($04E4, an unused comm slot) never gets written: a hook stores the Flak Map in $01D3 instead
  // (patches.ts `addFlakMap`; no reachable free byte in $04CA-$05C9 survives a continue).
  flak: { name: 'Flak Map', inventory: 0x1a, clearText: name('flak') },
  passage: { name: 'Underground passage revealed', inventory: -1 },
};

export const START_ITEMS: Item[] = ['alpha']; // plus the normal gun, which gates nothing

export interface State {
  has(item: Item): boolean;
}

export interface Location {
  id: string;
  name: string;
  /** Map node (area identity = layout) whose clear grants this (area-clear locations only). */
  areaClear?: number;
  /** Map number where that layout sits (differs from `areaClear` under the area layout shuffle). */
  mapNumber?: number;
  /** Map numbers the location can be reached from (any one will do). */
  at: number[];
  vanilla: Item;
  /** Shuffled by the generator (otherwise it keeps `vanilla`). */
  shuffled: boolean;
  requires: (s: State) => boolean;
  /** Which items the location can hold (default: any). */
  accepts?: (item: Item) => boolean;
}

const free = () => true;

export const COMM_ITEMS: readonly Item[] = ['alpha', 'beta', 'gamma', 'delta'];
/** Vanilla communicator per area layout 1-12 (index 0 unused): α 1,4,5 · β 2,3,6 · γ 7,8,9 · δ 10,11,12. */
export const VANILLA_COMMS: readonly Item[] = [
  'alpha',
  'alpha',
  'beta',
  'beta',
  'alpha',
  'alpha',
  'beta',
  'gamma',
  'gamma',
  'gamma',
  'delta',
  'delta',
  'delta',
];
/** Layouts with a comm room that can give a message (6 has none, 7's is empty, 12's are endgame story). */
export const HINT_COMM_AREAS: readonly number[] = [1, 2, 3, 4, 5, 8, 9, 10, 11];

/**
 * Requirements to clear each area layout, given which communicator each layout uses (`commOf`). `fair` (the logic's
 * default) adds the route's rules; without it, only what the game itself enforces (`requiredItems` for path depth).
 * The dark areas (`dark`: layout 4, and more with option "Dark Areas") need the Flare only with True Dark
 * (`trueDark`); otherwise they're playable dim, and the Flare is a route rule like a comm in hand.
 * `locked`: the comm-locked layouts (O1, O4, O8, and more with option "Comm Locks"): their comm is a true requirement.
 */
export function areaClearRequires(
  n: number,
  commOf: (id: number) => Item = (id) => VANILLA_COMMS[id],
  fair = true,
  trueDark = false,
  dark: readonly number[] = [4],
  locked: readonly number[] = VANILLA_LOCKED,
  commInHand = true,
): (s: State) => boolean {
  const layout = layoutRequires(n, commOf, locked);
  const rest = trueDark && dark.includes(n) ? (s: State) => s.has('flare') && layout(s) : layout;
  if (!fair) return rest;
  // the route never sends the player into an area with a comm room without its communicator (playtest),
  // nor into a dark area without the Flare
  // (`commInHand` false with no hints, None and Nonsense: the comm rooms say nothing the player needs)
  const comm = commInHand && n <= 11 && HINT_COMM_AREAS.includes(n),
    flare = dark.includes(n);
  if (!comm && !flare) return rest;
  return (s) => (!comm || s.has(commOf(n))) && (!flare || s.has('flare')) && rest(s);
}

/** The vanilla comm-locked layouts: O1's door to its second half, O4's boss door, O8's (two comm rooms). */
export const VANILLA_LOCKED: readonly number[] = [1, 4, 8];

function layoutRequires(n: number, commOf: (id: number) => Item, locked: readonly number[]): (s: State) => boolean {
  if (locked.includes(n)) return (s) => s.has(commOf(n)); // a comm-locked door: COMMUNICATE in the comm room(s)
  switch (n) {
    case 6:
      return (s) => s.has('rocket'); // barrier only the Rocket Launcher breaks
    case 7:
      return (s) => s.has('threeway'); // barrier only the 3-Way Gun breaks
    default:
      return free;
  }
}

const VANILLA_CLEAR: Record<number, Item> = {
  1: 'pills',
  2: 'pendant',
  3: 'rapid',
  4: 'wide',
  5: 'rocket',
  6: 'permit',
  7: 'joe',
  8: 'boots',
  9: 'threeway',
  10: 'oneup',
  11: 'vest',
};

/** Map node of a neutral-zone level room ($0C-$12 -> 13-19). */
export const zoneNode = (zoneRoom: number) => zoneRoom + 1;

/**
 * What it takes to get through a neutral-zone door: NZ14's permit guard blocks both of its doors; with `nz15`, NZ15's
 * barriers before door B need that weapon (patches.ts `setBarrierWeapons`; vanilla: any shot clears them).
 */
export function doorRequires(zoneRoom: number, slot = 0, nz15?: Item): (s: State) => boolean {
  if (zoneRoom === 0x0d) return (s) => s.has('permit');
  if (zoneRoom === 0x0e && slot === 1 && nz15) return (s) => s.has(nz15);
  return free;
}

/** Building rooms that hold an item location (their pickup slot), with the vanilla item. */
export const ITEM_ROOMS: Record<number, Item> = {
  0x38: 'flare',
  0x39: 'gamma',
  0x3c: 'delta',
  0x3d: 'beta',
  0x44: 'oneup',
};

/** Items a building pickup can show and give (pickups.ts has an icon for each). The 1UP stays where it is a 1UP
 * object in vanilla (NZ19 B). The Machine Gun has no clear-screen name (bank 0A is full), so it's pickup-only. */
export const PICKUP_ITEMS: ReadonlySet<Item> = new Set<Item>([
  'rocket',
  'wide',
  'machine',
  'threeway',
  'pendant',
  'helmet',
  'vest',
  'flare',
  'pills',
  'permit',
  'boots',
  'rapid',
  'alpha',
  'beta',
  'gamma',
  'delta',
  'iff',
  'flak',
]);
export const PASSAGE_ROOM = 0x3f;
/** Set when the passage room is entered: the underground passage is revealed. */
export const PASSAGE_FLAG = 0x04f7;
/** NZ19 B, whose 1UP the Flak Map replaces. */
export const FLAK_ROOM = 0x44;
export const DESTROYER_ROOMS = [0x41, 0x42];

export interface DoorRef {
  zone: number;
  slot: number;
}
/** Name of a zone by map number, always with its layout (O-number): "NZ15 (O15)" or "NZ15 (O13)". */
export const zoneName = (node: number, spotOf: (id: number) => number = (id) => id) => `NZ${spotOf(node)} (O${node})`;
/** "NZ15 door B (O15)", or with `what` "NZ15 door B room (O13)": the layout note stays last. */
export const doorName = (d: DoorRef, spotOf?: (id: number) => number, what = '') =>
  zoneName(zoneNode(d.zone), spotOf).replace(' (', ` door ${d.slot ? 'B' : 'A'}${what ? ` ${what}` : ''} (`);

/**
 * `spotOf(identity)` = map number showing that area's layout (identity when areas aren't shuffled). `extra` (a
 * randomizer key item) takes the 1UP's place in the area-clear pool. `shuffleBuildingItems` puts the building item
 * rooms (ITEM_ROOMS) and the underground-passage stage into the shuffle. `commOf` = the communicator each layout uses (vanilla by default).
 */
export function buildLocations(
  doors?: Map<number, DoorRef>,
  spotOf: (id: number) => number = (id) => id,
  extra?: Item,
  shuffleBuildingItems = false,
  commOf?: (id: number) => Item,
  flak = false,
  {
    nz15,
    destroyer = false,
    fair = true,
    trueDark = false,
    dark = [4],
    locked = VANILLA_LOCKED,
    commInHand = true,
  }: {
    nz15?: Item;
    destroyer?: boolean;
    fair?: boolean;
    trueDark?: boolean;
    dark?: readonly number[];
    locked?: readonly number[];
    commInHand?: boolean;
  } = {},
): Location[] {
  const doorOf = (room: number): DoorRef =>
    doors?.get(room) ?? { zone: 0x0c + ((room - 0x37) >> 1), slot: (room - 0x37) & 1 };
  const locs: Location[] = [];
  for (let n = 1; n <= 11; n++) {
    locs.push({
      id: `clear${n}`,
      name: `Area ${spotOf(n)} clear (O${n})`,
      areaClear: n,
      mapNumber: spotOf(n),
      vanilla: extra && VANILLA_CLEAR[n] === 'oneup' ? extra : VANILLA_CLEAR[n], // `extra` replaces the 1UP
      shuffled: true,
      at: [spotOf(n)],
      requires: areaClearRequires(n, commOf, fair, trueDark, dark, locked, commInHand),
      accepts: (i) => i === 'joe' || ITEMS[i].clearText !== undefined, // the clear screen names what you got
    });
  }
  // Building pickups: the requirement is that of the door the room ended up behind. NZ15's barriers (before its door
  // B) vanish as soon as you fire any weapon in the zone (playtest), so they need nothing.
  for (const [room, original] of Object.entries(ITEM_ROOMS)) {
    const d = doorOf(Number(room));
    const item = flak && Number(room) === FLAK_ROOM ? 'flak' : original; // the Flak Map takes NZ19 B's 1UP
    locs.push({
      id: `room${Number(room).toString(16)}`,
      name: doorName(d, spotOf, 'room'),
      vanilla: item,
      shuffled: shuffleBuildingItems,
      at: [spotOf(zoneNode(d.zone))],
      requires: doorRequires(d.zone, d.slot, nz15),
      accepts: (i) => PICKUP_ITEMS.has(i) || i === item, // (a vanilla 1UP stays a 1UP object)
    });
  }
  // The Destroyers' rooms (both pay out the same item after YES to the real one; destroyers.ts). Shuffled, they take
  // any pickup item.
  locs.push({
    id: 'destroyer',
    name: `Destroyer rooms, ${zoneName(18, spotOf)}`,
    vanilla: 'machine',
    shuffled: destroyer,
    at: [spotOf(18)],
    requires: free,
    accepts: (i) => PICKUP_ITEMS.has(i),
  });
  // Entering the passage room (wherever it now is) reveals the underground passage ($04F7).
  const pd = doorOf(PASSAGE_ROOM);
  locs.push({
    id: 'interrogation',
    name: `Interrogation room, ${doorName(pd, spotOf)}`,
    vanilla: 'passage',
    shuffled: false,
    at: [spotOf(zoneNode(pd.zone))],
    requires: doorRequires(pd.zone, pd.slot, nz15),
  });
  // The underground-passage stage sits on both hidden passage roads (14<->17, 15<->18), which open with the passage.
  // Its pickup (vanilla Helmet) joins the shuffle with the building items (pickups.ts `placePassageItem`).
  locs.push({
    id: 'passage',
    name: 'Underground passage',
    vanilla: 'helmet',
    shuffled: shuffleBuildingItems,
    at: [14, 15, 17, 18],
    requires: (s) => s.has('passage'),
    accepts: (i) => PICKUP_ITEMS.has(i),
  });
  // The Flak Map waits beyond the 6<->8 crossing (playtest: finding it in the first region felt off), so the route
  // goes crossing first, then the flight to 10.
  if (flak) {
    for (const l of locs) {
      if (l.at.every((m) => EAST_SIDE.includes(m))) continue;
      const was = l.accepts;
      l.accepts = (i) => i !== 'flak' && (was?.(i) ?? true);
    }
  }
  // Joe waits past the first region too (playtest: rescuing him in the very first area felt off): beyond the crossing
  // or the Flak Map's road.
  for (const l of locs) {
    if (l.at.every((m) => JOE_SIDE.includes(m))) continue;
    const was = l.accepts;
    l.accepts = (i) => i !== 'joe' && (was?.(i) ?? true);
  }
  return locs;
}

/** Map numbers past the first region, where Joe (and the boss who says he was moved) can be. */
export const JOE_SIDE: readonly number[] = [7, 8, 9, 10, 11, 17, 18, 19];

/** 'vanilla': Areas 10 & 11 cleared, Joe or not. */
export type Area12Condition = 'joe' | 'joe+10+11' | 'vanilla';
export const area12NeedsJoe = (c: Area12Condition) => c !== 'vanilla';
export const area12Needs1011 = (c: Area12Condition) => c !== 'joe';

/** Map numbers east of the 6<->8 crossing, short of the Flak Map's road (the passage roads need the interrogation
 * room, which is kept east too). */
export const EAST_SIDE: readonly number[] = [7, 8, 9, 17, 18, 19];

/**
 * Map roads between map numbers, from the vanilla road lists (0D:$A760; map numbers are fixed, layouts move). All are
 * two-way. 'passage' roads need the underground passage revealed; 'gate' is the 6<->8 road gate when enabled; 'flak'
 * is the 8<->10 road (the only way to 10, 11 and 12), which needs the Flak Map when enabled.
 */
export const ROADS: [number, number, ('passage' | 'gate' | 'flak')?][] = [
  [0, 1],
  [1, 13],
  [1, 4],
  [2, 16],
  [2, 5],
  [2, 3],
  [3, 6],
  [4, 15],
  [4, 5],
  [5, 6],
  [5, 16],
  [5, 15],
  [6, 8, 'gate'],
  [6, 14],
  [7, 8],
  [7, 18],
  [8, 10, 'flak'],
  [8, 19],
  [8, 9],
  [9, 17],
  [10, 12],
  [10, 11],
  [11, 12],
  [14, 17, 'passage'],
  [15, 18, 'passage'],
];

/** Where each map number sits on the map screen (in grid steps between neighbors; Area 10 and 12 a half step up, 11
 * and 12 a half step right of 19's column), for road lengths: the 6<->8 diagonal is the longest road. */
export const MAP_XY: Record<number, [number, number]> = {
  0: [0, 3],
  1: [0, 1],
  13: [0, 0],
  4: [1, 0],
  15: [2, 0],
  16: [1, 1],
  5: [2, 1],
  2: [1, 2],
  3: [1, 3],
  6: [2, 3],
  14: [3, 3],
  7: [3, 0],
  18: [3, 1],
  8: [4, 1],
  9: [4, 2],
  17: [4, 3],
  19: [5, 2],
  10: [4, -0.5],
  12: [5.5, -0.5],
  11: [5.5, 1],
};
/** Travel distances from map number `from` along the roads `open` allows (each road as long as it is on the map). */
export function roadDistances(
  from: number,
  open: (kind?: 'passage' | 'gate' | 'flak') => boolean,
): Map<number, number> {
  // (one exception; from 8, NZ19 is a quick grab though its road is a diagonal: it counts as nearer than
  // Area 9, so a player at 8 swings by it first)
  const len = (a: number, b: number) =>
    (a === 8 && b === 19) || (a === 19 && b === 8)
      ? 0.95
      : Math.hypot(MAP_XY[a][0] - MAP_XY[b][0], MAP_XY[a][1] - MAP_XY[b][1]);
  const d = new Map([[from, 0]]),
    done = new Set<number>();
  for (;;) {
    let x: number | undefined;
    for (const [n, v] of d) if (!done.has(n) && (x === undefined || v < d.get(x)!)) x = n;
    if (x === undefined) return d;
    done.add(x);
    for (const [a, b, kind] of ROADS) {
      if ((a !== x && b !== x) || !open(kind)) continue;
      const y = a === x ? b : a,
        v = d.get(x)! + len(a, b);
      if (!d.has(y) || v < d.get(y)!) d.set(y, v);
    }
  }
}

/** Road-gate requirement: these map numbers cleared and these items owned. */
export interface GateRequirement {
  areas: number[];
  items: Item[];
}
export const GATE_PRESETS: Record<string, GateRequirement | undefined> = {
  iff: { areas: [], items: ['iff'] }, // the IFF Code, which takes the 1UP's place in the reward pool
  vanilla: { areas: [3, 6], items: ['gamma'] }, // vanilla 6->8: Areas 3 and 6 cleared, own γ
  open: undefined,
};
/** The 8<->10 road (the only way to 10, 11 and 12). */
export const GATE10_PRESETS: Record<string, GateRequirement | undefined> = {
  flak: { areas: [], items: ['flak'] }, // the Flak Map, which takes NZ19 B's 1UP
  vanilla: { areas: [7], items: ['delta'] }, // vanilla 8->10: map 7 cleared (Joe's area in vanilla), own δ
  open: undefined,
};

export interface Rules {
  area12: Area12Condition;
  gate?: GateRequirement;
  /** The Flak Map exists (it's the 8<->10 gate's item). */
  flak?: boolean;
  /** The 8<->10 road's requirement. */
  gate10?: GateRequirement;
  /** Area 12's communicator, when its power system doors need it (option "Area 12 Door Locks": Comms or Both). */
  area12Comm?: Item;
}

/** Map numbers reachable from the start (map 1) given what's owned and cleared. */
export function reachableMap(
  s: State,
  cleared: Set<number>,
  gate?: GateRequirement,
  gate10?: GateRequirement,
): Set<number> {
  const met = (g?: GateRequirement) => !g || (g.areas.every((m) => cleared.has(m)) && g.items.every((i) => s.has(i)));
  const open = (kind?: 'passage' | 'gate' | 'flak') =>
    kind === 'passage' ? s.has('passage') : kind === 'gate' ? met(gate) : kind === 'flak' ? met(gate10) : true;
  const seen = new Set([1]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b, kind] of ROADS) {
      if (seen.has(a) === seen.has(b) || !open(kind)) continue;
      seen.add(a);
      seen.add(b);
      grew = true;
    }
  }
  return seen;
}

/**
 * Can the player enter (and therefore beat) Area 12? `cleared` holds map numbers (the condition names displayed areas);
 * `map` is the set of reachable map numbers.
 */
export function canFinish(
  s: State,
  cleared: Set<number>,
  condition: Area12Condition,
  map: Set<number>,
  comm?: Item,
): boolean {
  if ((area12NeedsJoe(condition) && !s.has('joe')) || !map.has(12) || (comm && !s.has(comm))) return false;
  return !area12Needs1011(condition) || (cleared.has(10) && cleared.has(11));
}
