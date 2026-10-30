// The oracle route (spoiler `oracle`): a short way through the seed for a player who knows every
// placement, with no hints or communicator knowledge needed. The fewest pickups and clears that still finish the game
// (true requirements only: real locks, not the route's comm-in-hand rule), visited nearest first.

import type { DESTROYER_POSITIONS } from './destroyers.ts';
import { area12Steps, UNLOCK_ROOMS } from './hintdata.ts';
import type { RouteNeed, RoutePlace, RouteStep, RouteVisit } from './spoiler.ts';
import {
  area12Needs1011,
  area12NeedsJoe,
  canFinish,
  ITEMS,
  type Item,
  type Location,
  reachableMap,
  roadDistances,
  type Rules,
  START_ITEMS,
} from './world.ts';
import type { Placement } from './logic.ts';

export interface OracleInput {
  /** The locations with true requirements only. */
  locations: Location[];
  placement: Placement;
  rules: Rules;
  /** The layout at a map number. */
  at: (n: number) => number;
  /** The real Destroyer's name (none with Nonsense hints: he goes by where he stands), where he stands, and the door. */
  trust?: string;
  trustAt: (typeof DESTROYER_POSITIONS)[number];
  trustDoor: 'A' | 'B';
  area12Locks: 'none' | 'comms' | 'boss' | 'both';
  /** The dark layouts, and whether True Dark makes them need the Flare. */
  dark: readonly number[];
  trueDark: boolean;
  /** The comm-locked layouts. */
  locked: readonly number[];
}

const UNDERGROUND = 0; // (the passage stage's place, as in hints.ts)
const EPS = 1e-9,
  STOP = 1e-3; // (STOP: a stop's own cost, so of two routes as long, the one with fewer stops)

