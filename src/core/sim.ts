// The seed simulator (in the style of z3rsim, ALttPR's): a generated seed as places and what can be done at
// each, played without the game. Travel is free: any place the open roads reach can be visited. Doing something there
// gives an item, or a line that teaches something (hints.ts facts), or shows what it takes. The player sees only what
// they would know; the brute-force moves (a dark area cleared without the Flare, a Destroyer guessed) are explicit.
// This module is data and rules only; the page (main.ts) says it in words.

import { DESTROYER_POSITIONS } from './destroyers.ts';
import {
  area12Steps,
  COMM_ROOMS,
  UNLOCK_ROOMS,
  type Fact,
  HASTY_ROOM,
  HASTY_Y,
  INFORMER_ROOM,
  JOE_POINTER_Y,
  JOE_RESCUE_Y,
  NZ13A_Y,
  PERMIT_ZONE,
  ROOM_SLOTS,
  TALKERS,
} from './hintdata.ts';
import { BRIEFING_Y, STATIC_Y } from './nonsense.ts';
import type { Door } from './patches/buildingdoors.ts';
import { stepText } from './routetext.ts';
import { messageForY, readMessage } from './text.ts';
import {
  area12Needs1011,
  area12NeedsJoe,
  COMM_ITEMS,
  DESTROYER_ROOMS,
  doorRequires,
  type Item,
  type Location,
  PASSAGE_ROOM,
  reachableMap,
  type Rules,
  START_ITEMS,
  type State,
} from './world.ts';

/** The underground-passage stage's place (map numbers are 0-19). */
export const PASSAGE = 20;
/** Joe's rescue scene: his answer (#109, #46, #110) and his tip (#47); blank ones aren't shown. */
const RESCUE_Y = [0xd6, 0x58, 0xd8, JOE_RESCUE_Y];
/** What the real Destroyer says after YES (destroyers.ts REAL_YES_Y). */
const REAL_YES_Y = 0xa6;
/** Each man's opening line by talk script: the real one's 4, the impostors' 6 and 7 (destroyers.ts). */
const DESTROYER_INTRO_Y: Record<number, number> = { 4: 0xa2, 6: 0x9c, 7: 0xa0 };

export type SimActionKind =
  | 'comm'
  | 'wiretap'
  | 'talk'
  | 'room'
  | 'clear'
  | 'destroyer'
  | 'passage'
  | 'step'
  | 'finish';

/** One thing to do at a place. */
export interface SimAction {
  id: string;
  kind: SimActionKind;
  /** The comm room (comm, wiretap) or the building door (talk, room). */
  room?: 'A' | 'B';
  door?: 'A' | 'B';
  /** The man inside the building, not the one at its door. */
  inside?: boolean;
  /** A Destroyer: where he stands and his name. */
  man?: { position: (typeof DESTROYER_POSITIONS)[number]; name: string; real: boolean };
  /** A room with no item location: its ammo or 1UP, or the prisoner (the passage). */
  bullets?: number;
  prisoner?: boolean;
  /** The messages shown, by number, in order. */
  says: number[];
  /** The item location it takes (its item is the seed's). */
  location?: string;
  /** What it takes, as the game enforces it (comm rooms: carrying the area's communicator is checked apart). */
  requires: (s: State, cleared: Set<number>) => boolean;
  /** What its lines tell (hint levels with facts). */
  teaches: Fact[];
  /** Area 12's steps: what it's called, and the step it comes after. */
  label?: string;
  after?: string;
}

export interface SimPlace {
  n: number;
  kind: 'start' | 'area' | 'zone' | 'passage';
  /** The layout there (O-number; a zone's is its zone's). */
  layout?: number;
  /** An area's communicator, and whether it has a comm room at all (O6, O7 have none). */
  comm?: Item;
  commRoom?: boolean;
  /** Dark past its start (the Flare lights it). */
  dark?: boolean;
  /** A comm-locked area: the comm rooms whose COMMUNICATE opens its door (the clear needs them done), and the comm rooms
   * behind that door (O1's: its door is to the second half, comm room B's). */
  unlock?: ('A' | 'B')[];
  behindLock?: ('A' | 'B')[];
  /** A zone that takes something to get into at all (NZ14's Permit guard). */
  entry?: Item;
  actions: SimAction[];
}

