// The route in words (the spoiler is data, so other renderings and translations can work
// from it): every English string of the route is here, read off the visits (spoiler.ts RouteVisit).
import type { Basis, Clue, ProbeTarget, RouteNeed, RoutePlace, RouteStep, RouteVisit, Source, Why } from './spoiler.ts';
import { ITEMS } from './world.ts';

/** A visit as the page shows it: "Area 4 (O3) suggested by 1c", its requirements, its lettered steps. */
export interface RouteEntry {
  place: string;
  layout?: string;
  why: string;
  /** (struck: what the full route would wait for and this one goes without, "~~Flare~~ Flareless") */
  requirements: { item: string; why: string; struck?: boolean }[];
  /** A step: its text, the line said there (shown in monospace), a note after it, the reward;
   * `blocked` a dead end (in red), `extra` the win didn't need it. */
  steps: {
    text: string;
    quote?: string;
    note?: string;
    reward?: string;
    optional?: boolean;
    blocked?: boolean;
    extra?: boolean;
  }[];
}

const REGION = { west: 'in the west', central: 'in the central region', compound: 'in the enemy compound' };
const OPENS = {
  door: 'opens door',
  bossDoor: 'opens boss door',
  powerA: 'opens Power A',
  powerB: 'opens Power B',
  minibossDoor: 'opens miniboss door',
};
const SPECIAL = {
  noComm: 'No communicator needed',
  commUnknown: 'Communicator unknown',
  destroyerIntel: 'Destroyer intel',
  hp3: 'At least 3 HP',
};

/** A step's label: "4c" (the route's entries from 0, the briefing's; steps lettered from a). */
export const stepLabel = (entry: number, step: number) => `${entry}${String.fromCharCode(97 + step)}`;
export const placeName = (p: RoutePlace) =>
  p.kind === 'briefing'
    ? 'Briefing'
    : p.kind === 'start'
      ? 'Start'
      : p.kind === 'passage'
        ? 'Underground passage'
        : `${p.kind === 'zone' ? 'NZ' : 'Area '}${p.area}`;
const placeLabel = (p: RoutePlace) => ('layout' in p ? `${placeName(p)} (O${p.layout})` : placeName(p));
const itemName = (i: string) =>
  i === 'anotherComm'
    ? 'another communicator'
    : i === 'destroyerName'
      ? "the real Destroyer's name"
      : ITEMS[i as keyof typeof ITEMS].name;
const items = (is: readonly string[]) => is.map(itemName).join(' and ');
/** A hint slot by id, as the player knows it: a comm room's COMMUNICATE is "O1A comm". */
const slotName = (id: string) => (/^O\d+[A-Z]$/.test(id) ? `${id} comm` : id);
const source = (s: Source) =>
  s.kind === 'step'
    ? stepLabel(s.entry, s.step)
    : s.kind === 'briefing'
      ? 'the briefing'
      : s.kind === 'joeRescue'
        ? "Super Joe's rescue line"
        : slotName(s.slot);
/** Sources joined, a run of step labels in route order ("1c & 2d"). */
const sources = (ss: Source[]) =>
  ss
    .map(source)
    .join(' & ')
    .replace(/\b\d+[a-z](?: & \d+[a-z])+/g, (m) =>
      m
        .split(' & ')
        .sort((x, y) => parseInt(x, 10) - parseInt(y, 10) || x.localeCompare(y))
        .join(' & '),
    );
const clue = (c: Clue) =>
  sources(c.by) +
  (!c.vague
    ? ''
    : 'region' in c.vague
      ? `: somewhere ${REGION[c.vague.region]}, Areas ${c.vague.areas[0]}-${c.vague.areas[1]}`
      : `: Area ${c.vague.either[0]} or ${c.vague.either[1]}`);

export function whyText(why: Why[]): string {
  return why
    .map((w) => {
      switch (w.kind) {
        case 'suggested':
          return `suggested by ${w.clues.map(clue).join(' & ')}`;
        case 'onTheWay':
          return w.to
            ? `on the way to ${w.to.kind === 'passage' ? 'the underground passage' : placeName(w.to)}`
            : 'on the way';
        case 'lookingAround':
          return 'looking around';
        case 'finishing':
          return 'finishing the run';
        case 'trial':
          return 'trial and error';
        case 'area12Entry':
          return 'required for Area 12 entry';
        case 'byPassage':
          return 'by the underground path';
        case 'flownFrom':
          return `flown from ${placeLabel(w.place)}`;
        case 'returnWith':
          return `return with ${items(w.items)}`;
        case 'searchingForJoe':
          return `searching for Joe per ${sources(w.by)}`;
      }
    })
    .join(', ');
}

const basisText = (b: Basis) =>
  b.kind === 'per'
    ? `per ${sources(b.by)}`
    : b.kind === 'trial'
      ? 'trial and error'
      : b.kind === 'checkArea'
        ? 'check area'
        : b.kind === 'settings'
          ? 'per seed settings'
          : b.kind === 'flareless'
            ? 'Flareless'
            : '';
const needText = (n: RouteNeed['need']) =>
  'item' in n ? ITEMS[n.item].name : 'cleared' in n ? `Area ${n.cleared} cleared` : SPECIAL[n.special];
