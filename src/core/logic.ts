// Reachability sweep and assumed fill. The fill only produces placements the sweep proves beatable, and the
// generator re-checks the final placement before patching.

import type { Rng } from './rng.ts';
import {
  canFinish,
  reachableMap,
  START_ITEMS,
  type Area12Condition,
  type Item,
  type Location,
  type Rules,
} from './world.ts';

export type Placement = Map<string, Item>; // location id -> item

/** Items that unlock other locations or the win condition; everything else is filler for logic purposes. */
export const PROGRESSION: ReadonlySet<Item> = new Set<Item>([
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
]);

/** Rules from a bare Area 12 condition (no road gate) or a full set. */
const rulesOf = (r: Area12Condition | Rules): Rules => (typeof r === 'string' ? { area12: r } : r);
/** Progression for these rules: the base set plus whatever the road gate asks for. */
const progressionOf = (r: Rules) =>
  new Set<Item>([...PROGRESSION, ...(r.gate?.items ?? []), ...(r.gate10?.items ?? [])]);

export interface Sweep {
  /** Locations in the order they become reachable, grouped into spheres. */
  spheres: { location: string; item: Item }[][];
  reachable: Set<string>;
  /** Map numbers of cleared areas. */
  cleared: Set<number>;
  /** Map numbers reachable at the end. */
  map: Set<number>;
  canFinish: boolean;
}

/**
 * Collect everything reachable from the start, sphere by sphere. Items come only from `placement` (which must include
 * the fixed locations); `extra` are items assumed owned (used by the fill).
 */
export function sweep(
  locations: Location[],
  placement: Placement,
  rules: Area12Condition | Rules,
  extra: Item[] = [],
): Sweep {
  const { area12, gate, gate10, area12Comm } = rulesOf(rules);
  const owned = new Set<Item>([...START_ITEMS, ...extra]);
  const state = { has: (i: Item) => owned.has(i) };
  const reachable = new Set<string>();
  const cleared = new Set<number>();
  const spheres: Sweep['spheres'] = [];
  let map = reachableMap(state, cleared, gate, gate10);
  for (;;) {
    const sphere = locations.filter((l) => !reachable.has(l.id) && l.at.some((m) => map.has(m)) && l.requires(state));
    if (!sphere.length) break;
    for (const l of sphere) {
      reachable.add(l.id);
      if (l.areaClear) cleared.add(l.mapNumber ?? l.areaClear);
    }
    // Only placed items count: an empty location (mid-fill) gives nothing.
    const got = sphere.flatMap((l) => (placement.has(l.id) ? [{ location: l.id, item: placement.get(l.id)! }] : []));
    for (const g of got) owned.add(g.item);
    spheres.push(got);
    map = reachableMap(state, cleared, gate, gate10);
  }
  return { spheres, reachable, cleared, map, canFinish: canFinish(state, cleared, area12, map, area12Comm) };
}

/** Beatable, and every location reachable (no item can be stranded). */
export function isCompletable(locations: Location[], placement: Placement, rules: Area12Condition | Rules): boolean {
  const s = sweep(locations, placement, rules);
  return s.canFinish && s.reachable.size === locations.length;
}

/**
 * Assumed fill over the shuffled locations: place progression items first, each into a location reachable when
 * assuming every not-yet-placed item is owned; then scatter the rest. Retries on the rare dead end.
 */
export function fill(locations: Location[], rules: Area12Condition | Rules, rng: Rng): Placement {
  const condition = rulesOf(rules);
  const progression = progressionOf(condition);
  const pool = locations.filter((l) => l.shuffled);
  const byId = new Map(locations.map((l) => [l.id, l]));
  const fixed: Placement = new Map(locations.filter((l) => !l.shuffled).map((l) => [l.id, l.vanilla]));
  for (let attempt = 0; attempt < 100; attempt++) {
    const items = pool.map((l) => l.vanilla);
    const prog = rng.shuffle(items.filter((i) => progression.has(i)));
    const junk = rng.shuffle(items.filter((i) => !progression.has(i)));
    const placement: Placement = new Map(fixed);
    const open = new Set(pool.map((l) => l.id));
    let ok = true;
    const accepts = (id: string, item: Item) => byId.get(id)!.accepts?.(item) ?? true;
    while (prog.length) {
      const item = prog.pop()!;
      const assumed = [...prog]; // items still to be placed are assumed collectible
      const s = sweep(locations, placement, condition, assumed);
      const candidates = [...open].filter((id) => s.reachable.has(id) && accepts(id, item));
      if (!candidates.length) {
        ok = false;
        break;
      }
      const at = rng.pick(candidates.sort());
      placement.set(at, item);
      open.delete(at);
    }
    if (!ok) continue;
    // the rest, most constrained first (e.g. a 1UP only fits area clears and its own building)
    const fits = (item: Item) => [...open].filter((id) => accepts(id, item)).length;
    for (const item of junk.sort((a, b) => fits(a) - fits(b))) {
      const spots = [...open].filter((id) => accepts(id, item)).sort();
      if (!spots.length) {
        ok = false;
        break;
      }
      const at = rng.pick(spots);
      placement.set(at, item);
      open.delete(at);
    }
    if (!ok) continue;
    if (isCompletable(locations, placement, condition)) return placement;
  }
  throw new Error('fill: could not produce a completable placement');
}

