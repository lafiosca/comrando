// The intended route (the spoiler's): the steps a player following the seed's clues takes, each with what sent them
// there and what it takes. Wording lives in routetext.ts; the route itself is data (spoiler.ts RouteVisit).

import { roomContents } from './buildings.ts';
import { mapSources } from './routetext.ts';
import type {
  Basis,
  Clue,
  Opens,
  ProbeTarget,
  RouteAction,
  RouteNeed,
  RoutePlace,
  RouteStep,
  RouteVisit,
  Source,
  Why,
} from './spoiler.ts';
import {
  AMMO_ROOMS,
  area12Steps,
  COMM_ROOMS,
  type Fact,
  type HintInput,
  JOE_POINTER_Y,
  PERMIT_ZONE,
  REGION_AREAS,
  type Slot,
  SYMBOL,
  UNDERGROUND,
  UNLOCK_ROOMS,
} from './hintdata.ts';
import {
  area12NeedsJoe,
  area12Needs1011,
  canFinish,
  doorRequires,
  roadDistances,
  ITEMS,
  type Item,
  type Location,
  reachableMap,
  START_ITEMS,
  zoneNode,
} from './world.ts';

/** What the route builder takes from the hint picker (hints.ts buildHints): its input, the finished slots and what
 * each says, and its helpers for what an area takes. */
export interface RouteContext {
  input: HintInput;
  /** The comm-locked layouts (input.locked with its default), and those besides O1. */
  locked: readonly number[];
  LOCKED: number[];
  hintLocations: Location[];
  slots: Slot[];
  /** What each slot says. */
  said: Map<Slot, string>;
  /** Hints lead a path (not 'vanilla' or 'nonsense'). */
  enabled: boolean;
  /** Joe's rescue line names the real Destroyer. */
  joeTip: boolean;
  joeRescueLine: boolean;
  commOf: (layout: number) => Item;
  talkerNeeds: (s: Slot) => Item[];
  commNeeded: (p: number) => boolean;
  askFirst: (p: number) => boolean;
  isDark: (layout: number) => boolean;
  usable: (c: Item) => number[];
  needsComm: (p: number) => boolean;
}

/**
 * Replay a player who follows the finished hints (a slot teaches all its lines when read, wherever the guided
 * player's search put them), then keep only the steps the win depends on, in play order. Each step says what sent
 * the player there and what it takes. `allow`: a second pass does only these steps (the first pass's that the win
 * depends on: "slot:id:kind", "loc:id"), so the player's travels follow the route shown, not the pickups it leaves out.
 */