const target = (t: ProbeTarget) =>
  t.kind === 'enter'
    ? 'Enter'
    : t.kind === 'room'
      ? `Room ${t.door}${t.prisoner ? ' (the prisoner)' : ''}`
      : t.kind === 'talk'
        ? `Talk ${t.inside ? 'inside' : 'outside'} ${t.door}`
        : t.kind === 'destroyerRooms'
          ? 'Rooms A and B'
          : t.kind === 'comm'
            ? `Comm ${t.room}`
            : 'Second half';

export function stepText(s: RouteStep): RouteEntry['steps'][number] {
  const flags = { ...(s.optional && s.act !== 'probe' && { optional: true }), ...(s.extra && { extra: true }) };
  switch (s.act) {
    case 'start':
      return { text: 'Start with', reward: itemName(s.item), ...flags };
    case 'briefing':
      return { text: '', quote: s.quote, ...flags };
    case 'comm':
    case 'wiretap': {
      const name = `${s.act === 'comm' ? 'Comm' : 'Wiretap'} ${s.room}`,
        note = s.opens && OPENS[s.opens];
      return s.quote !== undefined
        ? { text: name, quote: s.quote, ...(note && { note }), ...flags }
        : { text: note ? `${name}: ${note}` : name, ...flags };
    }
    case 'talk': {
      const name = `Talk ${s.inside ? 'inside' : 'outside'} ${s.door}`;
      return s.quote !== undefined ? { text: name, quote: s.quote, ...flags } : { text: name, ...flags };
    }
    case 'room':
      return {
        text: `Room ${s.door}${s.prisoner ? ' (the prisoner)' : ''}: obtain`,
        reward: s.item ? itemName(s.item) : `${s.bullets} bullet${s.bullets === 1 ? '' : 's'}`,
        ...flags,
      };
    case 'destroyer':
      return {
        text: `Room ${s.door}, say YES to ${s.name ?? `the man ${s.position}`}${s.by === undefined ? '' : ` (${s.by === 'trial' ? 'trial and error' : `per ${sources(s.by)}`})`}: obtain`,
        reward: itemName(s.item),
        ...flags,
      };
    case 'clear':
      return s.item === 'joe' && !s.trail
        ? { text: 'Clear area: rescue', reward: itemName(s.item), ...flags }
        : { text: 'Clear area: obtain', reward: itemName(s.item), ...(s.trail && { note: 'Joe was moved' }), ...flags };
    case 'passage':
      return { text: 'Clear passage: obtain', reward: itemName(s.item), ...flags };
    case 'probe':
      return {
        text: `${target(s.target)}: needs`,
        reward: typeof s.needs === 'string' ? itemName(s.needs) : items(s.needs),
        blocked: true,
        ...flags,
      };
    case 'destroy':
      return { text: `Destroy ${s.target === 'powerA' ? 'Power A' : 'Power B'}`, ...flags };
    case 'defeat':
      return {
        text: `Defeat ${s.target === 'miniboss' ? 'miniboss' : 'Master-D'}${s.opens ? `: ${OPENS[s.opens]}` : ''}`,
        ...flags,
      };
    case 'escape':
      return { text: 'Escape', ...flags };
  }
}

/** The route in words, for the page. */
export function renderRoute(route: RouteVisit[]): RouteEntry[] {
  return route.map((v) => ({
    place: placeName(v.place),
    ...('layout' in v.place && { layout: `O${v.place.layout}` }),
    why: whyText(v.why),
    requirements: v.needs.map((q) => ({
      item: needText(q.need),
      why: basisText(q.basis),
      ...(q.struck && { struck: true }),
    })),
    steps: v.steps.map(stepText),
  }));
}

/** Every Source in a route value, replaced by `f` (abridge's renumbering; hints.ts resolving its slot references). */
export function mapSources<T>(x: T, f: (s: Source) => Source): T {
  if (Array.isArray(x)) return x.map((y) => mapSources(y, f)) as T;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    if ((o.kind === 'step' && 'entry' in o) || (o.kind === 'slot' && 'slot' in o))
      return f(x as unknown as Source) as T; // (the only ones renumbered or resolved)
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, mapSources(v, f)])) as T;
  }
  return x;
}

/** The route without what the win didn't need, numbered afresh: the steps cited ("per 4c",
 * "suggested by 2a & 3b") pointed at their new places, and "on the way to" the next place this list heads for. */
export function abridge(route: RouteVisit[]): RouteVisit[] {
  const at = new Map<string, { entry: number; step: number }>(),
    kept: RouteVisit[] = [];
  route.forEach((e, k) => {
    const steps = e.steps.filter((x) => !x.extra);
    if (!steps.length && k > 0) return;
    e.steps.forEach((x, j) => {
      const i = steps.indexOf(x);
      if (i >= 0) at.set(`${k}|${j}`, { entry: kept.length, step: i });
    });
    kept.push({ ...e, steps });
  });
  const renumbered = kept.map((e) =>
    mapSources(e, (s) => (s.kind === 'step' ? { kind: 'step' as const, ...(at.get(`${s.entry}|${s.step}`) ?? s) } : s)),
  );
  const headed = (v: RouteVisit) => v.why.length > 0 && !v.why.some((w) => w.kind === 'onTheWay');
  return renumbered.map((e, k) => {
    const next = renumbered.slice(k + 1).find(headed);
    return { ...e, why: e.why.map((w) => (w.kind === 'onTheWay' && w.to && next ? { ...w, to: next.place } : w)) };
  });
}