export interface SimSeed {
  places: Map<number, SimPlace>;
  rules: Rules;
  /** True Dark: a dark area can't be cleared without the Flare (no brute force). */
  trueDark: boolean;
  /** Item at each location. */
  placement: Map<string, Item>;
  /** A message's text as the ROM says it, rows of the game's box, pages apart. */
  text: (message: number) => string;
  /** The wrong communicator's static (#49). */
  staticMessage: number;
  /** The opening briefing (#125, #126; one message with Nonsense hints). */
  briefing: number[];
  /** The area the briefing sends the player to (its agents are on α), unless the briefing names none (Nonsense). */
  briefingArea?: number;
  /** The impostors' names (a mole fact names one by index) and the real one's. */
  moles: string[];
  realDestroyer: string;
  /** The men say their names (not with Nonsense hints: they go by where they stand). */
  namedDestroyers: boolean;
  rescueTells?: { comm: Item; trust: boolean };
}

export interface SimInput {
  rom: Uint8Array;
  rules: Rules;
  /** The locations with the game's own requirements (no route rules). */
  locations: Location[];
  placement: Map<string, Item>;
  layout: Map<number, number>;
  comms: readonly Item[];
  doors: Map<number, Door>;
  itemRooms: Map<number, Item>;
  dark: readonly number[];
  trueDark: boolean;
  /** The comm-locked layouts. */
  locked: readonly number[];
  nz15?: Item;
  /** Option "Area 12 Door Locks". */
  area12Locks: 'none' | 'comms' | 'boss' | 'both';
  destroyers?: { names: string[]; real: number };
  namedDestroyers: boolean;
  /** The briefing names Area 1's layout's map number (not with Nonsense hints). */
  briefingNamesArea: boolean;
  facts: Map<number, Fact[]>;
  rescueTells?: { comm: Item; trust: boolean };
}

/** The Destroyers left to right: by door A, then left and right of door B (A, B1, B2). */
export const MAN_ORDER: Record<(typeof DESTROYER_POSITIONS)[number], number> = {
  'by door A': 0,
  'left of door B': 1,
  'right of door B': 2,
};
export const MAN_SPOT: Record<(typeof DESTROYER_POSITIONS)[number], string> = {
  'by door A': 'A',
  'left of door B': 'B1',
  'right of door B': 'B2',
};

/** Ammo and 1UP rooms (buildings.ts roomContents). */
const AMMO: Record<number, number> = { 0x37: 1, 0x3a: 11, 0x43: 4 };