export function oracleRoute({
  locations,
  placement,
  rules,
  at,
  trust,
  trustAt,
  trustDoor,
  area12Locks,
  dark,
  trueDark,
  locked,
}: OracleInput): RouteVisit[] {
  const owned = new Set<Item>(START_ITEMS),
    cleared = new Set<number>();
  const state = { has: (i: Item) => owned.has(i) };
  const met = (g?: { areas: number[]; items: Item[] }) =>
    !g || (g.areas.every((n) => cleared.has(n)) && g.items.every((i) => owned.has(i)));
  const roads = (from: number) =>
    roadDistances(from, (k) =>
      k === 'passage' ? owned.has('passage') : k === 'gate' ? met(rules.gate) : k === 'flak' ? met(rules.gate10) : true,
    );

  // The shortest route: a shortest-path search over (where the player is, what they hold that matters,
  // the clears the gates or Area 12 check); each move flies to a location's nearest node by the roads open then
  // and takes it; the goal, any state that can finish, plus the flight to Area 12.
  const USEFUL = new Set<Item>([
    'rocket',
    'threeway',
    'machine',
    'permit',
    'flare',
    'alpha',
    'beta',
    'gamma',
    'delta',
    'joe',
    'iff',
    'flak',
    'passage',
  ]);
  const tracked = [
    ...new Set([
      ...(rules.gate?.areas ?? []),
      ...(rules.gate10?.areas ?? []),
      ...(area12Needs1011(rules.area12) ? [10, 11] : []),
    ]),
  ];
  const worth = locations.filter(
    (l) => USEFUL.has(placement.get(l.id)!) || (l.areaClear && tracked.includes(l.mapNumber ?? l.areaClear)),
  );
  type Node = { at: number; items: Item[]; clr: number[]; cost: number; path: Location[]; done?: boolean }; // (done: at Area 12)
  const key = (n: Node) => `${n.done ? 'end' : n.at}|${[...n.items].sort().join()}|${[...n.clr].sort().join()}`;
  const best = new Map<string, number>();
  const heap: Node[] = [{ at: 1, items: [...START_ITEMS].filter((i) => USEFUL.has(i)), clr: [], cost: 0, path: [] }];
  const push = (n: Node) => {
    const k = key(n);
    if ((best.get(k) ?? Infinity) <= n.cost + EPS) return;
    best.set(k, n.cost);
    heap.push(n);
    let i = heap.length - 1;
    while (i) {
      const up = (i - 1) >> 1;
      if (heap[up].cost <= heap[i].cost) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0],
      end = heap.pop()!;
    if (heap.length) {
      heap[0] = end;
      for (let i = 0; ; ) {
        const l = 2 * i + 1,
          r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].cost < heap[m].cost) m = l;
        if (r < heap.length && heap[r].cost < heap[m].cost) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  let found: Node | undefined;
  while (heap.length) {
    const n = pop();
    if ((best.get(key(n)) ?? Infinity) < n.cost - EPS) continue;
    owned.clear();
    n.items.forEach((i) => owned.add(i));
    cleared.clear();
    n.clr.forEach((c) => cleared.add(c));
    const map = reachableMap(state, cleared, rules.gate, rules.gate10),
      d = roads(n.at);
    if (n.done) {
      found = n;
      break;
    }
    if (canFinish(state, cleared, rules.area12, map, rules.area12Comm)) {
      push({ ...n, cost: n.cost + (d.get(12) ?? 99), done: true });
      continue;
    }
    for (const l of worth) {
      if (n.path.includes(l) || !l.at.some((m) => map.has(m)) || !l.requires(state)) continue;
      const item = placement.get(l.id)!,
        c = l.areaClear ? (l.mapNumber ?? l.areaClear) : undefined;
      const gain =
        (USEFUL.has(item) && !owned.has(item)) || (c !== undefined && tracked.includes(c) && !cleared.has(c));
      if (!gain) continue;
      const to = [...l.at].filter((m) => map.has(m)).sort((a, b) => (d.get(a) ?? 99) - (d.get(b) ?? 99) || a - b)[0];
      push({
        at: to,
        items: USEFUL.has(item) && !owned.has(item) ? [...n.items, item] : n.items,
        clr: c !== undefined && tracked.includes(c) && !cleared.has(c) ? [...n.clr, c] : n.clr,
        cost: n.cost + (d.get(to) ?? 99) + STOP,
        path: [...n.path, l],
      });
    }
  }
  if (!found) return [];
  // replayed for the entries: what was held at each stop
  owned.clear();
  START_ITEMS.forEach((i) => owned.add(i));
  cleared.clear();
  const done: { place: number; l: Location; had: Set<Item>; clr: Set<number> }[] = [];
  let here = 1;
  for (const l of found.path) {
    const d = roads(here),
      map = reachableMap(state, cleared, rules.gate, rules.gate10);
    const to = [...l.at].filter((m) => map.has(m)).sort((a, b) => (d.get(a) ?? 99) - (d.get(b) ?? 99) || a - b)[0];
    done.push({ place: l.id === 'passage' ? UNDERGROUND : to, l, had: new Set(owned), clr: new Set(cleared) });
    owned.add(placement.get(l.id)!);
    if (l.areaClear) cleared.add(l.mapNumber ?? l.areaClear);
    here = to;
  }

  /** The fewest of what was held that `ok` needs (one removal at a time). */
  const fewest = (had: Set<Item>, ok: (s: { has: (i: Item) => boolean }) => boolean) => {
    const keep = new Set(had);
    for (const i of [...had]) {
      keep.delete(i);
      if (!ok({ has: (x) => keep.has(x) })) keep.add(i);
    }
    return [...keep].filter((i) => !START_ITEMS.includes(i) || ITEMS[i].name.endsWith('Communicator'));
  };
  const door = (l: Location) => (l.name.match(/door ([AB])/)?.[1] ?? 'A') as 'A' | 'B';
  // (what the full route waits for and the oracle doesn't, said where it's skipped)
  const text = (l: Location, item: Item): RouteStep[] => {
    // (a comm-locked area: COMMUNICATE in the room(s) that open its door first, as the full route does)
    if (l.areaClear)
      return [
        ...(locked.includes(l.areaClear) ? UNLOCK_ROOMS[l.areaClear] : []).map(
          (id): RouteStep => ({
            act: 'comm',
            room: id.slice(-1) as 'A' | 'B',
            opens: l.areaClear === 1 ? 'door' : 'bossDoor',
          }),
        ),
        { act: 'clear', item },
      ];
    if (l.id === 'passage') return [{ act: 'passage', item }];
    if (l.id === 'destroyer')
      return [{ act: 'destroyer', door: trustDoor, ...(trust && { name: trust }), position: trustAt, item }];
    return [{ act: 'room', door: door(l), ...(l.id === 'interrogation' && { prisoner: true }), item }];
  };
  const label = (p: number): RoutePlace =>
    p === UNDERGROUND ? { kind: 'passage' } : { kind: p >= 13 ? 'zone' : 'area', area: p, layout: at(p) };
  const entries: (RouteVisit & { at: number })[] = [];
  const need = (item: Item): RouteNeed => ({ need: { item }, basis: { kind: 'none' } });
  /** What the map's gates take to reach `place` ("IFF Code"). */
  const gates = (place: number, had: Set<Item>, clr: Set<number>) =>
    place === UNDERGROUND
      ? []
      : fewest(had, (s) => reachableMap(s, clr, rules.gate, rules.gate10).has(place)).filter(
          (i) => !ITEMS[i].name.endsWith('Communicator'),
        );
  for (const { place, l, had, clr } of done) {
    const last = entries.at(-1),
      item = placement.get(l.id)!;
    const reqs: RouteNeed[] = [
      ...fewest(had, (s) => l.requires(s)).map(need),
      ...gates(place, had, clr).map(need),
      // (a dark area cleared without the Flare, unless True Dark: the Flare struck through, "Flareless")
      ...(l.areaClear && !trueDark && dark.includes(l.areaClear) && !had.has('flare')
        ? [{ need: { item: 'flare' as Item }, basis: { kind: 'flareless' as const }, struck: true }]
        : []),
    ];
    const same = (a: RouteNeed, b: RouteNeed) => JSON.stringify(a.need) === JSON.stringify(b.need);
    if (last && last.at === place) {
      last.steps.push(...text(l, item));
      for (const q of reqs) if (!last.needs.some((r) => same(r, q))) last.needs.push(q);
    } else entries.push({ at: place, place: label(place), why: [], needs: reqs, steps: text(l, item) });
  }
  const joe = area12NeedsJoe(rules.area12),
    areas = area12Needs1011(rules.area12);
  const end: RouteVisit = {
    place: { kind: 'area', area: 12, layout: 12 },
    why: [], // (no reasons on the oracle route)
    needs: [
      ...(rules.area12Comm ? [need(rules.area12Comm)] : []),
      ...(joe ? [need('joe')] : []),
      ...(areas ? [10, 11].map((cleared): RouteNeed => ({ need: { cleared }, basis: { kind: 'none' } })) : []),
      ...gates(12, owned, cleared).map(need),
    ],
    steps: area12Steps(area12Locks),
  };
  return [
    { place: { kind: 'start' }, why: [], needs: [], steps: [{ act: 'start', item: 'alpha' }] },
    ...entries.map(({ at: _, ...v }) => v),
    end,
  ];
}
