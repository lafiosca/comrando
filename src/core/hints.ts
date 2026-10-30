// Seed hints (docs/design.md#hints). A guided player is simulated: they start knowing only the briefing's area, go only
// where some line has pointed them (or into any neutral zone they pass, which needs no communicator), read a comm room only when they know which communicator it takes, and clear a
// comm-locked area only when they know its comm. Each hint slot is decided when that player first reads it, and it
// points at the next step of a minimal path to Area 12; if the player gets stuck, the missing step is added to a
// slot they've already read. So every seed has a chain of clues from the briefing to the end. Slots left over get
// communicator chains and gear hints at random, in varied wordings ("a toolbox, not rails").
//
// Slot ids and message numbers: docs/rom-notes.md#comm-rooms; door talkers: #building-people.

import { intendedRoute, type RouteContext } from './route.ts';
import type { SpoilerHint } from './spoiler.ts';
import {
  ALLY_WIRES,
  areaList,
  ENEMY_COMMANDER,
  ENEMY_SOLDIER,
  type Fact,
  FLAVOR,
  HASTY_ROOM,
  HASTY_Y,
  type HintInput,
  type HintOutput,
  IN_REGION,
  INFORMER_ROOM,
  INTERCEPT,
  JOE_POINTER_Y,
  JOE_RESCUE_Y,
  KEY_ITEMS,
  LIES,
  NAMES,
  NEEDED_AT,
  NZ13A_Y,
  PERMIT_ZONE,
  PLURAL,
  REGION_AREAS,
  regionOf,
  RESTRICTED,
  ROOM_SLOTS,
  type Slot,
  SPY_SLOT,
  SYMBOL,
  TALKERS,
  UNDERGROUND,
  WIRE_FLAVOR,
} from './hintdata.ts';
import { type Placement, sweep } from './logic.ts';
import type { Rng } from './rng.ts';
import {
  BOMBER_Y,
  NONSENSE_GUARD_Y,
  NONSENSE_KILLT_Y,
  NONSENSE_RADIO_Y,
  NONSENSE_TALK_Y,
  NONSENSE_RESCUE_Y,
  type NonsenseSlot,
} from './nonsense.ts';
import { type Message, messageForY, RADIO_PAGE, wrap } from './text.ts';
import {
  area12Needs1011,
  canFinish,
  HINT_COMM_AREAS,
  VANILLA_COMMS,
  type Item,
  type Location,
  reachableMap,
  type Rules,
  START_ITEMS,
  zoneNode,
} from './world.ts';

/**
 * A minimal set of locations that still beats the seed: drop locations one at a time (random order) while the seed
 * stays beatable without them. Alternatives (IFF Code or passage) resolve to one of them.
 */
function minimalPath(locations: Location[], placement: Placement, rules: Rules, rng: Rng): Set<string> {
  const off = new Set<string>();
  const view = () => locations.map((l) => (off.has(l.id) ? { ...l, requires: () => false } : l));
  for (const l of rng.shuffle([...locations])) {
    off.add(l.id);
    if (!sweep(view(), placement, rules).canFinish) off.delete(l.id);
  }
  return new Set(locations.filter((l) => !off.has(l.id)).map((l) => l.id));
}

class Stuck extends Error {}

/** Hints for a seed. The choices are random, so a dead end in the guided play is retried with fresh ones. */
export function makeHints(input: HintInput, rng: Rng): HintOutput {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      return buildHints(input, rng);
    } catch (e) {
      if (!(e instanceof Stuck)) throw e;
    }
  }
  throw new Error('hints: no guided path found');
}