export function buildSim(input: SimInput): SimSeed {
  const { rom, rules, locations, placement, comms, doors, itemRooms, dark, nz15, facts } = input;
  const at = (n: number) => input.layout.get(n) ?? n;
  const loc = (id: string) => locations.find((l) => l.id === id);
  const free = () => true;
  const teaches = (y: number) => facts.get(y) ?? [];
  const places = new Map<number, SimPlace>();
  places.set(0, { n: 0, kind: 'start', actions: [] });

  // enemy areas: COMMUNICATE and the wiretaps of each comm room, then the clear
  for (let n = 1; n <= 11; n++) {
    const layout = at(n),
      clear = loc(`clear${layout}`)!;
    const rooms = COMM_ROOMS[layout] ?? '';
    const actions: SimAction[] = [];
    for (const room of rooms) {
      const comm = ROOM_SLOTS.find(([id, l, k]) => l === layout && k === 'comm' && id === `O${layout}${room}`);
      const ys = layout === 1 && room === 'A' ? [0x14, 0x16] : comm ? comm[3] : []; // (O1A's: the briefing's agents, #12 going on in #13)
      if (ys.length)
        actions.push({
          id: `comm${room}`,
          kind: 'comm',
          room: room as 'A' | 'B',
          says: ys.map(messageForY),
          requires: free,
          teaches: teaches(ys[0]),
        });
      const wire = ROOM_SLOTS.find(([id, l]) => l === layout && id === `O${layout}${room} wiretap`);
      if (wire)
        actions.push({
          id: `wire${room}`,
          kind: 'wiretap',
          room: room as 'A' | 'B',
          says: wire[3].map(messageForY),
          requires: free,
          teaches: teaches(wire[3][0]),
        });
    }
    const joe = placement.get(clear.id) === 'joe';
    actions.push({
      id: 'clear',
      kind: 'clear',
      location: clear.id,
      says: joe ? RESCUE_Y.map(messageForY) : [],
      requires: (s) => clear.requires(s),
      teaches: [],
    });
    const unlock = input.locked.includes(layout)
      ? (UNLOCK_ROOMS[layout] ?? []).map((id) => id.slice(-1) as 'A' | 'B')
      : undefined;
    places.set(n, {
      n,
      kind: 'area',
      layout,
      comm: comms[layout],
      commRoom: rooms.length > 0,
      dark: dark.includes(layout),
      ...(unlock?.length && { unlock, ...(layout === 1 && { behindLock: ['B' as const] }) }),
      actions,
    });
  }
  // Area 12: in only with what its entry takes (Joe, Areas 10 and 11 cleared), then its steps in order (the route's, by
  // option "Area 12 Door Locks": its comm rooms open the power systems' doors with its communicator), the last the escape
  const entry = (s: State, cleared: Set<number>) =>
    (!area12NeedsJoe(rules.area12) || s.has('joe')) &&
    (!area12Needs1011(rules.area12) || (cleared.has(10) && cleared.has(11)));
  // Its comm rooms as any area's (A's COMMUNICATE #96 and wiretap #97/#98; B's, past the first barrier, #99 and #100/#101):
  // with its door locks their COMMUNICATE is the step that opens a power system's door
  const steps = area12Steps(input.area12Locks),
    a12: SimAction[] = [];
  const COMM12 = { A: [0xbc], B: [0xc2] },
    WIRE12 = { A: [0xbe, 0xc0], B: [0xc4, 0xc6] };
  const room12 = (room: 'A' | 'B', after?: string): SimAction[] => [
    ...(steps.some((x) => x.act === 'comm' && x.room === room)
      ? []
      : [
          {
            id: `comm${room}`,
            kind: 'comm' as const,
            room,
            says: COMM12[room].map(messageForY),
            teaches: [],
            requires: entry,
            ...(after && { after }),
          },
        ]),
    {
      id: `wire${room}`,
      kind: 'wiretap',
      room,
      says: WIRE12[room].map(messageForY),
      teaches: [],
      requires: entry,
      ...(after && { after }),
    },
  ];
  let prev: string | undefined, powerA: string | undefined;
  steps.forEach((step, i) => {
    const last = i === steps.length - 1;
    if (step.act === 'comm') {
      a12.push({
        id: `comm${step.room}`,
        kind: 'comm',
        room: step.room,
        label: stepText(step).text.replace(/^Comm /, 'Communicate '),
        says: COMM12[step.room].map(messageForY),
        teaches: [],
        requires: entry,
        ...(prev && { after: prev }),
      });
      prev = `comm${step.room}`;
      if (step.room === 'A') a12.push(...room12('A').filter((x) => x.kind === 'wiretap'));
      else a12.push(...room12('B', powerA).filter((x) => x.kind === 'wiretap'));
      return;
    }
    if (i === 0) a12.push(...room12('A'));
    const id = last ? 'finish' : `step${i}`;
    a12.push({
      id,
      kind: last ? 'finish' : 'step',
      label: stepText(step).text,
      says: [],
      teaches: [],
      requires: entry,
      ...(prev && { after: prev }),
    });
    prev = id;
    if (step.act === 'destroy' && step.target === 'powerA') {
      powerA = id;
      if (!steps.some((x) => x.act === 'comm' && x.room === 'B')) a12.push(...room12('B', id));
    }
  });
  places.set(12, { n: 12, kind: 'area', layout: 12, comm: comms[12], commRoom: true, actions: a12 });

  // neutral zones: the talkers outside, then each door's room (what's in it, or who)
  for (let n = 13; n <= 19; n++) {
    const layout = at(n),
      zoneRoom = layout - 1,
      actions: SimAction[] = [];
    const doorOf = (slot: number) => (slot ? 'B' : 'A') as 'A' | 'B';
    const talker = (y: number, slot: number) => ({
      kind: 'talk' as const,
      door: doorOf(slot),
      says: [messageForY(y)],
      teaches: teaches(y),
      requires: (s: State) => doorRequires(zoneRoom, slot, nz15)(s),
    });
    if (layout === 13) actions.push({ id: 'talkA0', ...talker(NZ13A_Y, 0) });
    for (const [l, y, , slot] of TALKERS)
      if (l === layout) actions.push({ id: `talk${doorOf(slot)}`, ...talker(y, slot) });
    if (layout === 15) actions.push({ id: 'talkB', ...talker(JOE_POINTER_Y, 1) }); // (O15's door-B talker: the P.O.W.-camp line)
    for (const slot of [0, 1]) {
      const room = [...doors].find(([, d]) => d.zone === zoneRoom && d.slot === slot)?.[0];
      if (room === undefined) continue;
      const door = doorOf(slot),
        requires = (s: State) => doorRequires(zoneRoom, slot, nz15)(s);
      const item = itemRooms.get(room);
      if (item !== undefined)
        actions.push({
          id: `room${door}`,
          kind: 'room',
          door,
          location: `room${room.toString(16)}`,
          says: [],
          requires,
          teaches: [],
        });
      else if (room === HASTY_ROOM)
        actions.push({
          id: `inside${door}`,
          kind: 'talk',
          door,
          inside: true,
          says: [messageForY(HASTY_Y)],
          requires,
          teaches: teaches(HASTY_Y),
        });
      else if (room === INFORMER_ROOM)
        actions.push({
          id: `inside${door}`,
          kind: 'talk',
          door,
          inside: true,
          says: [messageForY(JOE_POINTER_Y)],
          requires,
          teaches: teaches(JOE_POINTER_Y),
        });
      else if (room === PASSAGE_ROOM)
        actions.push({
          id: `room${door}`,
          kind: 'room',
          door,
          prisoner: true,
          location: 'interrogation',
          says: [],
          requires,
          teaches: [],
        });
      else if (AMMO[room])
        actions.push({ id: `room${door}`, kind: 'room', door, bullets: AMMO[room], says: [], requires, teaches: [] });
      else if (room === 0x3b || room === 0x44)
        actions.push({ id: `room${door}`, kind: 'room', door, says: [], requires, teaches: [] }); // (a 1UP)
    }
    // the three men outside the Destroyers' rooms: YES to the real one pays out the rooms' item
    if ([...doors].some(([room, d]) => DESTROYER_ROOMS.includes(room) && d.zone === zoneRoom)) {
      const names = input.destroyers?.names ?? ['DESTROYER-1', 'DESTROYER-2', 'DESTROYER-3'],
        real = input.destroyers?.real ?? 2;
      const impostor = [6, 7]; // (the impostors' scripts, in position order: destroyers.ts applyDestroyers)
      names.forEach((name, i) => {
        const script = i === real ? 4 : impostor.shift()!;
        actions.push({
          id: `yes${i}`,
          kind: 'destroyer',
          man: { position: DESTROYER_POSITIONS[i], name, real: i === real },
          says: [messageForY(DESTROYER_INTRO_Y[script]), ...(i === real ? [messageForY(REAL_YES_Y)] : [])],
          location: i === real ? 'destroyer' : undefined,
          requires: free,
          teaches: [],
        });
      });
    }
    // (by door, as the route lists them: door A's talker outside, its room, the man inside; then door B's; the Destroyers last)
    const order = (x: SimAction) =>
      x.kind === 'destroyer'
        ? 10 + MAN_ORDER[x.man!.position]
        : (x.door === 'B' ? 3 : 0) + (x.kind === 'room' ? 1 : x.inside ? 2 : 0);
    actions.sort((x, y) => order(x) - order(y));
    places.set(n, { n, kind: 'zone', layout, ...(layout === PERMIT_ZONE && { entry: 'permit' as Item }), actions });
  }
  places.set(PASSAGE, {
    n: PASSAGE,
    kind: 'passage',
    actions: [{ id: 'clear', kind: 'passage', location: 'passage', says: [], requires: free, teaches: [] }],
  });

  const realName = input.destroyers ? input.destroyers.names[input.destroyers.real] : 'DESTROYER-3';
  return {
    places,
    rules,
    trueDark: input.trueDark,
    placement,
    text: (m) => {
      const t = readMessage(rom, m)?.text ?? '';
      return (t.match(/.{1,16}/g) ?? [])
        .map((r) => r.trim())
        .join('\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
    },
    staticMessage: messageForY(STATIC_Y),
    ...(input.briefingNamesArea && { briefingArea: [...input.layout].find(([, l]) => l === 1)?.[0] ?? 1 }),
    briefing: BRIEFING_Y.map(messageForY).filter((m) => (readMessage(rom, m)?.text ?? '').trim()),
    moles: input.destroyers ? input.destroyers.names.filter((_, i) => i !== input.destroyers!.real) : [],
    realDestroyer: realName,
    namedDestroyers: input.namedDestroyers,
    ...(input.rescueTells && { rescueTells: input.rescueTells }),
  };
}

// --- playing it ---

/** What the player knows about a place. `comm`: its communicator (by a clue or by trying), `notComm` the ones that got
 * static there, `noRoom` no comm room; `finds` what clues said is there (`maybe`: one of two places, or a region). */
export interface PlaceKnowledge {
  comm?: { item: Item; by: string };
  notComm?: Item[];
  noRoom?: boolean;
  finds?: { item: Item; by: string; maybe?: boolean }[];
  needs?: { item: Item; by: string }[];
  joeTrail?: string;
  pointed?: string;
}

export interface SimLog {
  place: number;
  action?: string;
  messages: number[];
  got?: Item;
  note?: 'static' | 'impostor' | 'again' | 'flareless' | 'briefing';
}

export interface SimState {
  owned: Item[];
  /** Map numbers cleared. */
  cleared: number[];
  /** "place:action" done. */
  done: string[];
  visited: number[];
  know: Record<number, PlaceKnowledge>;
  /** Impostors named so far, and whether the real Destroyer is known. */
  impostors: string[];
  trusted: boolean;
  /** Dark areas gone into without the Flare (brute force, by choice): everything there as if lit. */
  flareless: number[];
  log: SimLog[];
  finished: boolean;
}

/** A new game: α in hand, at the start, the briefing heard. */
export const simStart = (seed?: SimSeed): SimState => ({
  owned: [...START_ITEMS],
  cleared: [],
  done: [],
  visited: [0],
  impostors: [],
  trusted: false,
  flareless: [],
  // (the briefing's area: its agents are on α, the communicator the player starts with)
  know: seed?.briefingArea !== undefined ? { [seed.briefingArea]: { comm: { item: 'alpha', by: 'briefing' } } } : {},
  log: seed?.briefing.length ? [{ place: 0, messages: seed.briefing, note: 'briefing' }] : [],
  finished: false,
});

const stateOf = (st: SimState): State => ({ has: (i) => st.owned.includes(i) });

/** The places the open roads reach now (and the passage stage once it's found). */
export function simReach(seed: SimSeed, st: SimState): Set<number> {
  const map = reachableMap(stateOf(st), new Set(st.cleared), seed.rules.gate, seed.rules.gate10);
  map.add(0);
  if (st.owned.includes('passage') && [14, 15, 17, 18].some((m) => map.has(m))) map.add(PASSAGE);
  return map;
}

/** Why an action can't be done now (nothing: it can), as data: items missing, a communicator, the dark, a guard. */
export type Block =
  | { kind: 'items'; items: Item[] }
  | { kind: 'comm' }
  | { kind: 'dark' }
  | { kind: 'entry'; item: Item }
  | { kind: 'cleared'; areas: number[] }
  | { kind: 'unlock'; rooms: ('A' | 'B')[] }
  | { kind: 'after'; step: string };

const ALL: Item[] = [
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
  'joe',
  'iff',
  'flak',
  'passage',
];

/** The fewest items to add to what's owned for `ok` (one removal at a time from everything). */
function missing(st: SimState, ok: (s: State) => boolean): Item[] {
  const has = new Set<Item>([...st.owned, ...ALL]);
  if (!ok({ has: (i) => has.has(i) })) return [];
  for (const i of ALL) {
    if (st.owned.includes(i)) continue;
    has.delete(i);
    if (!ok({ has: (x) => has.has(x) })) has.add(i);
  }
  return ALL.filter((i) => has.has(i) && !st.owned.includes(i));
}

export function simBlock(seed: SimSeed, st: SimState, n: number, a: SimAction, brute = false): Block | undefined {
  const p = seed.places.get(n)!,
    s = stateOf(st),
    cleared = new Set(st.cleared);
  if (p.entry && !s.has(p.entry)) return { kind: 'entry', item: p.entry };
  const lit = s.has('flare') || brute || st.flareless.includes(n);
  if ((a.kind === 'comm' || a.kind === 'wiretap') && p.dark && !lit && !seed.trueDark) return { kind: 'dark' };
  if ((a.kind === 'comm' || a.kind === 'wiretap') && p.dark && !s.has('flare') && seed.trueDark)
    return { kind: 'items', items: ['flare'] };
  if ((a.kind === 'comm' || a.kind === 'wiretap') && !COMM_ITEMS.some((c) => s.has(c))) return { kind: 'comm' };
  if (a.kind === 'clear' && p.dark && !s.has('flare') && (seed.trueDark || !lit))
    return seed.trueDark ? { kind: 'items', items: ['flare'] } : { kind: 'dark' };
  if (n === 12 && area12Needs1011(seed.rules.area12) && !(cleared.has(10) && cleared.has(11))) {
    const areas = [10, 11].filter((m) => !cleared.has(m));
    const items = missing(st, (x) => a.requires(x, new Set([...cleared, 10, 11])));
    return items.length ? { kind: 'items', items } : { kind: 'cleared', areas };
  }
  if (!a.requires(s, cleared)) return { kind: 'items', items: missing(st, (x) => a.requires(x, cleared)) };
  if (a.after && !st.done.includes(`${n}:${a.after}`))
    return { kind: 'after', step: p.actions.find((x) => x.id === a.after)!.label! };
  // (a comm-locked door: open once COMMUNICATE is done in its comm room(s); behind it the clear, and O1's comm room B)
  const behind = a.kind === 'clear' || ((a.kind === 'comm' || a.kind === 'wiretap') && p.behindLock?.includes(a.room!));
  const shut = behind ? (p.unlock ?? []).filter((r) => !st.done.includes(`${n}:comm${r}`)) : [];
  return shut.length ? { kind: 'unlock', rooms: shut } : undefined;
}

/** Go into dark area n without the Flare (brute force): everything there can be done as if it were lit. */
export const simFlareless = (st: SimState, n: number): SimState => ({
  ...st,
  flareless: [...new Set([...st.flareless, n])],
});

/** Visit place n: it's seen now (an enemy area without a comm room shows it has none). Its communicator is learned only
 * by a clue, or by trying its comm room (simAct: an answer, or static for what's carried). */
export function simVisit(seed: SimSeed, st: SimState, n: number): SimState {
  const p = seed.places.get(n)!,
    know = { ...st.know };
  if (p.kind === 'area' && n !== 12 && !p.commRoom) know[n] = { ...know[n], noRoom: true };
  return { ...st, visited: st.visited.includes(n) ? st.visited : [...st.visited, n], know };
}

/** What a fact teaches, into the knowledge. `by`: where it was heard ("place:action"). */
function learn(seed: SimSeed, st: SimState, know: Record<number, PlaceKnowledge>, f: Fact, by: string) {
  const at = (m: number) => (m === 0 ? PASSAGE : m);
  const add = (m: number, patch: (k: PlaceKnowledge) => PlaceKnowledge) => {
    know[at(m)] = patch({ ...know[at(m)] });
  };
  const find = (m: number, item: Item, maybe = false) =>
    add(m, (k) => ({
      ...k,
      finds: [
        ...(k.finds ?? []).filter((x) => x.item !== item || (x.maybe && !maybe)),
        ...((k.finds ?? []).some((x) => x.item === item && (!x.maybe || maybe))
          ? []
          : [{ item, by, ...(maybe && { maybe }) }]),
      ],
    }));
  switch (f.kind) {
    case 'alpha':
      f.areas.forEach((m) => add(m, (k) => (k.comm ? k : { ...k, comm: { item: 'alpha', by } })));
      break;
    case 'comm':
      f.areas.forEach((m) => add(m, (k) => (k.comm ? k : { ...k, comm: { item: f.comm, by } })));
      break;
    case 'noroom':
      f.areas.forEach((m) => add(m, (k) => ({ ...k, noRoom: true })));
      break;
    case 'find': {
      const where = f.region ? REGIONS[f.region] : f.decoy !== undefined ? [f.place, f.decoy] : [f.place];
      where.forEach((m) => find(m, f.item, where.length > 1));
      break;
    }
    case 'passage':
      find(f.place, 'passage');
      break;
    case 'need':
      add(f.place, (k) => ({ ...k, needs: [...(k.needs ?? []), { item: f.item, by }] }));
      break;
    case 'visit':
      add(f.place, (k) => ({ ...k, pointed: by }));
      break;
    case 'trail':
      add(f.place, (k) => ({ ...k, joeTrail: by }));
      break;
    case 'mole': {
      const name = seed.moles[f.mole];
      if (name && !st.impostors.includes(name)) st.impostors.push(name);
      if (st.impostors.length >= 2) st.trusted = true;
      add(f.place, (k) => ({ ...k, pointed: k.pointed ?? by }));
      break;
    }
  }
}
const REGIONS: Record<string, number[]> = { west: [1, 2, 3, 4, 5, 6], central: [7, 8, 9], compound: [10, 11] };

/**
 * Do action `id` at place `n` (visited, reachable, not blocked; the page checks). `brute`: a dark area cleared without
 * the Flare. A comm room with the wrong communicator gives static (and says so for the place); a said line can be read
 * again (`again`), which only logs it.
 */
export function simAct(
  seed: SimSeed,
  st0: SimState,
  n: number,
  id: string,
  { brute = false, again = false } = {},
): SimState {
  const p = seed.places.get(n)!,
    a = p.actions.find((x) => x.id === id)!;
  const st: SimState = {
    ...st0,
    owned: [...st0.owned],
    cleared: [...st0.cleared],
    done: [...st0.done],
    know: { ...st0.know },
    impostors: [...st0.impostors],
    log: [...st0.log],
  };
  const key = `${n}:${id}`,
    by = key;
  if (again) {
    st.log.unshift({ place: n, action: id, messages: a.says, note: 'again' });
    return st;
  }
  if (a.kind === 'comm' || a.kind === 'wiretap') {
    if (!st.owned.includes(p.comm!)) {
      // (static: what's carried isn't this area's)
      st.know[n] = {
        ...st.know[n],
        notComm: [...new Set([...(st.know[n]?.notComm ?? []), ...st.owned.filter((i) => COMM_ITEMS.includes(i))])],
      };
      st.log.unshift({ place: n, action: id, messages: [seed.staticMessage], note: 'static' });
      return st;
    }
    st.know[n] = { ...st.know[n], comm: st.know[n]?.comm ?? { item: p.comm!, by: 'tried' } };
  }
  if (a.kind === 'destroyer' && !a.man!.real) {
    if (!st.impostors.includes(a.man!.name)) st.impostors.push(a.man!.name);
    if (st.impostors.length >= 2) st.trusted = true;
    st.log.unshift({ place: n, action: id, messages: a.says, note: 'impostor' });
    return st;
  }
  const item = a.location ? seed.placement.get(a.location) : undefined;
  if (!st.done.includes(key)) st.done.push(key);
  if (item && !st.owned.includes(item)) st.owned.push(item);
  if (a.kind === 'clear' && p.kind === 'area' && !st.cleared.includes(n)) st.cleared.push(n);
  // (YES to the real one: the other two are the impostors, now known; their lines are still theirs to read)
  if (a.kind === 'destroyer') {
    st.trusted = true;
    for (const x of p.actions)
      if (x.kind === 'destroyer' && !x.man!.real && !st.impostors.includes(x.man!.name)) st.impostors.push(x.man!.name);
  }
  if (a.kind === 'finish') st.finished = true;
  for (const f of a.teaches) learn(seed, st, st.know, f, by);
  if (item === 'joe' && seed.rescueTells) {
    if (seed.rescueTells.trust) st.trusted = true;
    st.know[12] = { ...st.know[12], comm: st.know[12]?.comm ?? { item: seed.rescueTells.comm, by } };
  }
  const messages = a.says.filter((m) => seed.text(m).trim());
  const flareless =
    (brute || st0.flareless.includes(n)) && a.kind === 'clear' && p.dark && !st0.owned.includes('flare');
  st.log.unshift({
    place: n,
    action: id,
    messages,
    ...(item && { got: item }),
    ...(flareless && { note: 'flareless' as const }),
  });
  return st;
}