/**
 * Could any placement of the shuffled items beat these locations? (Every shuffled item assumed owned from the start;
 * the fixed items still have to be reached.) Used to reroll a map layout that strands a fixed item.
 */
export function feasible(locations: Location[], rules: Area12Condition | Rules): boolean {
  const fixed: Placement = new Map(locations.filter((l) => !l.shuffled).map((l) => [l.id, l.vanilla]));
  const s = sweep(
    locations,
    fixed,
    rules,
    locations.filter((l) => l.shuffled).map((l) => l.vanilla),
  );
  return s.canFinish && s.reachable.size === locations.length;
}

/**
 * Items the seed can't be beaten without: each placed progression item (or fixed event) whose location, taken away,
 * leaves the end out of reach. Alternatives (two ways east) make neither required.
 */
export function requiredItems(locations: Location[], placement: Placement, rules: Area12Condition | Rules): Item[] {
  const r = rulesOf(rules);
  const keys = new Set<Item>([...progressionOf(r), 'passage']);
  const out: Item[] = [];
  for (const l of locations) {
    const item = placement.get(l.id);
    if (!item || !keys.has(item)) continue;
    const without = locations.map((x) => (x.id === l.id ? { ...x, requires: () => false } : x));
    if (!sweep(without, placement, r).canFinish) out.push(item);
  }
  return out;
}

/**
 * Deepen a placement by hill-climbing: swap the items of two shuffled locations, keep the swap when the placement stays
 * completable (`locations`, the route's rules) and valid (`valid`), and its score doesn't drop. The score is what the game
 * truly can't be beaten without (`trueLocations`: `requiredItems` besides Joe), plus a bonus once `wantComm` holds (a
 * β, γ or δ among them). Sideways moves are kept too, to cross plateaus. Returns the best placement found (`placement`
 * itself if nothing helped) once it meets `minDepth` (and `wantComm`), or after `steps` swaps.
 */
export function deepen(
  locations: Location[],
  trueLocations: Location[],
  placement: Placement,
  rules: Area12Condition | Rules,
  rng: Rng,
  {
    minDepth,
    wantComm,
    valid = () => true,
    steps = 400,
  }: { minDepth: number; wantComm: boolean; valid?: (p: Placement) => boolean; steps?: number },
): Placement {
  const score = (p: Placement) => {
    const req = requiredItems(trueLocations, p, rules).filter((i) => i !== 'joe');
    const comm = req.some((i) => i === 'beta' || i === 'gamma' || i === 'delta');
    return { value: req.length + (wantComm && comm ? 100 : 0), done: req.length >= minDepth && (!wantComm || comm) };
  };
  const byId = new Map(locations.map((l) => [l.id, l]));
  const ids = locations
    .filter((l) => l.shuffled)
    .map((l) => l.id)
    .sort();
  const accepts = (id: string, item: Item) => byId.get(id)!.accepts?.(item) ?? true;
  let cur = new Map(placement),
    curScore = score(cur);
  let best = cur,
    bestScore = curScore;
  for (let step = 0; step < steps && !bestScore.done; step++) {
    const a = rng.pick(ids),
      b = rng.pick(ids);
    const ia = cur.get(a)!,
      ib = cur.get(b)!;
    if (a === b || ia === ib || !accepts(a, ib) || !accepts(b, ia)) continue;
    const next = new Map(cur);
    next.set(a, ib);
    next.set(b, ia);
    if (!isCompletable(locations, next, rules) || !valid(next)) continue;
    const s = score(next);
    if (s.value < curScore.value) continue;
    cur = next;
    curScore = s;
    if (s.value > bestScore.value || s.done) {
      best = next;
      bestScore = s;
    }
  }
  return best;
}