function buildHints(input: HintInput, rng: Rng): HintOutput {
  const {
    locations,
    placement,
    rules,
    spot,
    at,
    comms,
    doors,
    itemRooms,
    level,
    moles,
    nz15,
    dark = [4],
    locked = [1, 4, 8],
  } = input;
  const hintLocations = locations;
  /** Comm-locked layouts besides O1 (always α, which the player knows). */
  const LOCKED = locked.filter((n) => n !== 1);
  const isDark = (layout: number) => dark.includes(layout);
  const enabled = level !== 'vanilla' && level !== 'nonsense';
  const commCap = level === 'verbose' ? 3 : level === 'terse' ? 1 : 2;
  // how an item clue about Areas 1-11 comes out (in 100): a two-area guess, a region, else exact
  const decoyChance = level === 'verbose' ? 0 : level === 'terse' ? 45 : 30;
  const regionChance = level === 'verbose' ? 0 : level === 'terse' ? 30 : 10;
  /** [item, layout] it's needed at. */
  const neededAt: [Item, number][] = [
    ...dark.map((l) => ['flare', l] as [Item, number]),
    ...(Object.entries(NEEDED_AT) as [Item, number][]),
    ...(nz15 ? [[nz15, 15] as [Item, number]] : []),
  ];
  const barrier = (f: Fact) => f.kind === 'need' && f.item === nz15 && f.place === spot(15);
  const commOf = (layout: number) => comms[layout];
  // the vanilla comm lists (4A, 8A) and Area 9's line are only wrong once the comms move
  const commsMoved = comms.some((c, n) => n > 0 && c !== VANILLA_COMMS[n]);
  const usable = (c: Item) => HINT_COMM_AREAS.filter((n) => commOf(n) === c).map(spot);
  const behind = (zone: number, slot: number) => [...doors].find(([, d]) => d.zone === zone && d.slot === slot)?.[0];

  const slots: Slot[] = [
    ...ROOM_SLOTS.map(
      ([id, layout, kind, ys, forced, joeLine]): Slot => ({
        id,
        kind,
        layout,
        ys,
        forced,
        lie: LIES.has(id) && !locked.includes(LIES.get(id)!),
        joeLine,
        place: spot(layout),
        facts: [],
        cap: kind === 'comm' ? commCap : 1,
        read: false,
      }),
    ),
    ...TALKERS.map(
      ([layout, y, zone, s]): Slot => ({
        id: `NZ${spot(layout)} door ${s ? 'B' : 'A'} talker`,
        kind: 'talker',
        layout,
        ys: [y],
        place: spot(layout),
        facts: [],
        cap: 1,
        read: false,
        door: itemRooms.get(behind(zone, s)!),
      }),
    ),
    {
      id: `NZ${spot(13)} door A talker`,
      kind: 'talker',
      layout: 13,
      ys: [NZ13A_Y],
      place: spot(13),
      facts: [],
      cap: 1,
      read: false,
      own: true,
    },
    ...[doors.get(HASTY_ROOM)]
      .filter((d) => d)
      .map(
        (d): Slot => ({
          id: `NZ${spot(zoneNode(d!.zone))} door ${d!.slot ? 'B' : 'A'} inside talker`,
          kind: 'talker',
          layout: zoneNode(d!.zone),
          ys: [HASTY_Y],
          place: spot(zoneNode(d!.zone)),
          facts: [],
          cap: 1,
          read: false,
          inside: d,
        }),
      ),
  ];
  /** What a talker takes to reach: NZ14's guard wants the Permit; a door's barrier its weapon. */
  const talkerNeeds = (s: Slot): Item[] =>
    s.layout === PERMIT_ZONE
      ? ['permit']
      : s.layout === 15 && (s.inside ? s.inside.slot === 1 : / door B /.test(s.id)) && nz15
        ? [nz15]
        : [];
  const alphaSlot = slots.find((s) => s.id === 'O1B')!;
  if (enabled) alphaSlot.facts.push({ kind: 'alpha', areas: usable('alpha').filter((n) => n !== spot(1)) });

  const locOf = (item: Item) => locations.find((l) => placement.get(l.id) === item);
  /** Map number p has a comm room the player will want to use (6 has none, 7's was cut, 12's are story). */
  const needsComm = (p: number) => p >= 1 && p <= 11 && HINT_COMM_AREAS.includes(at(p));
  /** With no hints (None, Nonsense) a comm room says nothing worth bringing a comm for: only a comm-locked area needs
   * one (an area without a lock is cleared without one). */
  const commNeeded = (p: number) => (enabled ? needsComm(p) : p >= 1 && p <= 11 && locked.includes(at(p)));
  /** Before entering enemy area p, the player wants to know what to bring: its comm, or that it has no comm room. */
  const askFirst = (p: number) => p >= 1 && p <= 11;
  /** Where a clue sends the player for a location: its map number, or UNDERGROUND for the passage stage's pickup. */
  const placeOf = (l: Location) => (l.id === 'passage' ? UNDERGROUND : l.at[0]);
  /** A map number to name as where a comm is held (none for the passage stage). */
  const heldPlace = (l?: Location) => (l && l.id !== 'passage' ? placeOf(l) : undefined);

  let pathIds = new Set<string>();
  let joeTip = true; // Joe names the real Destroyer (not when the guided player took the Destroyer item before him)
  const readOrder: Slot[] = []; // slots in the order the guided player reads them
  if (enabled) {
    // --- the guided player ---
    pathIds = minimalPath(locations, placement, rules, rng);
    const order = new Map<string, number>();
    sweep(locations, placement, rules).spheres.forEach((sp, i) => sp.forEach((g) => order.set(g.location, i)));
    const path = locations
      .filter((l) => pathIds.has(l.id))
      .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));

    const owned = new Set<Item>(START_ITEMS);
    const state = { has: (i: Item) => owned.has(i) };
    const cleared = new Set<number>();
    const got = new Set<string>();
    const known = new Set<number>(); // map numbers the player has been pointed to
    const knownComm = new Set<number>([1]); // layouts whose comm the player knows
    let trusted = false; // knows which Destroyer is real (Joe's rescue line, or both moles named)
    const molesKnown = new Set<number>();
    const point = (n: number) => known.add(n);
    // neutral zones need no communicator, so a player passing one looks inside for free intel and items (its
    // Permit guard and NZ15's barriers still apply, through the locations' requirements)
    const explore = () =>
      map.forEach((n) => {
        if (n >= 13) point(n);
      });
    point(spot(1)); // the briefing
    if (area12Needs1011(rules.area12)) {
      point(10);
      point(11);
    } // Area 12's refusal names them

    const learn = (f: Fact) => {
      if (f.kind === 'alpha') {
        usable('alpha').forEach((n) => knownComm.add(at(n)));
        f.areas.forEach(point);
      }
      if (f.kind === 'find' || f.kind === 'need' || f.kind === 'passage' || f.kind === 'visit') {
        point(f.place);
        if (f.kind === 'find' && f.decoy) point(f.decoy);
        if (f.kind === 'find' && f.region) REGION_AREAS[f.region].forEach(point);
      }
      if (f.kind === 'comm')
        f.areas.forEach((n) => {
          knownComm.add(at(n));
          point(n);
        });
      if (f.kind === 'noroom')
        f.areas.forEach((n) => {
          knownComm.add(at(n));
          point(n);
        }); // also a next step
      if (f.kind === 'mole') {
        molesKnown.add(f.mole);
        trusted ||= molesKnown.size === 2;
        point(f.place);
      }
    };
    const readable = (s: Slot) =>
      s.kind === 'talker'
        ? talkerNeeds(s).every((i) => owned.has(i))
        : knownComm.has(s.layout) && owned.has(commOf(s.layout)) && (!isDark(s.layout) || owned.has('flare'));
    const lockKnown = (l: Location) =>
      (l.id !== 'destroyer' || trusted) &&
      (!l.areaClear || !LOCKED.includes(l.areaClear) || knownComm.has(l.areaClear));

    /** What the player still has to learn, most actionable first. */
    const needs = (map: Set<number>): { fact: Fact; now: boolean }[] => {
      const out: { fact: Fact; now: boolean; rank: number }[] = [];
      path.forEach((l, i) => {
        if (got.has(l.id) || known.has(placeOf(l))) return;
        const item = placement.get(l.id)!;
        if (item === 'oneup') return; // (a 1UP clear on the path, e.g. for the vanilla road gate: nothing to name)
        const fact: Fact =
          item === 'passage' ? { kind: 'passage', place: placeOf(l) } : { kind: 'find', item, place: placeOf(l) };
        out.push({ fact, now: l.at.some((m) => map.has(m)) && l.requires(state), rank: i });
      });
      const dl = path.find((x) => x.id === 'destroyer');
      if (dl && !got.has(dl.id) && !trusted) {
        for (const m of [0, 1]) {
          if (!molesKnown.has(m))
            out.push({
              fact: { kind: 'mole', place: placeOf(dl), mole: m },
              now: map.has(placeOf(dl)),
              rank: path.indexOf(dl),
            });
        }
      }
      // the comm of every area the path still needs, grouped by comm
      const unknown = new Map<Item, number[]>();
      for (const l of path) {
        const p = placeOf(l);
        // (radio silence also sends the player there, so it can name an area they haven't been pointed to yet)
        if (got.has(l.id) || !askFirst(p) || knownComm.has(at(p)) || (needsComm(p) && !known.has(p))) continue;
        const c = needsComm(p) ? commOf(at(p)) : ('none' as Item),
          ps = unknown.get(c) ?? [];
        if (!ps.includes(p)) unknown.set(c, [...ps, p]);
      }
      for (const [c, ps] of unknown) {
        out.push({
          fact: c === ('none' as Item) ? { kind: 'noroom', areas: ps } : commFact(c, ps),
          now: ps.some((p) => map.has(p)),
          rank: -1,
        });
      }
      for (const n of LOCKED) {
        const l = path.find((x) => x.areaClear === n);
        if (!l || got.has(l.id) || knownComm.has(n)) continue;
        out.push({ fact: commFact(commOf(n), [spot(n)]), now: owned.has(commOf(n)), rank: -1 });
      }
      return out.sort((a, b) => Number(b.now) - Number(a.now) || a.rank - b.rank);
    };
    /** Already learned since the needs were listed. */
    const stale = (f: Fact) =>
      f.kind === 'comm' || f.kind === 'noroom'
        ? f.areas.every((n) => knownComm.has(at(n)))
        : f.kind === 'mole'
          ? molesKnown.has(f.mole)
          : f.kind !== 'alpha' && known.has(f.place);
    /** "Take c to these areas", naming where c is held. */
    const commFact = (c: Item, areas: number[]): Fact => {
      const l = locOf(c);
      return { kind: 'comm', comm: c, areas, form: 'held', heldAt: heldPlace(l) };
    };

    let map = reachableMap(state, cleared, rules.gate, rules.gate10);
    explore();
    for (let guard = 0; ; guard++) {
      if (guard > 200) throw new Stuck();
      if (canFinish(state, cleared, rules.area12, map, rules.area12Comm)) break;
      let progress = false;
      for (const p of [...known]) {
        // an area with a comm room only once the player knows which comm to bring and holds it (the unbroken comm chain)
        if (!map.has(p) || (askFirst(p) && (!knownComm.has(at(p)) || (needsComm(p) && !owned.has(commOf(at(p)))))))
          continue;
        // newly readable slots here: each takes at most one next step, the most restricted slot first (a wiretap
        // can only place area rewards, so it shouldn't use up a COMMUNICATE slot's chance)
        const fresh = slots.filter((s) => s.place === p && !s.read && readable(s));
        for (const s of fresh) {
          s.read = true;
          readOrder.push(s);
          s.facts.forEach(learn);
          progress = true;
        }
        const taken = new Set<Slot>();
        for (const { fact } of needs(map)) {
          if (stale(fact)) continue;
          // Joe's area waits until the player has nothing else to go on (then the latest line read), so his trail
          // can come first
          if (fact.kind === 'find' && fact.item === 'joe') continue;
          const s = fresh
            .filter((x) => !taken.has(x) && x.facts.length < x.cap && fits(x, fact))
            .sort((a, b) => RESTRICTED[a.kind] - RESTRICTED[b.kind])[0];
          if (!s) continue;
          const f = finish(s, fact, map);
          s.facts.push(f);
          learn(f);
          taken.add(s);
        }
        for (const l of locations) {
          if (got.has(l.id) || !l.at.includes(p) || !l.requires(state) || !lockKnown(l)) continue;
          if (l.id === 'passage' && !known.has(UNDERGROUND)) continue; // (nobody stumbles on the stage's pickup)
          got.add(l.id);
          owned.add(placement.get(l.id)!);
          progress = true;
          if (placement.get(l.id) === 'joe') {
            trusted = true;
            joeTip = !got.has('destroyer');
          } // his rescue line names the real Destroyer
          if (l.areaClear) cleared.add(l.mapNumber ?? l.areaClear);
        }
        map = reachableMap(state, cleared, rules.gate, rules.gate10);
        explore();
      }
      if (progress) continue;
      // stuck: tell the player the next step in a slot they've already read, or else something that lets them read
      // another slot (a comm they hold for a reachable area, or a neutral zone with a talker)
      const tell = (fact: Fact) => {
        // (Joe's area goes in the latest line read, leaving room for his trail before it)
        const order = fact.kind === 'find' && fact.item === 'joe' ? [...readOrder].reverse() : readOrder;
        const s = order.find((x) => x.facts.length < x.cap && fits(x, fact));
        if (!s) return false;
        const f = finish(s, fact, map);
        s.facts.push(f);
        learn(f);
        return true;
      };
      if (needs(map).some(({ fact }) => tell(fact))) continue;
      const enable: Fact[] = [
        ...slots
          .filter(
            (s) =>
              !s.read &&
              s.kind !== 'talker' &&
              map.has(s.place) &&
              owned.has(commOf(s.layout)) &&
              !knownComm.has(s.layout) &&
              (!isDark(s.layout) || owned.has('flare')),
          )
          .map((s) => commFact(commOf(s.layout), [s.place])),
        ...slots
          .filter((s) => !s.read && s.kind === 'talker' && map.has(s.place) && !known.has(s.place))
          .flatMap((t) => {
            const l = locations.find(
              (x) => x.at.length === 1 && x.at[0] === t.place && placement.get(x.id) !== 'oneup',
            );
            if (!l) return [{ kind: 'visit', place: t.place }] as Fact[];
            const item = placement.get(l.id)!;
            return [
              item === 'passage' ? { kind: 'passage', place: t.place } : { kind: 'find', item, place: t.place },
            ] as Fact[];
          }),
      ];
      if (enable.some(tell)) continue;
      throw new Stuck();
    }
  }

  /** Can slot s carry this fact? Wiretaps (enemy chatter) only place area rewards; nothing points at its own area. */
  function fits(s: Slot, f: Fact): boolean {
    if (f.kind === 'alpha') return false;
    if (f.kind === 'comm') {
      if (s.kind === 'wire') return false;
      if (s.kind === 'talker') return s.door === f.comm || f.areas.every((n) => n !== s.place);
      return commOf(s.layout) === f.comm ? f.areas.some((n) => n !== s.place) : !f.areas.includes(s.place);
    }
    if (f.kind === 'noroom') return f.areas.every((n) => n !== s.place);
    if (f.kind === 'mole' && s.facts.some((x) => x.kind === 'mole')) return false; // one name per line
    if (f.place === s.place) return false;
    if (f.kind === 'find' && f.item === 'joe' && s.kind === 'talker') return false; // (playtest: too direct)
    if (s.kind === 'wire' && f.kind === 'find') return f.place >= 1 && f.place <= 11;
    if (s.kind === 'wire' && f.kind === 'visit') return false;
    return true;
  }
  /**
   * A line that only helps get something the slot can't be read without, directly or through any chain (playtest:
   * "THE BARRIERS IN AREA 14 ONLY BREAK UNDER MACHINE GUN FIRE", in a δ room, about the barrier in front of δ).
   * For each item: the slots still readable in a seed without it (a sweep with its locations empty).
   */
  const readableWithout = new Map<Item, Set<Slot>>();
  function readable(item: Item): Set<Slot> {
    if (!readableWithout.has(item)) {
      const without = new Map([...placement].filter(([, i]) => i !== item));
      const sw = sweep(locations, without, rules);
      const owned = new Set<Item>([...START_ITEMS, ...sw.spheres.flat().map((g) => g.item)]);
      const toRead = (x: Slot) =>
        x.kind === 'talker' ? talkerNeeds(x) : [commOf(x.layout), ...(isDark(x.layout) ? ['flare' as Item] : [])];
      readableWithout.set(
        item,
        new Set(slots.filter((x) => sw.map.has(x.place) && toRead(x).every((i) => owned.has(i)))),
      );
    }
    return readableWithout.get(item)!;
  }
  function circular(s: Slot, f: Fact): boolean {
    const gets =
      f.kind === 'find'
        ? [f.item]
        : f.kind === 'need'
          ? [f.item, ...locations.filter((l) => l.at.includes(f.place)).map((l) => placement.get(l.id)!)]
          : [];
    return gets.some((i) => i !== 'oneup' && !readable(i).has(s));
  }
  /** Settle a fact's wording-relevant details for the slot it lands in (comm form, an optional decoy area or region). */
  function finish(s: Slot, f: Fact, map?: Set<number>): Fact {
    if (f.kind === 'comm') {
      const heldHere = locOf(f.comm);
      if (s.kind === 'talker' && s.door === f.comm) return { ...f, form: 'door' };
      if (s.kind === 'comm' && commOf(s.layout) === f.comm)
        return { ...f, form: 'also', areas: f.areas.filter((n) => n !== s.place) };
      if (s.kind === 'comm' && heldHere?.areaClear === s.layout) return { ...f, form: 'area' };
      // held in this very neutral zone: not "AREA 13" from someone in Area 13 (playtest)
      if (s.kind === 'talker' && f.heldAt === s.place && heldHere?.id.startsWith('room')) {
        // (a building's item room)
        const own = s.inside && itemRooms.get(behind(s.inside.zone, s.inside.slot)!) === f.comm;
        return { ...f, form: own ? 'here' : 'next' };
      }
      return f;
    }
    const roll = f.kind === 'find' && f.place !== UNDERGROUND && f.place <= 11 && f.item !== 'joe' ? rng.int(100) : 100;
    if (f.kind === 'find' && roll < regionChance) return { ...f, region: regionOf(f.place)! };
    if (f.kind === 'find' && roll < regionChance + decoyChance) {
      // a decoy the player can check right away, holding nothing they need
      const decoys = locations
        .filter(
          (l) =>
            l.areaClear &&
            l.mapNumber !== f.place &&
            l.mapNumber !== s.place &&
            (!map || map.has(l.mapNumber!)) &&
            !pathIds.has(l.id) &&
            !KEY_ITEMS.has(placement.get(l.id)!),
        )
        .map((l) => l.mapNumber!);
      if (decoys.length) return { ...f, decoy: rng.pick(decoys.sort((a, b) => a - b)) };
    }
    return f;
  }

  // Every seed names Joe's area in a comm room or wiretap the guided player reads (the P.O.W.-camp line points there),
  // even when the path reached his area for another reason. Joe's trail (vanilla: the clues send you to Area 9, whose
  // boss says Joe was just moved; he's in 7): a line read on an earlier visit names a decoy area past the first
  // region, like Joe's own (a door talker passes it on as a rumor). No such line, no transfer line.
  let trailArea: number | undefined;
  if (enabled) {
    const joeAt = placeOf(locOf('joe')!);
    // (a decoy whose communicator the clues say, or that it has none: the player can follow the trail; in a
    // playtest Area 8's was never said, and the route went in by trial and error)
    const stated = (n: number) =>
      n === spot(1) ||
      slots.some((x) =>
        x.facts.some((f) => (f.kind === 'comm' || f.kind === 'noroom' || f.kind === 'alpha') && f.areas.includes(n)),
      );
    const decoys = [7, 8, 9, 10, 11].filter((n) => n !== joeAt && stated(n));
    const trail: Fact | undefined = decoys.length ? { kind: 'trail', place: rng.pick(decoys) } : undefined;
    const joe: Fact = { kind: 'find', item: 'joe', place: joeAt };
    const open = (x: Slot, f?: Fact) =>
      !!f && (x.kind !== 'talker' || f.kind === 'trail') && x.facts.length < x.cap && fits(x, f);
    /** Slots for the trail, read before `js` in another area (the comm rooms that held Joe's lines first). */
    const trailSlots = (js: Slot) =>
      rng
        .shuffle(readOrder.slice(0, readOrder.indexOf(js)).filter((x) => x.place !== js.place && open(x, trail)))
        .sort((p, q) => Number(!!q.joeLine) - Number(!!p.joeLine));
    let js = slots.find((s) => s.facts.some((f) => f.kind === 'find' && f.item === 'joe'));
    if (!js) {
      // one of the last lines read, preferring one that leaves room for the trail before it
      const late = readOrder
        .filter((x) => open(x, joe))
        .slice(-3)
        .reverse();
      js = late.find((x) => trailSlots(x).length) ?? late[0];
      js?.facts.push(joe);
    }
    const ts = js && trail && trailSlots(js)[0];
    if (ts && trail) {
      ts.facts.push(trail);
      trailArea = trail.place;
    }
  }

  for (const s of slots) s.keep = s.facts.length;
  // --- leftovers: comm chains and gear, at random ---
  if (enabled && level !== 'terse') {
    const verbose = level === 'verbose';
    const free = () => rng.shuffle(slots.filter((s) => !s.facts.length));
    const stated = (c: Item) =>
      new Set(
        slots.flatMap((s) =>
          s.facts.flatMap((f) =>
            (f.kind === 'comm' && f.comm === c) || (f.kind === 'alpha' && c === 'alpha') ? f.areas : [],
          ),
        ),
      );
    for (const c of rng.shuffle(['beta', 'gamma', 'delta'] as Item[])) {
      const all = usable(c);
      const rest = () => all.filter((n) => !stated(c).has(n));
      if (!rest().length || (!verbose && rng.int(10) >= 8)) continue;
      const l = locOf(c);
      const named = rng.shuffle(rest()).slice(0, 1 + rng.int(2));
      const entry = commFactFor(c, named);
      const where =
        free().find((s) => s.kind === 'talker' && s.door === c) ??
        free().find((s) => s.kind === 'comm' && l?.areaClear === s.layout && commOf(s.layout) !== c) ??
        free().find((s) => fits(s, entry) && commOf(s.layout) !== c && s.kind !== 'talker');
      if (!where) continue;
      where.facts.push(finish(where, entry));
      const left = rest();
      if (left.length && (verbose || rng.int(10) < 7)) {
        const cont = free().find((s) => s.kind === 'comm' && commOf(s.layout) === c && named.includes(s.place));
        if (cont) cont.facts.push({ kind: 'comm', comm: c, areas: left, form: 'also' });
      }
    }
    // (a comm line naming where the comm is held counts: playtest, "AREA 14 HOLDS THE δ…" then "FIND THE δ… IN AREA 14")
    const hinted = new Set(
      slots.flatMap((s) =>
        s.facts.flatMap((f) =>
          f.kind === 'find'
            ? [f.item]
            : f.kind === 'comm' && (f.heldAt !== undefined || f.form === 'area')
              ? [f.comm]
              : [],
        ),
      ),
    );
    const gear = rng.shuffle(
      locations.filter(
        (l) => l.shuffled && !['oneup', 'joe'].includes(placement.get(l.id)!) && !hinted.has(placement.get(l.id)!),
      ),
    );
    const said = (k: Fact['kind']) => slots.some((s) => s.facts.some((f) => f.kind === k));
    const needs = rng.shuffle([
      ...neededAt.map(([item, layout]) => ({ kind: 'need', item, place: spot(layout) }) as Fact),
      ...(said('mole') ? [] : [{ kind: 'mole', place: spot(18), mole: rng.int(2) } as Fact]),
    ]);
    for (const s of free()) {
      if (!(s.forced && commsMoved) && !s.lie && !s.joeLine && !verbose && rng.int(10) >= 6) continue;
      const pool: Fact[] = [
        ...gear.map((l) => ({ kind: 'find', item: placement.get(l.id)!, place: placeOf(l) }) as Fact),
        ...needs,
      ];
      const ok = (x: Fact) => fits(s, x) && !circular(s, x);
      const f = rng.int(4) === 0 ? pool.reverse().find(ok) : pool.find(ok);
      if (!f) continue;
      s.facts.push(finish(s, f));
      if (f.kind === 'find')
        gear.splice(
          gear.findIndex((l) => placement.get(l.id) === f.item),
          1,
        );
      else needs.splice(needs.indexOf(f), 1);
    }
  }
  // the man inside room $3E always has something useful: a warning, in his voice
  const hasty = slots.find((s) => s.inside);
  if (enabled && hasty && !hasty.facts.length) {
    const noroom = [6, 7].map(spot).filter((n) => n !== hasty.place);
    const warnings = rng.shuffle([
      ...neededAt.map(([item, layout]) => ({ kind: 'need', item, place: spot(layout) }) as Fact),
      { kind: 'mole', place: spot(18), mole: rng.int(2) } as Fact,
      ...(noroom.length ? [{ kind: 'noroom', areas: noroom } as Fact] : []),
    ]);
    const f = warnings.find((x) => fits(hasty, x) && !circular(hasty, x));
    if (f) hasty.facts.push(f);
  }
  // (with hints on, a comm line the shuffle made false and no clue took says flavor; Vanilla says it corrected: story.ts)
  for (const s of slots)
    if (enabled && ((s.forced && commsMoved) || s.lie || s.joeLine) && !s.facts.length) s.flavor = rng.pick(FLAVOR);

  /**
   * Vanilla: the route reads the vanilla lines (story.ts keeps them true) and learns what they say
   * that a player can act on: which areas a communicator works in (#23, #63), the dark areas (#18, NZ13 B's flare
   * line), the Rocket Launcher's area (#42; its wide cannon and Area 3 gate nothing), Joe's area (#27, #33, #44, #65) and,
   * with Fix Typos, the interrogation room's zone (#70). Every line is quoted as the ROM says it (generate.ts fills
   * the ⟪y⟫ placeholders in). The lines' own text isn't written from these facts.
   */
  function vanillaClues() {
    const joe = placeOf(locOf('joe')!),
      darkAreas = dark.map(spot).sort((a, b) => a - b);
    const commAreas = (c: Item, but?: number) => HINT_COMM_AREAS.filter((l) => l !== but && commOf(l) === c).map(spot);
    const comm = (c: Item, areas: number[]): Fact[] =>
      areas.length ? [{ kind: 'comm', comm: c, areas, form: 'held' }] : [];
    const flare = darkAreas.map((place): Fact => ({ kind: 'need', item: 'flare', place }));
    const interrogation = locations.find((l) => l.id === 'interrogation')!.at[0];
    const facts: Record<string, Fact[]> = {
      'O1B wiretap': flare,
      O2A: [{ kind: 'need', item: 'rocket', place: spot(NEEDED_AT.rocket!) }],
      'O2A wiretap': [{ kind: 'find', item: 'joe', place: joe }],
      O4A: comm(commOf(4), commAreas(commOf(4))),
      O5B: [{ kind: 'find', item: 'joe', place: joe }],
      O8A: comm('gamma', commAreas('gamma', 8)),
      O8B: [{ kind: 'find', item: 'joe', place: joe }],
      O9A: input.typosFixed ? [{ kind: 'passage', place: interrogation }] : [],
    };
    // (NZ15 B's talker and the informer: the P.O.W.-camp line, Joe's area)
    const informer = doors.get(INFORMER_ROOM);
    slots.push(
      {
        id: `NZ${spot(15)} door B talker`,
        kind: 'talker',
        layout: 15,
        ys: [JOE_POINTER_Y],
        place: spot(15),
        facts: [],
        cap: 1,
        read: false,
      },
      ...(informer
        ? [
            {
              id: `NZ${spot(zoneNode(informer.zone))} door ${informer.slot ? 'B' : 'A'} inside talker`,
              kind: 'talker' as const,
              layout: zoneNode(informer.zone),
              ys: [JOE_POINTER_Y],
              place: spot(zoneNode(informer.zone)),
              facts: [],
              cap: 1,
              read: false,
              inside: informer,
            },
          ]
        : []),
    );
    for (const x of slots) {
      x.facts = x.ys.includes(JOE_POINTER_Y)
        ? [{ kind: 'find', item: 'joe', place: joe }]
        : x.kind === 'talker' && x.layout === 13 && x.door === 'flare' && !x.own
          ? flare
          : (facts[x.id] ?? []);
      x.facts.forEach((f) => mustBeTrue(x, f));
      said.set(x, x.ys.map((y) => `⟪${y}⟫`).join(' / '));
    }
  }

  function commFactFor(c: Item, areas: number[]): Fact {
    const l = locOf(c);
    return { kind: 'comm', comm: c, areas, form: 'held', heldAt: heldPlace(l) };
  }

  // every hint must be true
  for (const s of slots) for (const f of s.facts) mustBeTrue(s, f);
  function mustBeTrue(s: Slot, f: Fact) {
    const holds = (item: Item, place: number) =>
      place === UNDERGROUND
        ? placement.get('passage') === item
        : locations.some((l) => l.at.includes(place) && placement.get(l.id) === item);
    const ok =
      f.kind === 'alpha'
        ? f.areas.every((n) => commOf(at(n)) === 'alpha')
        : f.kind === 'find'
          ? holds(f.item, f.place) && (!f.region || REGION_AREAS[f.region].includes(f.place))
          : f.kind === 'passage'
            ? holds('passage', f.place)
            : f.kind === 'need'
              ? neededAt.some(([i, l]) => i === f.item && spot(l) === f.place)
              : f.kind === 'mole'
                ? f.place === spot(18) && (f.mole === 0 || f.mole === 1)
                : f.kind === 'trail'
                  ? f.place >= 7 && f.place <= 11 && !holds('joe', f.place)
                  : f.kind === 'visit'
                    ? slots.some((t) => t.kind === 'talker' && t.place === f.place)
                    : f.kind === 'noroom'
                      ? f.areas.length > 0 &&
                        f.areas.every((n) => n >= 1 && n <= 11 && !HINT_COMM_AREAS.includes(at(n)))
                      : f.areas.length > 0 &&
                        f.areas.every((n) => commOf(at(n)) === f.comm && HINT_COMM_AREAS.includes(at(n))) &&
                        (f.heldAt === undefined || holds(f.comm, f.heldAt));
    if (!ok) throw new Error(`hints: untrue hint in ${s.id}: ${JSON.stringify(f)}`);
  }

  // --- wording ---
  const name = (i: Item) => NAMES[i]!;
  const is = (i: Item) => (PLURAL.has(i) ? 'ARE' : 'IS');
  const either = (f: { place: number; decoy?: number }) => [f.place, f.decoy!].sort((a, b) => a - b).join(' OR ');
  function sentence(s: Slot, f: Fact, short = false): string {
    switch (f.kind) {
      case 'alpha':
        return f.areas.length
          ? `YOUR α COMMUNICATOR IS ALSO USED IN ${areaList(f.areas)}.`
          : "YOUR α COMMUNICATOR WON'T WORK ANYWHERE ELSE.";
      case 'find':
        if (f.item === 'joe') {
          return rng.pick(
            trailArea
              ? [`THEY'VE MOVED JOE TO AREA ${f.place}.`, `JOE IS NOW HELD IN AREA ${f.place}.`]
              : [`JOE IS HELD IN AREA ${f.place}.`, `WE'VE HEARD JOE IS IN AREA ${f.place}.`],
          );
        }
        if (f.place === UNDERGROUND) {
          return s.kind === 'talker'
            ? `OUR SCOUTS SAW THE ${name(f.item)} ON THE UNDERGROUND PATH.`
            : rng.pick([
                `THE ${name(f.item)} ${is(f.item)} HIDDEN ON THE UNDERGROUND PATH.`,
                `THE ENEMY KEEPS THE ${name(f.item)} ON THE UNDERGROUND PATH.`,
              ]);
        }
        if (f.region) {
          const where = IN_REGION[f.region];
          return s.kind === 'talker'
            ? `OUR SCOUTS SAW THE ${name(f.item)} SOMEWHERE ${where}.`
            : rng.pick([
                `THE ${name(f.item)} ${is(f.item)} SOMEWHERE ${where}.`,
                `WE THINK THE ${name(f.item)} ${is(f.item)} ${where}.`,
              ]);
        }
        if (s.kind === 'talker')
          return f.decoy
            ? `OUR SCOUTS SAW THE ${name(f.item)} IN AREA ${either(f)}.`
            : `OUR SCOUTS SAW THE ${name(f.item)} IN AREA ${f.place}.`;
        return f.decoy
          ? rng.pick([
              `THE ${name(f.item)} ${is(f.item)} IN AREA ${either(f)}.`,
              `WE THINK THE ${name(f.item)} ${is(f.item)} IN AREA ${either(f)}.`,
            ])
          : rng.pick([
              `FIND THE ${name(f.item)} IN AREA ${f.place}.`,
              `THE ${name(f.item)} ${is(f.item)} IN AREA ${f.place}.`,
              `WE'VE LOCATED THE ${name(f.item)} IN AREA ${f.place}.`,
            ]);
      case 'need':
        if (f.item === 'flare')
          return rng.pick([`AREA ${f.place} IS DARK.\nTAKE A FLARE.`, `YOU'LL NEED A FLARE IN AREA ${f.place}.`]);
        if (f.item === 'permit') return `YOU NEED A PERMIT FOR THE BUILDINGS IN AREA ${f.place}.`;
        if (barrier(f)) return `THE BARRIERS IN AREA ${f.place} ONLY BREAK UNDER ${name(f.item)} FIRE.`;
        return rng.pick([
          `YOU NEED THE ${name(f.item)} IN AREA ${f.place}.`,
          `ONLY THE ${name(f.item)} WILL GET YOU THROUGH AREA ${f.place}.`,
        ]);
      case 'trail':
        if (s.kind === 'talker') {
          return rng.pick([
            `THERE'S A RUMOR THEY TOOK JOE TO AREA ${f.place}.`,
            `I HEARD JOE IS LOCKED UP IN AREA ${f.place}.\nBUT WHO KNOWS?`,
          ]);
        }
        return rng.pick([
          `I JUST SAW THEM TAKE JOE AWAY.\nTHEY HEADED TOWARDS AREA ${f.place}.`,
          `OUR SPIES SAW A PRISON TRUCK HEADED FOR AREA ${f.place}.\nJOE MAY BE ON IT.`,
          `WE THINK JOE IS HELD IN AREA ${f.place}.`,
          // (O9 is the game's disposal area: only it is called that)
          ...(at(f.place) === 9
            ? [`AREA ${f.place} LOOKS LIKE THE DISPOSAL AREA.\nJOE MUST HAVE BEEN TAKEN THERE.`]
            : []),
        ]);
      case 'noroom':
        return rng.pick([
          `MAINTAIN RADIO SILENCE IN ${areaList(f.areas)} FOR SAFETY.`,
          `WE HAVE NO AGENTS IN ${areaList(f.areas)}.\nMAINTAIN RADIO SILENCE THERE.`,
        ]);
      case 'mole': {
        const m = moles[f.mole];
        return s.kind === 'talker'
          ? `WATCH OUT FOR ${m} IN AREA ${f.place}.\nHE WORKS FOR THE ENEMY.`
          : rng.pick([`${m} IN AREA ${f.place} IS A MOLE.`, `DON'T TRUST ${m} IN AREA ${f.place}.\nHE'S A SPY.`]);
      }
      case 'visit':
        return rng.pick([`OUR FRIENDS IN AREA ${f.place} HAVE NEWS FOR YOU.`, `VISIT OUR FRIENDS IN AREA ${f.place}.`]);
      case 'passage':
        return s.kind === 'talker'
          ? `OUR PRISONER IN AREA ${f.place} KNOWS THE UNDERGROUND PATH.`
          : `WE'VE CAPTURED AN ENEMY IN AREA ${f.place}.\nHE KNOWS ABOUT THE UNDERGROUND PATH.`;
      case 'comm': {
        const c = SYMBOL[f.comm]!,
          list = areaList(f.areas);
        if (f.form === 'door') return rng.pick([`USE IT IN ${list}.`, `TAKE IT TO ${list}.`]);
        if (f.form === 'also') return `${c} IS ALSO USED IN ${list}.`;
        if (f.form === 'here') return `THE ${c} COMMUNICATOR HERE WILL REACH OUR AGENTS IN ${list}.`;
        if (f.form === 'next')
          return rng.pick([
            `THE OTHER BUILDING HERE HOLDS THE ${c} COMMUNICATOR.\nBRING IT TO ${list}.`,
            `THE ${c} COMMUNICATOR NEXT DOOR WILL REACH OUR AGENTS IN ${list}.`,
          ]);
        if (f.form === 'area')
          return rng.pick([
            `THIS AREA HOLDS THE ${c} COMMUNICATOR.\nTAKE IT TO ${list}.`,
            `THE ENEMY HERE GUARDS THE ${c} COMMUNICATOR.\nWE NEED IT IN ${list}.`,
          ]);
        if (f.heldAt === undefined) return `TAKE THE ${c} COMMUNICATOR TO ${list}.`;
        const held = `AREA ${f.heldAt} HOLDS THE ${c} COMMUNICATOR.\nBRING IT TO ${list}.`;
        return short
          ? held
          : rng.pick([held, `THE ${c} COMMUNICATOR FROM AREA ${f.heldAt} WILL REACH OUR AGENTS IN ${list}.`]);
      }
    }
  }
  function wiretap(f: Fact): [string, string] {
    switch (f.kind) {
      case 'find':
        if (f.item === 'joe') return ['YOU TRANSPORTED JOE?', `YEAH, OVER TO AREA ${f.place}.`];
        return [
          rng.pick([`WHERE ${is(f.item)} OUR ${name(f.item)} NOW?`, `WHO IS GUARDING THE ${name(f.item)}?`]),
          f.region
            ? `SOMEWHERE ${IN_REGION[f.region]}.\nTHAT'S ALL I KNOW.`
            : f.decoy
              ? `AREA ${either(f)}.\nI FORGET WHICH.`
              : rng.pick([`AREA ${f.place}.\nKEEP IT QUIET.`, `THE UNIT IN AREA ${f.place}.`]),
        ];
      case 'need':
        if (f.item === 'flare') return [`IT'S DARK IN AREA ${f.place}.`, 'TAKE A FLARE, IDIOT.'];
        if (f.item === 'permit')
          return [`WHO GETS INTO THE BUILDINGS IN AREA ${f.place}?`, 'ONLY THOSE WITH A PERMIT.'];
        if (barrier(f)) return [`CAN ANYTHING BREAK THE BARRIERS IN AREA ${f.place}?`, `ONLY A ${name(f.item)}.`];
        return [`HOW DO WE GET THROUGH AREA ${f.place}?`, `ONLY WITH THE ${name(f.item)}.`];
      case 'passage':
        return [`DID THE PRISONER IN AREA ${f.place} TALK?`, 'NOT YET.\nHE KNOWS THE UNDERGROUND PATH.'];
      case 'trail':
        return rng.pick([
          ['WHERE DID YOU TAKE JOE?', `AREA ${f.place}.\nKEEP IT IN MIND.`],
          ['IS JOE LOCKED UP?', `YES, IN AREA ${f.place}.\nNO ONE WILL FIND HIM THERE.`],
        ] as [string, string][]);
      case 'noroom':
        return [`THE FEDERATION RADIOS IN ${areaList(f.areas)} WENT QUIET.`, 'OF COURSE.\nWE WIPED OUT THEIR AGENTS.'];
      case 'mole':
        return [`IS ${moles[f.mole]} STILL IN PLACE IN AREA ${f.place}?`, 'YES.\nTHE FEDERATION SUSPECTS NOTHING.'];
      default:
        throw new Error(`hints: a wiretap can't say ${f.kind}`);
    }
  }

  const messages = new Map<number, string | Message>();
  const talkerAddenda = new Map<number, string>();
  const spoiler: SpoilerHint[] = [];
  const said = new Map<Slot, string>();
  // (the spoiler's fields for a slot: where it is, the comm room or the door)
  const whereOf = (s: Slot) => {
    const door = s.id.match(/door ([AB])( inside)?/),
      room = s.id.match(/^O\d+([AB])/);
    return {
      area: s.place,
      layout: s.layout,
      ...(door
        ? { door: door[1] as 'A' | 'B', ...(door[2] && { inside: true }) }
        : room && { room: room[1] as 'A' | 'B' }),
    };
  };
  const hint = (s: Slot, lines: string[]) =>
    spoiler.push({
      kind: s.kind === 'wire' ? 'wiretap' : s.kind,
      ...whereOf(s),
      lines: lines.map((text) => ({ text })),
    });
  let joeRescueLine = false,
    rescueTells: HintOutput['rescueTells'];
  for (const s of slots) {
    if (s.kind === 'wire') {
      if (!s.facts.length && !s.flavor) continue;
      const [line, reply] = s.facts.length ? wiretap(s.facts[0]) : rng.pick(WIRE_FLAVOR);
      // (enemy chatter: where the vanilla exchange was between allies, the enemy soldier and commander say it)
      const ally = ALLY_WIRES.has(s.ys[0]);
      if (s.ys.length === 1)
        messages.set(messageForY(s.ys[0]), {
          header: INTERCEPT,
          text: wrap(`${line}\f${reply}`, undefined, RADIO_PAGE),
        });
      else {
        messages.set(messageForY(s.ys[0]), ally ? { header: ENEMY_SOLDIER, text: wrap(line) } : wrap(line));
        messages.set(messageForY(s.ys[1]), ally ? { header: ENEMY_COMMANDER, text: wrap(reply) } : wrap(reply));
      }
      hint(s, [line, reply]);
      said.set(s, `${line} / ${reply}`.replace(/\n/g, ' '));
    } else {
      // (a message holds 255 characters: verbose leftovers past that are dropped, never the path's own facts)
      // same comm, same source: one line naming all the areas
      s.facts = s.facts.reduce<Fact[]>((acc, f) => {
        const same =
          f.kind === 'comm' &&
          acc.find((g) => g.kind === 'comm' && g.comm === f.comm && g.form === f.form && g.heldAt === f.heldAt);
        if (same && same.kind === 'comm' && f.kind === 'comm') {
          same.areas = [...new Set([...same.areas, ...f.areas])].sort((a, b) => a - b);
          return acc;
        }
        acc.push(f);
        return acc;
      }, []);
      s.keep = Math.min(s.keep ?? 0, s.facts.length);
      const fits = (ss: string[]) => wrap((s.inside ? "DON'T BE HASTY.\n" : '') + ss.join('\n')).length <= 255;
      let sents = s.facts.map((f) => sentence(s, f));
      if (!fits(sents)) sents = s.facts.map((f) => sentence(s, f, true)); // the shorter wordings
      while (
        sents.length > (s.keep ?? 0) &&
        wrap((s.inside ? "DON'T BE HASTY.\n" : '') + sents.join('\n')).length > 255
      ) {
        sents.pop();
        s.facts.pop();
      }
      const said1 = sents.length ? sents.join('\n') : s.flavor;
      if (!said1) continue;
      // (the man inside room $3E keeps his catchphrase; O5B's agent wears the enemy's uniform, so he says why)
      const spy = `I'M A SPY FOR THE FEDERATION.\n${said1}`;
      const text = s.inside ? `DON'T BE HASTY.\n${said1}` : s.id === SPY_SLOT && wrap(spy).length <= 255 ? spy : said1;
      if (s.inside || s.own) messages.set(messageForY(s.ys[0]), wrap(text));
      else if (s.kind === 'talker') talkerAddenda.set(s.ys[0], text);
      else messages.set(messageForY(s.ys[0]), wrap(text));
      hint(s, [text]);
      if (s.facts.length) said.set(s, text.replace(/\n/g, ' '));
    }
  }
  if (enabled) {
    const joeSlot = slots.find((s) => s.facts.some((f) => f.kind === 'find' && f.item === 'joe'));
    const line = !joeSlot
      ? "WE'VE LOCATED\nJOE'S P.O.W. CAMP.\nWE'LL REPORT AGAIN SOON."
      : joeSlot.kind === 'wire'
        ? `WE'VE LOCATED\nJOE!\nTAP THE ENEMY'S LINE IN AREA ${joeSlot.place} FOR DETAILS.`
        : `WE'VE LOCATED\nJOE!\nOUR AGENTS IN AREA ${joeSlot.place} HAVE THE DETAILS.`;
    messages.set(messageForY(JOE_POINTER_Y), wrap(line));
    spoiler.push({ kind: 'joePointer', area: spot(15), layout: 15, door: 'B', lines: [{ text: line }] }); // (and the informer: the route)
    // (the route reads it where it's said: O15's door-B talker, past the barrier, and the informer in room $40,
    // sending the player to the slot with the details)
    if (joeSlot) {
      const informer = doors.get(INFORMER_ROOM);
      const pointers: Slot[] = [
        // (not when the informer is in O15 as well: the same line twice)
        ...(informer && zoneNode(informer.zone) === 15
          ? []
          : [
              {
                id: `NZ${spot(15)} door B talker`,
                kind: 'talker' as const,
                layout: 15,
                ys: [JOE_POINTER_Y],
                place: spot(15),
                facts: [],
                cap: 1,
                read: false,
              },
            ]),
        ...(informer
          ? [
              {
                id: `NZ${spot(zoneNode(informer.zone))} door ${informer.slot ? 'B' : 'A'} inside talker`,
                kind: 'talker' as const,
                layout: zoneNode(informer.zone),
                ys: [JOE_POINTER_Y],
                place: spot(zoneNode(informer.zone)),
                facts: [],
                cap: 1,
                read: false,
                inside: informer,
              },
            ]
          : []),
      ];
      for (const s of pointers) {
        s.facts.push({ kind: 'visit', place: joeSlot.place });
        said.set(s, line.replace(/\n/g, ' '));
        slots.push(s);
      }
    }
    const zone = spot(18),
      vanillaMen = input.trust.startsWith('DESTROYER-');
    const tip = !joeTip
      ? 'THANKS FOR GETTING ME OUT.'
      : vanillaMen
        ? `I GAVE A SPECIAL MACHINE-GUN TO ${input.trust} IN AREA ${zone}.`
        : `ONLY ${input.trust} IN AREA ${zone} IS ONE OF US.\nTHE OTHER TWO ARE IMPOSTORS.`;
    const rescue = `${tip}\nOUR AGENTS IN AREA 12 USE THE ${SYMBOL[commOf(12)]} COMMUNICATOR.`;
    messages.set(messageForY(JOE_RESCUE_Y), wrap(rescue));
    spoiler.push({ kind: 'joeRescue', lines: [{ speaker: 'joe', text: rescue }] });
    joeRescueLine = true;
    rescueTells = { comm: commOf(12), trust: joeTip };
  }
  // Nonsense: every radio message a hint could sit in, and every talker, says a line of its box's pool (generate.ts
  // draws them, nonsense.ts drawNonsense: with the ROM's headers, again on a full text bank)
  const nonsenseSlots: NonsenseSlot[] = [];
  if (level === 'nonsense') {
    talkerAddenda.clear();
    spoiler.length = 0;
    // (a wiretap says one line: its reply isn't shown)
    for (const s of slots)
      nonsenseSlots.push({
        label: s.kind === 'wire' ? 'wiretap' : s.kind,
        box: s.kind === 'talker' ? 'talker' : 'radio',
        ys: s.ys.slice(0, 1),
        where: whereOf(s),
      });
    nonsenseSlots.push(
      { label: 'talker', box: 'talker', ys: [JOE_POINTER_Y], where: { area: spot(15), layout: 15, door: 'B' } },
      { label: 'comm', box: 'radio', ys: [0x14], where: { area: spot(1), layout: 1, room: 'A' } },
      { label: 'Area 12 comm rooms', box: 'radio', ys: NONSENSE_RADIO_Y.slice(1), where: { area: 12, layout: 12 } },
      { label: 'Joe (rescue)', box: 'radio', ys: NONSENSE_RESCUE_Y },
      { label: 'NZ guards and men', box: 'talker', ys: NONSENSE_GUARD_Y },
      { label: 'Killt (NZ)', box: 'talker', ys: [NONSENSE_KILLT_Y] },
      { label: 'Other lines', box: 'talker', ys: NONSENSE_TALK_Y },
      { label: 'NZ19 bombardier', box: 'bomber', ys: [BOMBER_Y] },
    );
  }
  // (tests: no placed line may be circular)
  const circularLines = slots.flatMap((s) =>
    s.facts.filter((f) => circular(s, f)).map((f) => `${s.id}: ${JSON.stringify(f)}`),
  );
  if (level === 'vanilla') vanillaClues();
  // (with no hints, the player still plays it by trial and error: a route when one gets there)
  const ctx: RouteContext = {
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
  };
  const route = (() => {
    if (enabled) return intendedRoute(ctx);
    try {
      return intendedRoute(ctx);
    } catch {
      return [];
    }
  })();
  const facts = new Map<number, Fact[]>();
  // (Joe's pointer is one message said by two people: its facts once)
  if (level !== 'nonsense')
    for (const sl of slots) if (sl.facts.length && !facts.has(sl.ys[0])) facts.set(sl.ys[0], sl.facts);
  return {
    messages,
    talkerAddenda,
    spoiler,
    route,
    trailArea,
    circularLines,
    nonsenseSlots,
    facts,
    ...(rescueTells && { rescueTells }),
  };
}