export function intendedRoute(ctx: RouteContext, allow?: Set<string>): RouteVisit[] {
  const {
    input,
    locked,
    LOCKED,
    hintLocations,
    slots,
    said,
    enabled,
    joeTip,
    joeRescueLine,
    commOf,
    talkerNeeds,
    commNeeded,
    askFirst,
    isDark,
    usable,
    needsComm,
  } = ctx;
  const { rules, at, spot, nz15, placement, itemRooms, doors, level } = input;
  const locations = input.routeLocations ?? hintLocations; // (the route's own rules, with no hints)
  // What sent the player somewhere: a clue, or a neutral zone on the way, trial and error, the passage revealed (the
  // stage, looked into once the passage is found), the finish (Area 12), Area 12's entry (Areas 10 and 11 when it
  // takes them)
  type Reason = { kind: 'onTheWay' | 'trial' | 'revealed' | 'finish' | 'entry12' } | ({ kind: 'clue' } & Clue);
  const ON_THE_WAY: Reason = { kind: 'onTheWay' },
    ENTRY_12: Reason = { kind: 'entry12' },
    FINISH: Reason = { kind: 'finish' };
  const REVEALED: Reason = { kind: 'revealed' },
    TRIAL: Reason = { kind: 'trial' };
  const stepTag = new Map<number, string>(); // step -> what it does (`allow`)
  // Trial and error: an area whose communicator no clue told, tried with the ones carried
  const TRIED = '#trial',
    tried = new Map<number, Set<Item>>(),
    failed = new Set<number>(); // (TRIED: a comm's source; layout; failed: steps)
  /** Where the player heard a clue, as a placeholder: the route's step there once the route is laid out ("1c"),
   * the briefing "0a". `id`: a slot's id, 'briefing', 'start', 'joe' (his rescue line), "step:N". */
  const ref = (id: string): Source => ({ kind: 'slot', slot: id });
  const clue = (id: string, vague?: Clue['vague']): Reason => ({
    kind: 'clue',
    by: [ref(id)],
    ...(vague && { vague }),
  });
  /** A step: `act` what's done (LOOK, a zone's first stop, takes no letter; AREA 12, its steps by the door locks). */
  type Act = RouteAction | { act: 'look' } | { act: 'area12' };
  const steps: {
    place: number;
    act: Act;
    optional?: boolean;
    go: Why[];
    deps: Set<number>;
    bring: [Item, Basis][];
    slot?: Slot;
    key?: number;
    paths: RouteNeed['need'][];
    had: Set<Item>;
  }[] = [];
  const owned = new Set<Item>(START_ITEMS);
  const state = { has: (i: Item) => owned.has(i) };
  const cleared = new Set<number>();
  const got = new Set<string>();
  const done = new Set<Slot>();
  const itemBy = new Map<Item, number>(); // item -> step that got it
  const clearBy = new Map<number, number>(); // map number -> step that cleared it
  const known = new Map<number, { by?: number; src: Reason; also?: Reason[]; alsoBy?: number[] }>(); // map number -> what pointed the player there
  // layout -> step that taught its comm (O1's α: the briefing's area; Nonsense's names none, so the player tries α there)
  const commBy = new Map<number, number | undefined>(level === 'nonsense' ? [] : [[1, undefined]]);
  const commSrc = new Map<number, string>([[1, 'start']]); // (α: the player starts with it, 0a; TRIED: found by trying)
  const needSrc = new Map<string, string>(); // `${map number}|${item}` -> the clue that said the area takes it
  const teach = (layout: number, by: number, src: string) => {
    if (!commBy.has(layout)) {
      commBy.set(layout, by);
      commSrc.set(layout, src);
    }
  };
  let trust: number | undefined,
    trusted = false;
  const moleBy = new Map<number, number>();
  let viaMoles = false,
    destroyerStep: number | undefined,
    destroyerIntel: Source[] | undefined;
  // Joe's whereabouts: the line naming where he is, and his trail's decoy (if read before it)
  let joeFindBy: number | undefined,
    joeAt: number | undefined,
    trailBy: number | undefined,
    trailPlace: number | undefined;
  // Probes: an area the player can go to (known, reached, its comm in hand) but whose clear needs
  // something no clue mentioned (the Flare, a weapon): they go in, see it, and come back later ("Enter: needs Flare")
  const probeBy = new Map<string, number>(); // `${map number}|${item}` -> the probe step
  const ALL_ITEMS = Object.keys(ITEMS) as Item[];
  /** A fewest set of items that satisfies `l` (from everything, one removal at a time). */
  const fullNeed = (l: Location) => {
    const has = new Set(ALL_ITEMS);
    for (const i of ALL_ITEMS) {
      has.delete(i);
      if (!l.requires({ has: (x) => has.has(x) })) has.add(i);
    }
    return [...has];
  };
  /** `strong`: the clue puts something there (an item, Joe, his trail, a mole), not just what to bring. */
  const weak = (r: Reason) => r.kind === 'onTheWay' || r.kind === 'trial' || r.kind === 'revealed';
  const point = (n: number, by: number | undefined, src: Reason, strong = true) => {
    if (!known.has(n)) known.set(n, { by, src });
    // (no lead to an area already cleared: "Joe is locked up in Area 7" after its clear said he was moved is stale)
    else if (cleared.has(n)) return;
    // (a zone passed on the way, or an area tried, that a clue names after: a lead now, sent there by the clue)
    else if (strong && weak(known.get(n)!.src) && src.kind === 'clue') known.set(n, { by, src });
    // (the first clue to name it, as anywhere else: a later one, the same line read twice included, is redundant)
    else if (strong && known.get(n)!.src.kind === 'entry12' && src.kind !== 'entry12' && !known.get(n)!.also) {
      known.get(n)!.also = [src];
      if (by !== undefined) known.get(n)!.alsoBy = [by];
    } // (shown first)
  };

  /** The fewest owned items and cleared areas that keep `ok` true (one removal at a time, latest first). */
  const fewest = (ok: (has: Set<Item>, clr: Set<number>) => boolean) => {
    const has = new Set(owned),
      clr = new Set(cleared);
    for (const i of [...has].reverse()) {
      has.delete(i);
      if (!ok(has, clr)) has.add(i);
    } // keep what came first
    for (const n of [...clr]) {
      clr.delete(n);
      if (!ok(has, clr)) clr.add(n);
    }
    return { has: [...has].filter((i) => !START_ITEMS.includes(i)), clr: [...clr] };
  };
  const mapNow = (has: Set<Item>, clr: Set<number>) =>
    reachableMap({ has: (i) => has.has(i) }, clr, rules.gate, rules.gate10);
  /** Steps that let the player be at map number p: what pointed them there, and what opened the roads. */
  const reach = (p: number, deps: Set<number>) => {
    const k = known.get(p);
    if (k?.by !== undefined) deps.add(k.by);
    k?.alsoBy?.forEach((b) => deps.add(b)); // (a clue the reason cites, "suggested by 1a, required for Area 12 entry")
    const cb = askFirst(p) ? commBy.get(at(p)) : undefined; // which comm to bring (or none)
    if (cb !== undefined) deps.add(cb);
    const got = askFirst(p) && needsComm(p) ? itemBy.get(commOf(at(p))) : undefined; // ...and the step that got it
    if (got !== undefined) deps.add(got);
    const need = fewest((has, clr) => mapNow(has, clr).has(p));
    need.has.forEach((i) => deps.add(itemBy.get(i)!));
    need.clr.forEach((n) => deps.add(clearBy.get(n)!));
    return need;
  };
  /** Why the player is at p: what pointed them there, and what the roads took. */
  const clueOf = (r: Reason): Clue =>
    r.kind === 'clue' ? { by: r.by, ...(r.vague && { vague: r.vague }) } : { by: [] };
  const reason = (src: Reason, also: Reason[] = []): Why[] =>
    src.kind === 'onTheWay'
      ? [{ kind: exploring ? 'lookingAround' : 'onTheWay' }]
      : src.kind === 'revealed'
        ? [{ kind: 'lookingAround' }]
        : src.kind === 'finish'
          ? [{ kind: 'finishing' }]
          : src.kind === 'trial'
            ? [{ kind: 'trial' }]
            : src.kind === 'entry12'
              ? [
                  ...(also.length ? [{ kind: 'suggested' as const, clues: also.map(clueOf) }] : []),
                  { kind: 'area12Entry' },
                ]
              : [{ kind: 'suggested', clues: [clueOf(src)] }];
  const goNote = (p: number, by?: Reason): Why[] => {
    const need = fewest((has, clr) => mapNow(has, clr).has(p));
    const why = reason(by ?? known.get(p)!.src, known.get(p)?.also);
    return need.has.includes('passage') ? [...why, { kind: 'byPassage' }] : why;
  };
  /** What the map's gates take to reach p (a requirement, "IFF Code", not a reason). */
  const pathNeeds = (p: number): RouteNeed['need'][] => {
    const need = fewest((has, clr) => mapNow(has, clr).has(p));
    return [
      ...need.has.filter((i) => i !== 'passage').map((item) => ({ item })),
      ...need.clr.map((cleared) => ({ cleared })),
    ];
  };
  const explore = () =>
    map.forEach((n) => {
      if (n >= 13) point(n, undefined, ON_THE_WAY);
    });
  const placeOf = (p: number): RoutePlace =>
    p === UNDERGROUND ? { kind: 'passage' } : { kind: p >= 13 ? 'zone' : 'area', area: p, layout: at(p) };
  /** How the player knows `place` takes `item`: its comm's clue, a "need" clue, else "check area" (no hint says so;
   * never where it was found). */
  const reqSrc = (item: Item, place: number): Basis => {
    const layout = at(place);
    if (SYMBOL[item] && commOf(layout) === item && commSrc.has(layout))
      return commSrc.get(layout) === TRIED ? { kind: 'trial' } : { kind: 'per', by: [ref(commSrc.get(layout)!)] };
    if (SYMBOL[item] && layout === 12 && joeRescueLine) return { kind: 'per', by: [ref('joe')] };
    const n = needSrc.get(`${place}|${item}`);
    if (n) return { kind: 'per', by: [ref(n)] };
    return { kind: SYMBOL[item] ? 'trial' : 'checkArea' }; // (a communicator no clue named: tried until one worked)
  };
  /** A step at `place`; `bring`: what it takes in the loadout (a comm, the Flare, a weapon, the Permit), with sources. */
  const add = (
    place: number,
    act: Act,
    deps: Set<number>,
    bring: Item[] = [],
    go = goNote(place),
    slot?: Slot,
    key?: number,
    optional = false,
  ) =>
    steps.push({
      place,
      act,
      optional,
      go,
      deps,
      bring: bring.map((i) => [i, reqSrc(i, place)] as [Item, Basis]),
      slot,
      key,
      paths: place === UNDERGROUND ? [] : pathNeeds(place),
      had: new Set(owned),
    }) - 1;
  /** An area's steps in the rooms' order: COMM A, WIRETAP A, COMM B, WIRETAP B, then CLEAR. */
  const roomKey = (id: string) => {
    const m = id.match(/^O\d+([A-Z])( wiretap)?$/)!;
    return 2 * (m[1].charCodeAt(0) - 65) + (m[2] ? 1 : 0);
  };
  const CLEAR_KEY = 1000;
  /** A zone's steps in the doors' order: Talk outside A, Room A, Talk inside A, then B's;
   * the Destroyer's at the door he stands by. */
  const zoneKey = (door: string | undefined, what: 0 | 1 | 2) => (door === 'B' ? 3 : 0) + what;
  const talkKey = (s: Slot) => zoneKey(s.id.match(/door ([AB])/)?.[1], s.inside ? 2 : 0);
  const locKey = (l: Location) => zoneKey(l.id === 'destroyer' ? input.trustDoor : l.name.match(/door ([AB])/)?.[1], 1);
  const doorOf = (l: Location) => l.name.match(/door ([AB])/)![1] as 'A' | 'B';
  /** A location's step: its item got ("Room A", not "Enter door A"). */
  const howOf = (l: Location, item: Item): RouteAction =>
    l.id === 'destroyer'
      ? {
          act: 'destroyer',
          door: input.trustDoor,
          ...(level !== 'nonsense' && { name: input.trust }),
          position: input.trustAt,
          by: trusted ? trustRefs() : 'trial',
          item,
        }
      : l.areaClear
        ? { act: 'clear', item }
        : l.id === 'passage'
          ? { act: 'passage', item }
          : { act: 'room', door: doorOf(l), ...(l.id === 'interrogation' && { prisoner: true }), item };
  /** A location as a probe's target (what's shut). */
  const targetOf = (l: Location): ProbeTarget => ({
    kind: 'room',
    door: doorOf(l),
    ...(l.id === 'interrogation' && { prisoner: true }),
  });
  /** Where the player learned who the real Destroyer is: both moles' lines ("1d & 2a"), or Joe's rescue line. */
  const trustRefs = () =>
    viaMoles ? [...moleBy.values()].sort((x, y) => x - y).map((i) => ref(steps[i].slot!.id)) : [ref('joe')];
  const talkDoor = (s: Slot) => s.id.match(/door ([AB])/)![1] as 'A' | 'B';
  const talkText = (s: Slot): RouteAction => ({
    act: 'talk',
    door: talkDoor(s),
    inside: !!s.inside,
    ...(said.has(s) && { quote: said.get(s)! }),
  });
  /** A comm room's slot as a step: "Comm A: "…"" (the area's comm is in its requirements; no quote: a line the hints
   * left alone), with what it opens ("opens boss door"). */
  const roomText = (id: string, wire: boolean, s?: Slot, opens?: Opens): RouteAction => ({
    act: wire ? 'wiretap' : 'comm',
    room: id.match(/^O\d+([A-Z])/)![1] as 'A' | 'B',
    ...(s && said.has(s) && { quote: said.get(s)! }),
    ...(opens && { opens }),
  });
  const slotText = (s: Slot, opens?: Opens) => roomText(s.id, s.kind === 'wire', s, opens);
  /** The items that can open something in this seed (the player knows the settings): the rest gate nothing. */
  const gating = new Set<Item>([
    'alpha',
    'beta',
    'gamma',
    'delta',
    'joe',
    'iff',
    'flak',
    'passage',
    'permit',
    'flare',
    ...(Object.keys(ITEMS) as Item[]).filter((i) =>
      locations.some((l) => l.requires({ has: () => true }) && !l.requires({ has: (x) => x !== i })),
    ),
  ]);
  const learn = (f: Fact, by: number, src: string) => {
    if (f.kind === 'alpha') {
      usable('alpha').forEach((n) => {
        teach(at(n), by, src);
        point(n, by, clue(src), false);
      });
    }
    if (f.kind === 'find' || f.kind === 'need' || f.kind === 'passage' || f.kind === 'visit') {
      // (a vague clue says so: the player checks every area it could mean)
      const vague = clue(
        src,
        f.kind === 'find' && f.region
          ? { region: f.region, areas: [REGION_AREAS[f.region][0], REGION_AREAS[f.region].at(-1)!] }
          : f.kind === 'find' && f.decoy
            ? { either: [Math.min(f.place, f.decoy), Math.max(f.place, f.decoy)] }
            : undefined,
      );
      // (where an item is sends the player there only for one that can open something, not yet held:
      // "somewhere in the west" about the Rapid-Fire Device was no reason to go; a region clue about one
      // that matters, every area it could mean)
      const worth = f.kind !== 'find' || (gating.has(f.item) && !owned.has(f.item));
      if (worth && !(f.kind === 'find' && f.region)) point(f.place, by, vague);
      if (f.kind === 'need' && !needSrc.has(`${f.place}|${f.item}`)) needSrc.set(`${f.place}|${f.item}`, src);
      if (worth && f.kind === 'find' && f.decoy) point(f.decoy, by, vague);
      if (worth && f.kind === 'find' && f.region) REGION_AREAS[f.region].forEach((n) => point(n, by, vague));
    }
    if (f.kind === 'comm')
      f.areas.forEach((n) => {
        teach(at(n), by, src);
        point(n, by, clue(src), false);
      });
    if (f.kind === 'noroom')
      f.areas.forEach((n) => {
        teach(at(n), by, src);
        point(n, by, clue(src), false);
      });
    if (f.kind === 'trail') {
      // a detour: his captors moved him on
      point(f.place, by, clue(src));
      trailPlace ??= f.place;
      // (not read after that area's clear: its boss said he was moved first)
      if (trailBy === undefined && !cleared.has(f.place)) trailBy = by;
    }
    if (f.kind === 'find' && f.item === 'joe' && joeFindBy === undefined) {
      joeFindBy = by;
      joeAt = f.place;
    }
    if (f.kind === 'mole' && !moleBy.has(f.mole)) {
      moleBy.set(f.mole, by);
      point(f.place, by, clue(src));
      if (moleBy.size === 2 && !trusted) {
        trusted = true;
        trust = by;
        viaMoles = true;
      }
    }
  };

  if (level !== 'nonsense') point(spot(1), undefined, clue('briefing')); // (Nonsense's briefing names no area: the player looks around)
  if (area12Needs1011(rules.area12)) {
    point(10, undefined, ENTRY_12);
    point(11, undefined, ENTRY_12);
  } // (the player knows from the settings)
  point(12, undefined, FINISH); // the goal
  const lockBy = (l: Location) =>
    l.id === 'destroyer' ? trust : l.areaClear && LOCKED.includes(l.areaClear) ? commBy.get(l.areaClear) : undefined;
  let guessing = false; // (out of leads: the Destroyers by guess, the passage once it's revealed)
  let exploring = false; // (out of leads: the nearest zone not yet looked into, "looking around")
  // (with no hints the Destroyers are a guess from the start: a wrong one survived with 3 HP)
  const lockOk = (l: Location) =>
    (l.id !== 'destroyer' || trusted || guessing || !enabled) &&
    (!l.areaClear || !LOCKED.includes(l.areaClear) || commBy.has(l.areaClear));

  let map = reachableMap(state, cleared, rules.gate, rules.gate10);
  explore();
  // The player goes to the nearest place (by the roads open to them) where they can do something, does what they
  // can there, and looks again from there (not across the map while something waits next door)
  let here = 1;
  const met = (g?: { areas: number[]; items: Item[] }) =>
    !g || (g.areas.every((n) => cleared.has(n)) && g.items.every((i) => owned.has(i)));
  // (by the roads' lengths on the map; a tie goes to the place heard of first)
  const roadsFrom = (from: number) =>
    roadDistances(from, (kind) =>
      kind === 'passage'
        ? owned.has('passage')
        : kind === 'gate'
          ? met(rules.gate)
          : kind === 'flak'
            ? met(rules.gate10)
            : true,
    );
  /** At `p`, what the player can do: everything (`dry`: only whether there's anything). True if anything (was) done. */
  const act = (p: number, dry = false): boolean => {
    const before = steps.length;
    // (a zone's first stop lists what's there, whatever brought the player: the second pass)
    if (!dry && p >= 13 && !investigated.has(p)) {
      const deps = new Set<number>();
      reach(p, deps);
      forced.add(add(p, { act: 'look' }, deps, [], undefined, undefined, -2));
      investigated.add(p);
    }
    for (const s of slots) {
      // (the second pass does what the route needs, and at a zone stop whatever else is free there;
      // with no hints at an area stop too, the player checking each place as they go)
      const extraSlot = !!allow && !allow.has(`slot:${s.id}:${s.kind}`);
      if (s.place !== p || done.has(s) || !said.has(s) || (extraSlot && (dry || (p < 13 && enabled)))) continue;
      const comm = s.kind !== 'talker' ? commOf(s.layout) : undefined;
      const extra = s.kind === 'talker' ? talkerNeeds(s) : [comm!, ...(isDark(s.layout) ? ['flare' as Item] : [])];
      if (!extra.every((i) => owned.has(i)) || (comm && !commBy.has(s.layout))) continue;
      if (dry) return true;
      done.add(s);
      const deps = new Set<number>();
      reach(p, deps);
      extra.forEach((i) => itemBy.has(i) && deps.add(itemBy.get(i)!));
      extra.forEach((i) => {
        const pb = probeBy.get(`${p}|${i}`);
        if (pb !== undefined) deps.add(pb);
      }); // (what a probe showed)
      const cb = comm ? commBy.get(s.layout) : undefined;
      if (cb !== undefined) deps.add(cb);
      // ("Talk outside A"; the man in the building, "Talk inside A")
      const text = s.kind === 'talker' ? talkText(s) : slotText(s);
      const i = add(p, text, deps, extra, undefined, s, s.kind === 'talker' ? talkKey(s) : roomKey(s.id), extraSlot);
      stepTag.set(i, `slot:${s.id}:${s.kind}`);
      if (extraSlot) forced.add(i);
      s.facts.forEach((f) => learn(f, i, s.id));
    }
    const takeAll = (ls: Location[]): boolean => {
      for (const l of ls) {
        const extraLoc = !!allow && !allow.has(`loc:${l.id}`);
        if (
          got.has(l.id) ||
          !l.at.includes(p) ||
          !l.requires(state) ||
          !lockOk(l) ||
          (extraLoc && (dry || (p < 13 && enabled) || l.id === 'passage'))
        )
          continue;
        // (the stage once the passage is revealed, whether or not a clue named its item: a new place to look into, right
        // away: a likely spot for a cheap item)
        if (l.id === 'passage' && !known.has(UNDERGROUND) && !owned.has('passage')) continue;
        if (l.id === 'passage' && !known.has(UNDERGROUND) && !dry) point(UNDERGROUND, itemBy.get('passage'), REVEALED);
        if (dry) return true;
        const item = placement.get(l.id)!;
        got.add(l.id);
        const deps = new Set<number>();
        reach(p, deps);
        const need = fewest((has) => l.requires({ has: (i) => has.has(i) })).has;
        need.forEach((i) => deps.add(itemBy.get(i)!));
        need.forEach((i) => {
          const pb = probeBy.get(`${p}|${i}`);
          if (pb !== undefined) deps.add(pb);
        }); // (what the probe showed)
        const lb = lockBy(l);
        const told = l.id === 'passage' ? known.get(UNDERGROUND)?.by : undefined; // the line naming the stage's item
        if (told !== undefined) deps.add(told);
        if (l.id === 'destroyer' && viaMoles) moleBy.forEach((i) => deps.add(i)); // both impostors named
        if (lb !== undefined) deps.add(lb);
        // rescuing Joe takes knowing where he is: the line that says so, and when his trail came first, the decoy
        // area (its boss says he was moved) as well; reaching his area for another reason isn't enough
        if (placement.get(l.id) === 'joe') {
          if (joeFindBy !== undefined) deps.add(joeFindBy);
          const decoy = trailPlace !== undefined ? clearBy.get(trailPlace) : undefined;
          if (trailBy !== undefined && (joeFindBy === undefined || trailBy < joeFindBy)) {
            deps.add(trailBy);
            if (decoy !== undefined) deps.add(decoy);
          } else if (trailBy === undefined && decoy !== undefined && (joeFindBy === undefined || decoy < joeFindBy))
            deps.add(decoy); // (the clear told it)
        }
        // a comm-locked area: COMMUNICATE in the room(s) that open its door, this visit (the flags reset on the map)
        if (l.areaClear && locked.includes(l.areaClear)) {
          const comm = commOf(l.areaClear),
            opens: Opens = l.areaClear === 1 ? 'door' : 'bossDoor';
          for (const id of UNLOCK_ROOMS[l.areaClear]) {
            const s = slots.find((x) => x.id === id && x.kind === 'comm');
            deps.add(
              add(
                p,
                s ? slotText(s, opens) : roomText(id, false, undefined, opens),
                new Set(deps),
                [comm],
                undefined,
                s,
                roomKey(id),
              ),
            );
          }
        }
        const how = howOf(l, item);
        // (the passage stage is its own entry: flown on a hidden road, not part of the zone's visit)
        // (the Destroyers' zone: suggested by what named the real one, "1d & 2a")
        if (l.id === 'destroyer') {
          destroyerStep = steps.length;
          if (trusted) destroyerIntel = trustRefs();
        }
        const stageSrc = known.get(UNDERGROUND)?.src;
        const i =
          l.id === 'passage'
            ? add(UNDERGROUND, how, deps, need, [
                ...(stageSrc?.kind === 'trial'
                  ? [{ kind: 'trial' } as const]
                  : stageSrc?.kind === 'revealed'
                    ? [{ kind: 'lookingAround' } as const]
                    : [{ kind: 'suggested' as const, clues: [clueOf(stageSrc!)] }]),
                { kind: 'flownFrom', place: placeOf(p) },
              ])
            : add(
                p,
                how,
                deps,
                need,
                l.id === 'destroyer' ? goNote(p, trusted ? { kind: 'clue', by: trustRefs() } : TRIAL) : undefined,
                undefined,
                l.areaClear ? CLEAR_KEY : locKey(l),
                extraLoc,
              );
        stepTag.set(i, `loc:${l.id}`);
        if (extraLoc) forced.add(i);
        if (!itemBy.has(item)) itemBy.set(item, i);
        owned.add(item);
        if (item === 'joe' && !trusted && joeTip) {
          trusted = true;
          trust = i;
        } // his rescue line names the real Destroyer
        if (l.areaClear) {
          cleared.add(l.mapNumber ?? l.areaClear);
          clearBy.set(l.mapNumber ?? l.areaClear, i);
        }
        map = reachableMap(state, cleared, rules.gate, rules.gate10);
        explore();
      }
      return false;
    };
    // (the passage stage last: what's shut here is seen before the flight, and what its item opens after it,
    // "return with Machine Gun")
    const stage = locations.filter((l) => l.id === 'passage');
    if (takeAll(locations.filter((l) => l.id !== 'passage')) || (dry && takeAll(stage))) return true;
    // what's here that the player can't do yet: an area's clear, a zone's rooms and talkers (the Permit guard, NZ15's
    // barriers before door B); a probe when none of what's missing was in a clue
    // (a zone's: per door, "Room B: needs Machine Gun" (NZ15's barriers, "Second half": below), but the Permit guard's whole zone, "Enter:
    // needs Permit")
    const blocked: { what: ProbeTarget; key: number; miss: Item[] }[] = [];
    const lacks = (need: Item[]) => need.filter((x) => !owned.has(x) && !SYMBOL[x]);
    if (p >= 1 && p <= 11) {
      const clear = locations.find((l) => l.areaClear && l.at.includes(p));
      if (clear && !got.has(clear.id) && lockOk(clear) && !clear.requires(state))
        blocked.push({ what: { kind: 'enter' }, key: CLEAR_KEY - 1, miss: lacks(fullNeed(clear)) });
    } else if (p >= 13) {
      for (const l of locations) {
        if (
          l.areaClear ||
          l.id === 'passage' ||
          l.id === 'destroyer' ||
          got.has(l.id) ||
          !l.at.includes(p) ||
          l.requires(state)
        )
          continue;
        blocked.push({ what: targetOf(l), key: locKey(l), miss: lacks(fullNeed(l)) });
      }
      for (const s of slots)
        if (s.kind === 'talker' && s.place === p && !done.has(s) && said.has(s))
          blocked.push({
            what: { kind: 'talk', door: talkDoor(s), inside: !!s.inside },
            key: talkKey(s),
            miss: lacks(talkerNeeds(s)),
          });
    }
    const told = (x: Item) => needSrc.has(`${p}|${x}`);
    // (a zone the player is at anyway shows its shut doors, even those a clue told of, else the
    // later "return with Machine Gun" comes from nowhere; nobody goes out of their way to see one)
    let probes = blocked.filter((b) => b.miss.length && (!b.miss.some(told) || (!dry && p >= 13)));
    if (p >= 13 && at(p) === PERMIT_ZONE && probes.some((b) => b.miss.includes('permit')))
      probes = [{ what: { kind: 'enter' }, key: -1, miss: ['permit'] }];
    // (the Destroyers with no clue to which is real: a dead end too)
    const fakes = locations.find(
      (l) => l.id === 'destroyer' && l.at.includes(p) && !got.has(l.id) && l.requires(state) && !lockOk(l),
    );
    if (fakes && !dry && p >= 13) {
      const deps = new Set<number>();
      reach(p, deps);
      const i = add(
        p,
        { act: 'probe', target: { kind: 'destroyerRooms' }, needs: 'destroyerName' },
        deps,
        [],
        undefined,
        undefined,
        locKey(fakes),
      );
      if (allow) forced.add(i);
    }
    if (probes.length) {
      if (dry) return p < 13; // (a zone's dead end alone isn't worth the trip: it's seen when passing by)
      const deps = new Set<number>();
      reach(p, deps);
      for (const b of probes) {
        const i = add(
          p,
          { act: 'probe', target: b.what, needs: b.miss },
          new Set(deps),
          [],
          undefined,
          undefined,
          b.key,
        );
        for (const x of b.miss)
          if (!probeBy.has(`${p}|${x}`)) {
            if (!needSrc.has(`${p}|${x}`)) needSrc.set(`${p}|${x}`, `step:${i}`);
            probeBy.set(`${p}|${x}`, i);
          }
        if (allow) forced.add(i); // (the player went there: shown, needed or not)
      }
    }
    const flown = !got.has('passage') && takeAll(stage) === false && got.has('passage');
    if (steps.length > before && p >= 13) investigated.add(p);
    // (what's still behind a door here: worth a swing-by once the player holds what it takes)
    if (!dry && p >= 13) {
      const left = [
        ...locations
          .filter(
            (l) =>
              !l.areaClear &&
              l.id !== 'passage' &&
              l.id !== 'destroyer' &&
              !got.has(l.id) &&
              l.at.includes(p) &&
              !l.requires(state),
          )
          .map((l) => fullNeed(l)),
        ...slots
          .filter(
            (x) =>
              x.kind === 'talker' &&
              x.place === p &&
              !done.has(x) &&
              said.has(x) &&
              !talkerNeeds(x).every((i) => owned.has(i)),
          )
          .map(talkerNeeds),
      ];
      if (left.length) deadEnds.set(p, left);
      else deadEnds.delete(p);
    }
    if (flown && act(p, true)) act(p); // (back up from the stage: what its item opened here)
    return steps.length > before;
  };
  const eligible = (p: number) =>
    map.has(p) && !(askFirst(p) && (!commBy.has(at(p)) || (commNeeded(p) && !owned.has(commOf(at(p))))));
  /** An enemy area to try: no clue told its communicator, and the player carries one not yet tried there. */
  const COMMS: Item[] = ['alpha', 'beta', 'gamma', 'delta'];
  // (not a dark area a clue said needs the Flare, without it: its comm rooms can't be reached)
  const tryable = (p: number) =>
    p >= 1 &&
    p <= 11 &&
    map.has(p) &&
    !commBy.has(at(p)) &&
    COMMS.some((c) => owned.has(c) && !tried.get(at(p))?.has(c)) &&
    !(isDark(at(p)) && !owned.has('flare') && needSrc.has(`${p}|flare`));
  /** Trying `p`: the right communicator carried, it works (and the visit goes on); else a dead end for now. */
  const attempt = (p: number) => {
    const layout = at(p),
      had = COMMS.filter((c) => owned.has(c));
    tried.set(layout, new Set([...(tried.get(layout) ?? []), ...had]));
    if (!known.has(p)) point(p, undefined, TRIAL);
    if (!commNeeded(p) || owned.has(commOf(layout))) {
      teach(layout, undefined as unknown as number, TRIED);
      // (nothing there the run needs: still a stop that lists it, as a zone looked into; Area 6
      // wasn't shown between 3 and NZ14)
      if (!eligible(p) || !act(p)) {
        const deps = new Set<number>();
        reach(p, deps);
        add(p, { act: 'look' }, deps, [], undefined, undefined, -2);
      }
      return;
    }
    const deps = new Set<number>();
    reach(p, deps);
    // (three communicators tried there: the fourth it must be)
    const left = COMMS.filter((c) => !tried.get(layout)!.has(c));
    failed.add(
      add(
        p,
        {
          act: 'probe',
          target: { kind: 'comm', room: (COMM_ROOMS[layout] ?? 'A')[0] as 'A' | 'B' },
          needs: left.length === 1 ? [left[0]] : 'anotherComm',
        },
        deps,
        [],
        undefined,
        undefined,
        CLEAR_KEY - 1,
      ),
    );
  };
  // Neutral zones on the way (no risk in looking): flying to the next place, at any node of the path
  // where a zone not yet looked into is nearer than the destination, the player swings by it first (the second pass,
  // whose steps the route shows). Its visit lists what's there (the zone's lines; "Enter: needs Permit" if so).
  const investigated = new Set<number>(),
    forced = new Set<number>(),
    swung = new Set<number>(); // (swung: steps of a swing-by)
  const deadEnds = new Map<number, Item[][]>(); // zone -> what its closed doors take
  const opens = (z: number) => deadEnds.get(z)?.some((need) => need.every((i) => owned.has(i))) ?? false;
  const ZONES = [13, 14, 15, 16, 17, 18, 19];
  const EPS = 1e-9;
  const detour = (target: number) => {
    if (target === UNDERGROUND) return undefined;
    const dH = roadsFrom(here),
      dT = roadsFrom(target),
      total = dH.get(target);
    if (total === undefined) return undefined;
    // (on the way: the path's nodes; at 5 flying 15 -> 5 -> 2, NZ16 is nearer than Area 2)
    const path = [...dH]
      .filter(([n, v]) => Math.abs(v + (dT.get(n) ?? 99) - total) < EPS && n !== target)
      .sort((a, b) => a[1] - b[1]);
    for (const [n] of path) {
      const dn = roadsFrom(n),
        toT = dT.get(n)!;
      // (nearer than the destination, and not behind: the detour adds at most one road out and back)
      const z = ZONES.filter(
        (z) =>
          z !== target &&
          (!investigated.has(z) || opens(z)) &&
          map.has(z) &&
          (dn.get(z) ?? 99) < toT - EPS &&
          dn.get(z)! + (dT.get(z) ?? 99) - toT <= 2 + EPS,
      ).sort((a, b) => dn.get(a)! - dn.get(b)! || a - b)[0];
      if (z !== undefined) return z;
    }
    return undefined;
  };
  let headed: number | undefined; // (where the player was flying when they swung by a zone: they carry on there)
  // Finishing first: once all Area 12 still needs is what the player knows where to get and can get
  // now (Joe, his area named; Areas 10 and 11), they go straight for it, then to Area 12, with no detours.
  const needs12 = area12NeedsJoe(rules.area12),
    needs1011 = area12Needs1011(rules.area12);
  const canClear = (p: number) => {
    const l = locations.find((x) => x.areaClear && x.at.includes(p));
    return !!l && !got.has(l.id) && lockOk(l) && l.requires(state) && eligible(p);
  };
  const finishing = (): number[] | undefined => {
    if (!map.has(12) || (rules.area12Comm && !owned.has(rules.area12Comm))) return undefined;
    const left = [
      ...(needs12 && !owned.has('joe') ? [joeAt ?? -1] : []),
      ...(needs1011 ? [10, 11].filter((n) => !cleared.has(n)) : []),
    ];
    return left.length && left.every((p) => p >= 0 && canClear(p)) ? left : undefined;
  };
  for (let guard = 0; guard < 2000; guard++) {
    if (canFinish(state, cleared, rules.area12, map, rules.area12Comm)) break;
    let progress = false;
    const d = roadsFrom(here);
    // (nearest first; a tie goes to the lower map number)
    const near = (ps: number[]) =>
      ps
        .map((p) => ({ p, d: d.get(p) ?? 99 }))
        .sort((x, y) => (Math.abs(x.d - y.d) < EPS ? x.p - y.p : x.d - y.d))
        .map((x) => x.p);
    const end = finishing();
    // (a zone is a destination for a clue that points there, or to open a door it couldn't before; else it's seen on
    // the way; a player out of leads looks into the nearest one anyway)
    // (a revealed passage stage is a lead to the zones it's flown from: the Flare there before trials elsewhere)
    const stage = locations.find((l) => l.id === 'passage');
    const entrances = stage && owned.has('passage') && !got.has(stage.id) ? stage.at.filter((m) => map.has(m)) : [];
    const lead = (p: number) => p < 13 || known.get(p)?.src !== ON_THE_WAY || opens(p) || entrances.includes(p);
    const all = near([...new Set([...known.keys(), ...entrances])]);
    let order = end ?? all.filter(lead);
    if (!end && headed !== undefined && eligible(headed) && act(headed, true)) order.unshift(headed);
    headed = undefined;
    // (a place the player knows how to do always beats a trial, whatever the distance)
    // (then a neutral zone not yet looked into, free to look at; then an enemy area by trial and error. With no hints
    // (None, Nonsense) whichever is nearest: the player checks every place along the way)
    if (!end && !order.some((p) => eligible(p) && act(p, true))) {
      const unseen = ZONES.filter((z) => map.has(z) && (!investigated.has(z) || (guessing && act(z, true))));
      const trial = enabled ? undefined : near([...unseen, ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].filter(tryable)])[0];
      if (trial !== undefined && trial <= 11) {
        attempt(trial);
        here = trial;
        continue;
      }
      if (unseen.length) {
        order = near([...known.keys(), ...unseen]);
        exploring = true;
      } else {
        const t = near([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]).find(tryable);
        if (t !== undefined) {
          attempt(t);
          here = t;
          continue;
        }
      }
    }
    for (const p of order) {
      if (!eligible(p) || (!act(p, true) && !(p >= 13 && !investigated.has(p)))) continue;
      const z = end ? undefined : detour(p);
      if (z !== undefined) {
        // (looking into a zone: what can be done there, else just a stop that lists it)
        const before = steps.length;
        if (!eligible(z) || !act(z)) {
          const deps = new Set<number>();
          reach(z, deps);
          add(z, { act: 'look' }, deps, [], undefined, undefined, -2);
        }
        for (let i = before; i < steps.length; i++) {
          forced.add(i);
          swung.add(i);
        }
        investigated.add(z);
        here = z;
        headed = p;
        progress = true;
        break;
      }
      act(p);
      exploring = false;
      if (p !== UNDERGROUND) here = p;
      progress = true;
      break; // (then look again from here)
    }
    if (!progress && !guessing) {
      guessing = true;
      continue;
    }
    if (!progress) throw new Error('hints: the finished hints do not lead to the end');
  }
  const deps = new Set<number>();
  reach(12, deps);
  const joe = area12NeedsJoe(rules.area12),
    areas = area12Needs1011(rules.area12);
  if (joe) deps.add(itemBy.get('joe')!);
  if (areas) [10, 11].forEach((n) => deps.add(clearBy.get(n)!));
  // (Area 12's door locks: its comm opens the power systems' doors, COMMUNICATE in its comm rooms)
  const comm12 = rules.area12Comm;
  if (comm12) deps.add(itemBy.get(comm12)!);
  const last = add(12, { act: 'area12' }, deps, comm12 ? [comm12] : []); // (its steps: area12Steps)
  // keep what the win depends on
  const keep = new Set<number>();
  const visit = (i: number) => {
    if (!keep.has(i)) {
      keep.add(i);
      steps[i].deps.forEach(visit);
    }
  };
  visit(last);
  // (the first clue read on Joe's trail, once he's rescued: it's the first the player heard of where he is,
  // whatever later lines repeat)
  const joePath = (s?: Slot) =>
    !!s &&
    (s.ys.includes(JOE_POINTER_Y) ||
      s.facts.some((f) => f.kind === 'trail' || (f.kind === 'find' && f.item === 'joe')));
  const firstJoe = [...steps.keys()].find(
    (i) => joePath(steps[i].slot) && !steps[i].optional && steps[i].act.act !== 'probe',
  );
  // (not when the trail's clear came first: "Joe was moved" was the first news of him, and a line that he's still
  // there is stale)
  const trailClear = trailPlace !== undefined ? clearBy.get(trailPlace) : undefined;
  if (
    firstJoe !== undefined &&
    (trailClear === undefined || firstJoe < trailClear) &&
    keep.has(itemBy.get('joe') ?? -1)
  )
    visit(firstJoe);
  // (every step the player took is shown; what the win didn't depend on, in italics: they couldn't know beforehand)
  const marker = (a: Act) => a.act === 'probe' || a.act === 'look' || a.act === 'area12';
  const shown = (i: number) => keep.has(i) || steps[i].optional || marker(steps[i].act); // (else optional)
  // one entry per visit: consecutive steps in the same place
  type Line = {
    act: Act;
    optional?: boolean;
    key?: number;
    slot?: string;
    step?: number;
    extra?: boolean;
    also?: number[];
  };
  type Visit = {
    place: number;
    go: Why[];
    texts: Line[];
    bring: [Item, Basis][];
    slots: Map<Slot, number>;
    ids: number[];
  };
  const isProbe = (t: Line) => t.act.act === 'probe';
  const decoyClear =
    trailPlace !== undefined && keep.has(clearBy.get(trailPlace) ?? -1) ? clearBy.get(trailPlace) : undefined;
  const join = (into: Visit, i: number) => {
    const { bring, slot, key } = steps[i],
      optional = !shown(i) || !!steps[i].optional;
    const act: Act =
      i === decoyClear && steps[i].act.act === 'clear'
        ? { ...(steps[i].act as RouteAction & { act: 'clear' }), trail: true }
        : steps[i].act;
    into.ids.push(i);
    // (a line read for its clue and again to open the door, in one visit: once, with the note)
    const twice = slot && into.slots.get(slot);
    const extra = !keep.has(i);
    // (italic only if neither read was needed, 6a's clue told Area 11's comm)
    if (twice !== undefined) {
      const both = extra && !!into.texts[twice].extra;
      into.texts[twice] = { act, optional: both && optional, key, slot: slot?.id, step: i, extra: both };
    } else {
      if (slot) into.slots.set(slot, into.texts.length);
      into.texts.push({ act, optional, key, slot: slot?.id, step: i, extra });
    }
    for (const b of bring) if (!into.bring.some(([x]) => x === b[0])) into.bring.push(b);
  };
  let visits: Visit[] = [];
  for (const i of steps.keys()) {
    const last = visits.at(-1);
    join(
      last?.place === steps[i].place
        ? last
        : visits[
            visits.push({ place: steps[i].place, go: steps[i].go, texts: [], bring: [], slots: new Map(), ids: [] }) - 1
          ],
      i,
    );
  }
  const seq = visits; // (the replay flies them in order, stopping on the way)
  // (moved next to another visit of the same place: one visit)
  visits = [];
  for (const v of seq) {
    const last = visits.at(-1);
    const probe = (w: Visit) => w.texts.some(isProbe); // (a probe stays its own visit)
    if (last?.place === v.place && !probe(last) && !probe(v)) v.ids.forEach((i) => join(last, i));
    else visits.push(v);
  }
  /** Of a place's visits, the first that does something (not just a probe). */
  const doing = (mine: Visit[]) => mine.find((w) => w.texts.some((t) => !isProbe(t))) ?? mine[0];
  // every step of a listed area, in the rooms' order: Comm and Wiretap of each comm room, then
  // Clear; what the route doesn't need on its first visit, marked "(optional) " (the page shows it in italics)
  for (const v of visits) {
    // (on the visit that clears it: a probe's visit only says what was missing)
    const mine = visits.filter((w) => w.place === v.place);
    if (
      v.place < 1 ||
      v.place > 11 ||
      (mine.find((w) => w.texts.some((t) => t.key === CLEAR_KEY)) ?? doing(mine)) !== v
    )
      continue;
    if (v.texts.some((t) => isProbe(t) && t.key === CLEAR_KEY - 1)) continue; // (a dead end: nothing past it listed)
    const layout = at(v.place),
      all = visits.filter((w) => w.place === v.place).flatMap((w) => w.texts);
    const has = (key: number) => all.some((t) => t.key === key);
    [...(COMM_ROOMS[layout] ?? '')].forEach((letter) => {
      for (const wire of [false, true]) {
        const id = `O${layout}${letter}${wire ? ' wiretap' : ''}`,
          key = roomKey(id);
        if (has(key)) continue;
        const s = slots.find((x) => x.id === id && x.kind === (wire ? 'wire' : 'comm'));
        v.texts.push({ act: roomText(id, wire, s), optional: true, key, slot: s?.id });
      }
    });
    const clear = locations.find((l) => l.areaClear === layout);
    if (clear && !has(CLEAR_KEY))
      v.texts.push({ act: { act: 'clear', item: placement.get(clear.id)! }, optional: true, key: CLEAR_KEY });
  }
  // and of a listed zone: its talkers and doors, on each visit what's newly open (back
  // in NZ15 with the Permit, its Room B's bullet too; the player goes into every room they can)
  for (const v of visits) {
    if (v.place < 13) continue;
    if (v.texts.some((t) => t.key === -1 && isProbe(t))) continue; // (the Permit guard: nothing else to see)
    const all = visits.filter((w) => w.place === v.place).flatMap((w) => w.texts);
    // (listed: done on some visit, anything on this one, or a dead end told before that's still shut)
    const has = (key: number, open = true) =>
      all.some((t) => t.key === key && (!isProbe(t) || !open)) || v.texts.some((t) => t.key === key);
    // (what's behind a door the player can't get through yet says so, by what they held then)
    const had = steps[v.ids[0]].had,
      holds = { has: (x: Item) => had.has(x) };
    const needs = (need: Item[]) => need.filter((x) => !had.has(x));
    for (const s of slots) {
      if (s.kind !== 'talker' || s.place !== v.place) continue;
      const miss = needs(talkerNeeds(s));
      if (has(talkKey(s), !miss.length)) continue;
      v.texts.push(
        miss.length
          ? {
              act: { act: 'probe', target: { kind: 'talk', door: talkDoor(s), inside: !!s.inside }, needs: miss },
              key: talkKey(s),
            }
          : { act: talkText(s), optional: true, key: talkKey(s), slot: s.id },
      );
    }
    for (const l of locations) {
      if (l.areaClear || l.id === 'passage' || !l.at.includes(v.place) || has(locKey(l), l.requires(holds))) continue;
      v.texts.push(
        l.requires(holds)
          ? { act: howOf(l, placement.get(l.id)!), optional: true, key: locKey(l) }
          : { act: { act: 'probe', target: targetOf(l), needs: needs(fullNeed(l)) }, key: locKey(l) },
      );
    }
    // (the buildings with ammo or a 1UP, outside the shuffle: "Room B: obtain 11 bullets")
    for (const [room, d] of doors) {
      const key = zoneKey(d.slot ? 'B' : 'A', 1);
      if (spot(zoneNode(d.zone)) !== v.place || itemRooms.has(room) || !AMMO_ROOMS.includes(room)) continue;
      const open = doorRequires(d.zone, d.slot, nz15)(holds);
      if (has(key, open)) continue;
      const { item, bullets } = roomContents(room, itemRooms),
        door = d.slot ? 'B' : 'A';
      v.texts.push(
        open
          ? { act: { act: 'room', door, ...(item && { item }), ...(bullets && { bullets }) }, optional: true, key }
          : {
              act: { act: 'probe', target: { kind: 'room', door }, needs: needs([d.zone === 0x0d ? 'permit' : nz15!]) },
              key,
            },
      ); // (the Permit guard, or NZ15's barriers)
    }
  }
  // NZ15's barriers shut off the zone's second half (door B, its talkers): one line for it, "Second half: needs
  // Machine Gun", not one per room and talker; a reference to any of them points at it
  if (nz15)
    for (const v of visits) {
      if (v.place < 13 || at(v.place) !== 15) continue;
      const shut = v.texts.filter(
        (t) =>
          t.act.act === 'probe' && Array.isArray(t.act.needs) && t.act.needs.length === 1 && t.act.needs[0] === nz15,
      );
      if (!shut.length) continue;
      const also = shut.flatMap((t) => [...(t.step !== undefined ? [t.step] : []), ...(t.also ?? [])]);
      shut[0].act = { act: 'probe', target: { kind: 'secondHalf' }, needs: [nz15] };
      shut[0].also = also.filter((i) => i !== shut[0].step);
      v.texts = v.texts.filter((t) => !shut.includes(t) || t === shut[0]);
    }
  // an area visit in the rooms' order (its lines all have keys; a zone's keep the order played)
  for (const v of visits) if (v.texts.every((t) => t.key !== undefined)) v.texts.sort((a, b) => a.key! - b.key!);
  // what the visit takes, up front: in an enemy area its communicator first, or "No communicator
  // needed", with how the player knows; then the rest (not the passage, Joe, nor what the map's gates check by
  // ownership: the IFF Code, the Flak Map)
  const NOT_CARRIED = new Set<Item>(['passage', 'joe', 'iff', 'flak']);
  const commLine = (p: number): RouteNeed[] => {
    if (p < 1 || p > 12) return [];
    const c = p === 12 ? comm12 : commNeeded(p) ? commOf(at(p)) : undefined;
    if (c) return [{ need: { item: c }, basis: reqSrc(c, p) }];
    const src = p === 12 ? undefined : commSrc.get(at(p));
    return [
      {
        need: { special: 'noComm' },
        basis:
          src === TRIED
            ? { kind: 'trial' }
            : src
              ? { kind: 'per', by: [ref(src)] }
              : { kind: p === 12 ? 'none' : 'checkArea' },
      },
    ];
  };
  const step = (t: Line): RouteStep => ({
    ...(t.act as RouteAction),
    ...(t.optional && { optional: true }),
    ...((t.extra || (t.step === undefined && t.optional)) && { extra: true }),
  });
  // step 0, the briefing: its line about our agents, verbatim (story.ts, message $F8); Nonsense's
  // briefing says nothing of the kind, so there it's only "Start with"
  const nonsense = level === 'nonsense';
  const briefing: RouteVisit = {
    place: { kind: 'briefing' },
    why: [],
    needs: [],
    steps: [
      { act: 'start', item: 'alpha' }, // (0a; the briefing's line 0b)
      ...(nonsense
        ? []
        : [
            {
              act: 'briefing' as const,
              quote: `THERE ARE MANY AGENTS IN AREA ${spot(1)} NOW. FIRST,${input.typosFixed ? ' ' : ''}GO SEE THEM.`,
            },
          ]),
    ],
  };
  // the clues' places as route steps: the first line read from each slot ("1c"), and the step Joe was rescued in
  const refs = new Map<string, Source>([
    ['start', { kind: 'step', entry: 0, step: 0 }],
    ...(nonsense ? [] : ([['briefing', { kind: 'step', entry: 0, step: 1 }]] as [string, Source][])),
  ]);
  const joeStep = itemBy.get('joe');
  visits.forEach((v, k) =>
    v.texts
      .filter((t) => t.act.act !== 'look')
      .forEach((t, j) => {
        // (the hidden marker takes no letter)
        const at: Source = { kind: 'step', entry: k + 1, step: j };
        if (t.slot && !refs.has(t.slot)) refs.set(t.slot, at);
        if (t.step !== undefined) refs.set(`step:${t.step}`, at);
        for (const i of t.also ?? []) refs.set(`step:${i}`, at);
        if (joeStep !== undefined && t.step === joeStep && !refs.has('joe')) refs.set('joe', at);
      }),
  );
  /** The placeholders (`ref`) pointed at the route's steps; a slot the route never reads stays named. */
  const resolve = <T>(x: T): T =>
    mapSources(x, (s) =>
      s.kind !== 'slot'
        ? s
        : (refs.get(s.slot) ??
          (s.slot === 'briefing' || s.slot === 'start'
            ? { kind: 'briefing' }
            : s.slot === 'joe'
              ? { kind: 'joeRescue' }
              : s)),
    );
  // Area 12: what its entry takes, and its steps by option "Area 12 Door Locks" (Comm A in $35,
  // Comm B in $36, the officer in $21 behind tower $5F's door 1; power systems 1 and 2 bring its barriers down)
  const entry12: RouteNeed[] = [
    ...(joe ? [{ item: 'joe' as Item }] : []),
    ...(areas ? [{ cleared: 10 }, { cleared: 11 }] : []),
  ].map((need) => ({ need, basis: { kind: 'settings' } }));
  /** A return after a probe: "return with Flare" (what the probe found missing). */
  const backWith = (v: Visit, k: number): Why | undefined => {
    const found = visits
      .slice(0, k)
      .filter((w) => w.place === v.place)
      .flatMap((w) => w.texts)
      .filter(isProbe);
    // (or what a clue said it takes, got since the last time there: "return with Machine Gun, per 4a" is its requirement)
    const last = visits
        .slice(0, k)
        .filter((w) => w.place === v.place)
        .at(-1)!,
      had = steps[last.ids[0]].had,
      now = steps[v.ids[0]].had;
    // (a comm found missing: the area's if carried now, else the ones got since, to try, not "return
    // with β" before having it)
    const comm = commOf(at(v.place)),
      fresh = COMMS.filter((c) => now.has(c) && !had.has(c));
    const what = (t: Line): (Item | 'anotherComm' | 'destroyerName')[] => {
      const needs = (t.act as RouteAction & { act: 'probe' }).needs;
      return needs === 'anotherComm'
        ? now.has(comm)
          ? [comm]
          : fresh.length
            ? fresh
            : ['anotherComm']
        : needs === 'destroyerName'
          ? [needs]
          : needs;
    };
    const since = v.bring.filter(([i]) => !had.has(i) && !NOT_CARRIED.has(i) && !SYMBOL[i]).map(([i]) => i);
    const all = [...new Set([...found.flatMap(what), ...since])];
    return all.length ? { kind: 'returnWith', items: all } : undefined;
  };
  const entries: RouteVisit[] = visits.map((v, k) => {
    const back =
      (destroyerStep !== undefined && v.ids.includes(destroyerStep)) ||
      visits.findIndex((w) => w.place === v.place) === k
        ? undefined
        : [
            ...[backWith(v, k)].filter((w) => w !== undefined),
            ...(v.ids.some((i) => swung.has(i)) ? [{ kind: 'onTheWay' } as const] : []),
          ]; // ("return with Machine Gun, on the way to NZ13")
    return {
      place: placeOf(v.place),
      why: resolve(
        destroyerStep !== undefined && v.ids.includes(destroyerStep)
          ? steps[destroyerStep].go
          : back?.length
            ? back
            : v.go,
      ),
      needs: resolve([
        ...(v.ids.some((i) => failed.has(i))
          ? [{ need: { special: 'commUnknown' }, basis: { kind: 'trial' } } as RouteNeed]
          : commLine(v.place)),
        ...v.bring
          .filter(([i]) => !NOT_CARRIED.has(i) && !SYMBOL[i])
          .map(([item, basis]) => ({ need: { item }, basis })),
        ...(v.place === 12 ? entry12 : []),
        ...(destroyerIntel && v.ids.includes(destroyerStep!)
          ? [{ need: { special: 'destroyerIntel' }, basis: { kind: 'per', by: destroyerIntel } } as RouteNeed]
          : []),
        ...(!destroyerIntel && !enabled && v.ids.includes(destroyerStep!)
          ? [{ need: { special: 'hp3' }, basis: { kind: 'trial' } } as RouteNeed]
          : []),
        ...steps[v.ids[0]].paths.map((need): RouteNeed => ({ need, basis: { kind: 'settings' } })),
      ]), // (the map's gates)
      steps: resolve(
        v.texts.flatMap((t) =>
          t.act.act === 'area12' ? area12Steps(input.area12Locks ?? 'none') : t.act.act === 'look' ? [] : [step(t)],
        ),
      ),
    };
  });
  // Joe's area: "searching for Joe per 14b", the line that said he's there
  const rescue = itemBy.get('joe'),
    named = joeFindBy !== undefined && rescue !== undefined && joeFindBy < rescue ? steps[joeFindBy].slot : undefined;
  if (named)
    visits.forEach((v, k) => {
      if (!v.ids.includes(rescue!)) return;
      const back = entries[k].why[0]?.kind === 'returnWith' ? [entries[k].why[0]] : []; // ("return with Rocket Launcher, searching for Joe per 16b")
      entries[k].why = resolve([
        ...back,
        { kind: 'searchingForJoe', by: [ref(named.id)] },
        ...(entries[k].why.some((w) => w.kind === 'area12Entry') ? [{ kind: 'area12Entry' } as const] : []),
      ]);
    });
  // "on the way to Area 2": the next place the route is really headed for
  entries.forEach((e, k) => {
    const w = e.why.find((x) => x.kind === 'onTheWay' && !x.to);
    if (!w) return;
    const next = entries.slice(k + 1).find((n) => n.why.length && !n.why.some((x) => x.kind === 'onTheWay'));
    if (next) (w as Why & { kind: 'onTheWay' }).to = next.place;
  });
  return [briefing, ...entries];
}
