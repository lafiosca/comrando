// The seed simulator's modal: the map on the left; on the right the place last clicked (what's known
// about it, what can be done there) above the items; what was said and found in a wide pane below, newest first.
// The rules and the knowledge are sim.ts's; this says them in words.

import { itemIcon } from '../core/icons.ts';
import { portraitPixels } from '../core/portraits.ts';
import { NES_RGB } from '../core/nespal.ts';
import {
  MAN_SPOT,
  PASSAGE,
  simAct,
  simBlock,
  simFlareless,
  simReach,
  simStart,
  simVisit,
  type Block,
  type SimAction,
  type SimLog,
  type SimPlace,
  type SimSeed,
  type SimState,
} from '../core/sim.ts';
import { boxCenter, MAP_H, MAP_W, type MapMarks, mapPixels, PASSAGE_SPOTS } from '../core/mapart.ts';
import { ITEMS, type Item } from '../core/world.ts';

const ITEM_ORDER: Item[] = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'rocket',
  'wide',
  'machine',
  'threeway',
  'flare',
  'pills',
  'permit',
  'boots',
  'rapid',
  'pendant',
  'helmet',
  'vest',
  'iff',
  'flak',
  'passage',
  'joe',
];
const SYM: Partial<Record<Item, string>> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ' };
/** The items with no menu icon: a dialogue portrait instead (Super Joe's; the passage's hostage, the enemy soldier who talks). */
const PORTRAIT: Partial<Record<Item, number>> = { joe: 0x44, passage: 0x45 };
const name = (i: Item) => (i === 'passage' ? 'Underground passage' : ITEMS[i].name);
const list = (is: string[], conj = 'and') =>
  is.length < 3 ? is.join(` ${conj} `) : `${is.slice(0, -1).join(', ')} ${conj} ${is.at(-1)}`;
/** A gate's requirement: "IFF Code and Area 4 cleared". */
const gateNeed = (x?: { items: Item[]; areas: number[] }) =>
  x ? list([...x.items.map(name), ...x.areas.map((a) => `Area ${a} cleared`)]) : '';

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string) =>
  Object.assign(document.createElement(tag), { className: cls, ...(text !== undefined && { textContent: text }) });

const iconCache = new Map<string, string | null>();
function iconUrl(rom: Uint8Array, item: Item): string | null {
  if (!iconCache.has(item)) {
    const px = PORTRAIT[item] !== undefined ? portraitPixels(rom, PORTRAIT[item]!) : itemIcon(rom, item);
    let url: string | null = null;
    if (px) {
      const w = px[0].length,
        h = px.length;
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d')!,
        data = ctx.createImageData(w, h);
      px.flat().forEach((c, i) => {
        if (c >= 0) data.data.set([...NES_RGB[c], 255], 4 * i);
      });
      ctx.putImageData(data, 0, 0);
      url = canvas.toDataURL();
    }
    iconCache.set(item, url);
  }
  return iconCache.get(item)!;
}

/** The run icon (a return key's ⏎, in pixels): do it, read again. */
function runIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 10 8');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('shape-rendering', 'crispEdges');
  for (const [x, y, w, h] of [
    [7, 0, 2, 6],
    [2, 4, 7, 2],
    [1, 3, 1, 4],
    [0, 4, 1, 2],
    [2, 2, 1, 6],
  ]) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    Object.entries({ x, y, width: w, height: h }).forEach(([k, v]) => r.setAttribute(k, String(v)));
    svg.append(r);
  }
  return svg;
}

/** The open session (closing it to look at the spoiler and coming back picks up where it was): kept per seed. */
/** The simulator's tooltips: shown at once on hover or focus (the browser's own wait about a second), NES style: a
 * [data-tip] element's text, its first line the heading. In the dialog itself, as it's in the top layer. */
function tooltip(root: HTMLElement): HTMLElement {
  const tip = el('div', 'sim-tip');
  tip.setAttribute('aria-hidden', 'true'); // (each tipped element has its own aria-label)
  let on: HTMLElement | undefined;
  const show = (t: HTMLElement) => {
    on = t;
    const [head, ...rest] = t.dataset.tip!.split('\n');
    tip.replaceChildren(el('div', 'head', head), ...rest.map((line) => el('div', '', line)));
    tip.classList.add('on');
    // (below the element, else above; kept inside the window)
    const r = t.getBoundingClientRect(),
      w = tip.offsetWidth,
      h = tip.offsetHeight;
    tip.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.bottom + 6 + h < innerHeight - 8 ? r.bottom + 6 : Math.max(8, r.top - 6 - h)}px`;
  };
  const hide = () => {
    on = undefined;
    tip.classList.remove('on');
  };
  const find = (e: Event) => (e.target as Element).closest?.<HTMLElement>('[data-tip]') ?? undefined;
  root.addEventListener('pointerover', (e) => {
    const t = find(e);
    if (t && t !== on) show(t);
    else if (!t) hide();
  });
  root.addEventListener('pointerleave', hide);
  root.addEventListener('focusin', (e) => {
    const t = find(e);
    if (t && (t as HTMLElement).matches(':focus-visible')) show(t);
  });
  root.addEventListener('focusout', hide);
  root.addEventListener('pointerdown', hide);
  root.addEventListener('scroll', hide, true);
  return tip;
}

let session: { code: string; dialog: HTMLDialogElement } | undefined;

/** Open the simulator for a seed: the session left for it if any, else a new one. `make` generates the seed (only when
 * needed). */
export function openSimulator(seedCode: string, rom: Uint8Array, make: () => SimSeed) {
  if (session?.code === seedCode && session.dialog.isConnected) {
    session.dialog.showModal();
    return;
  }
  session?.dialog.remove();
  const seed = make();
  const dialog = el('dialog', 'sim');
  session = { code: seedCode, dialog };
  dialog.setAttribute('aria-label', 'Seed simulator');
  document.body.append(dialog);
  let st = simStart(seed),
    sel = 0,
    shownSel = -1;
  const history: SimState[] = [];
  const commit = (next: SimState) => {
    history.push(st);
    st = next;
    render();
  };

  const placeName = (n: number) =>
    n === 0 ? 'Map number 0 · Start' : n === PASSAGE ? 'Underground passage' : n <= 12 ? `Area ${n}` : `NZ${n}`;
  const actionName = (_p: SimPlace, a: SimAction) => {
    switch (a.kind) {
      case 'comm':
        return a.label ?? `Communicate ${a.room}`;
      case 'wiretap':
        return `Wiretap ${a.room}`;
      case 'talk':
        return `Talk ${a.inside ? 'inside' : 'outside'} door ${a.door}`;
      case 'room':
        return `Room ${a.door}${a.prisoner ? ' (the prisoner)' : ''}`;
      case 'clear':
        return 'Clear the area';
      case 'passage':
        return 'Clear the tunnel';
      case 'destroyer':
        return `Say YES to ${seed.namedDestroyers ? a.man!.name : 'the man'} (${MAN_SPOT[a.man!.position]})`;
      case 'step':
      case 'finish':
        return a.label!;
    }
  };
  // (a communicator by its symbol, as the comm rooms say it, if known for the place; else not given away)
  const needName = (n: number, i: Item) =>
    !SYM[i] ? name(i) : st.know[n]?.comm?.item === i ? SYM[i]! : "the area's communicator";
  const blockText = (b: Block, n: number) =>
    b.kind === 'items'
      ? `Needs ${list(b.items.map((i) => needName(n, i)))}`
      : b.kind === 'comm'
        ? 'Needs a communicator'
        : b.kind === 'dark'
          ? 'Too dark: needs the Flare'
          : b.kind === 'entry'
            ? `A guard: no entry without the ${name(b.item)}`
            : b.kind === 'unlock'
              ? `Needs Communicate ${list(b.rooms)}`
              : b.kind === 'after'
                ? `After: ${b.step}`
                : `Needs ${list(b.areas.map((a) => `Area ${a}`))} cleared`;
  const by = (key: string) => {
    if (key === 'tried') return 'it answered';
    if (key === 'briefing') return 'per the briefing';
    const [n, id] = key.split(':'),
      p = seed.places.get(Number(n))!,
      a = p.actions.find((x) => x.id === id);
    return `per ${placeName(Number(n))}${a ? ` ${sourceName(a)}` : ''}`;
  };
  /** An action as a clue's source, short: "Comm B", "Wiretap A", "Talker A", "Inside B", "Clear". */
  const sourceName = (a: SimAction) =>
    a.kind === 'comm'
      ? `Comm ${a.room}`
      : a.kind === 'wiretap'
        ? `Wiretap ${a.room}`
        : a.kind === 'talk'
          ? `${a.inside ? 'Inside' : 'Talker'} ${a.door}`
          : a.kind === 'destroyer'
            ? MAN_SPOT[a.man!.position]
            : a.kind === 'room'
              ? `Room ${a.door}`
              : 'Clear';
  const gotText = (a: SimAction, item?: Item) =>
    item
      ? name(item)
      : a.bullets
        ? `${a.bullets} bullet${a.bullets > 1 ? 's' : ''}`
        : a.kind === 'room' && !a.prisoner
          ? '1UP'
          : '';

  // --- layout ---
  const head = el('header', 'sim-head');
  const title = el('div', 'sim-title');
  title.append(el('h2', '', 'Seed simulator'), el('span', 'sim-code', seedCode));
  const tools = el('div', 'sim-tools');
  const undoBtn = el('button', 'ghost small', 'Undo');
  undoBtn.type = 'button';
  undoBtn.addEventListener('click', () => {
    const prev = history.pop();
    if (prev) {
      st = prev;
      render();
    }
  });
  const resetBtn = el('button', 'ghost small', 'Reset');
  resetBtn.type = 'button';
  resetBtn.addEventListener('click', () => {
    history.push(st);
    st = simStart(seed);
    sel = 0;
    render();
  });
  const closeBtn = el('button', 'ghost small', 'Close');
  closeBtn.type = 'button';
  closeBtn.addEventListener('click', () => dialog.close());
  tools.append(undoBtn, resetBtn, closeBtn);
  head.append(title, tools);

  // the map screen from the ROM (redrawn when the passage is found), the places as overlays on its number boxes
  const map = el('div', 'sim-map');
  const canvas = Object.assign(document.createElement('canvas'), { width: MAP_W, height: MAP_H });
  canvas.setAttribute('aria-hidden', 'true');
  const drawMap = (passage: boolean, marks: MapMarks) =>
    canvas.getContext('2d')!.putImageData(new ImageData(mapPixels(rom, passage, marks), MAP_W, MAP_H), 0, 0);
  /** A place's spot on the map, as a percentage of it. */
  const pos = (n: number, spot = 0) => {
    const [x, y] = n === PASSAGE ? PASSAGE_SPOTS[spot] : boxCenter(rom, n);
    return [(x / MAP_W) * 100, (y / MAP_H) * 100];
  };
  const mapBox = el('section', 'sim-mapbox');
  mapBox.setAttribute('aria-label', 'Map');
  mapBox.append(map);
  const place = el('section', 'sim-place');
  place.setAttribute('aria-label', 'Selected place');
  const items = el('section', 'sim-items');
  items.setAttribute('aria-label', 'Items');
  const side = el('div', 'sim-side');
  side.append(place, items);
  const logBox = el('section', 'sim-log');
  logBox.setAttribute('aria-label', 'What you learned');
  const body = el('div', 'sim-body');
  body.append(mapBox, side);
  dialog.append(head, body, logBox, tooltip(dialog));

  function render() {
    const reach = simReach(seed, st);
    // What the clues say is where, after what's been seen: a place whose item spots are all taken holds nothing more, so a
    // "maybe" there is ruled out, and a maybe with one place left is that place ("deduced")
    const exhausted = (n: number) => {
      const ls = seed.places.get(n)!.actions.filter((a) => a.location && (a.kind !== 'destroyer' || a.man!.real));
      return st.visited.includes(n) && ls.length > 0 && ls.every((a) => st.done.includes(`${n}:${a.id}`));
    };
    // (and in turn: an area's clear or the passage's tunnel holds one item, so a place known to hold one rules out the others'
    // maybes there, which may leave another maybe one place: again, till nothing changes)
    const clues = Object.entries(st.know).flatMap(([n, k]) =>
      (k.finds ?? []).filter((f) => !st.owned.includes(f.item)).map((f) => ({ n: Number(n), ...f })),
    );
    const single = (n: number) => (n >= 1 && n <= 11) || n === PASSAGE;
    const out = new Set<(typeof clues)[number]>(clues.filter((f) => f.maybe && exhausted(f.n)));
    const left = (f: (typeof clues)[number]) =>
      clues.filter((g) => g.maybe && g.item === f.item && g.by === f.by && !out.has(g));
    const sureAt = (n: number) =>
      clues.filter((f) => f.n === n && !out.has(f) && (!f.maybe || left(f).length === 1)).map((f) => f.item);
    for (let changed = true; changed; ) {
      changed = false;
      for (const f of clues)
        if (f.maybe && !out.has(f) && single(f.n) && sureAt(f.n).some((i) => i !== f.item)) {
          out.add(f);
          changed = true;
        }
    }
    const findsAt = (n: number) =>
      clues
        .filter((f) => f.n === n && !out.has(f))
        .map((f) => {
          const rest = f.maybe ? left(f) : [];
          return { ...f, maybe: f.maybe && rest.length > 1, deduced: !!f.maybe && rest.length === 1 };
        });
    /** An area's communicator by elimination: static on all but one. */
    const commLeft = (n: number) => {
      const k = st.know[n];
      if (k?.comm || !k?.notComm) return undefined;
      const rest = (['alpha', 'beta', 'gamma', 'delta'] as Item[]).filter((c) => !k.notComm!.includes(c));
      return rest.length === 1 ? rest[0] : undefined;
    };
    undoBtn.disabled = history.length === 0;

    // the map: the game's own screen, marked as its options mark it (map markers: a box visited blue, cleared green, a
    // zone cleared once its significant items are taken or, with none, once visited; gate display: a shut road red)
    const met = (g?: { items: Item[]; areas: number[] }) =>
      !g || (g.items.every((i) => st.owned.includes(i)) && g.areas.every((m) => st.cleared.includes(m)));
    const zoneCleared = (n: number) =>
      seed.places
        .get(n)!
        .actions.filter(
          (a) => a.location && a.location !== 'interrogation' && seed.placement.get(a.location) !== 'oneup',
        )
        .every((a) => st.done.includes(`${n}:${a.id}`));
    const boxes = new Map<number, 'visited' | 'cleared'>([[0, 'cleared']]); // (the start: nothing to do there, as in the game)
    for (let n = 1; n <= 19; n++)
      if (st.visited.includes(n))
        boxes.set(
          n,
          (n === 12 ? st.finished : n <= 11 ? st.cleared.includes(n) : zoneCleared(n)) ? 'cleared' : 'visited',
        );
    drawMap(st.owned.includes('passage'), { boxes, shut68: !met(seed.rules.gate), shut810: !met(seed.rules.gate10) });
    const gates = [
      [6, 8, seed.rules.gate],
      [8, 10, seed.rules.gate10],
    ] as const;
    const shut = gates
      .filter(([, , g]) => !met(g))
      .map(([a, b, g]) => {
        const [x1, y1] = pos(a),
          [x2, y2] = pos(b),
          mark = el('span', 'sim-gate', '×');
        mark.style.left = `${(x1 + x2) / 2}%`;
        mark.style.top = `${(y1 + y2) / 2}%`;
        // (hover: what opens it, and what's still missing once part of it is had)
        const missing = [
          ...g!.items.filter((i) => !st.owned.includes(i)).map(name),
          ...g!.areas.filter((m) => !st.cleared.includes(m)).map((m) => `Area ${m} cleared`),
        ];
        mark.dataset.tip = `${a}-${b} path: needs ${gateNeed(g)}${missing.length < g!.items.length + g!.areas.length ? `\nStill needs ${list(missing)}` : ''}`;
        mark.setAttribute('role', 'img');
        mark.setAttribute('aria-label', mark.dataset.tip.replace(/\n/g, '. '));
        return mark;
      });
    // (the passage stage: a small button on each hidden road)
    const spots = [...seed.places.keys()].flatMap((n) =>
      n !== PASSAGE
        ? [[n, 0]]
        : st.owned.includes('passage')
          ? [
              [n, 0],
              [n, 1],
            ]
          : [],
    );
    map.replaceChildren(
      canvas,
      ...shut,
      ...spots.map(([n, spot]) => {
        const p = seed.places.get(n)!,
          r = reach.has(n),
          seen = st.visited.includes(n);
        const b = el('button', `sim-spot ${p.kind}${r ? '' : ' off'}${sel === n ? ' sel' : ''}`);
        b.type = 'button';
        const [x, y] = pos(n, spot);
        b.style.left = `${x}%`;
        b.style.top = `${y}%`;
        if (seen && p.layout) b.append(el('span', 'layout', `O${p.layout}`));
        b.setAttribute(
          'aria-label',
          `${placeName(n)}${r ? '' : ', out of reach'}${seen && p.layout ? `, layout O${p.layout}` : ''}`,
        );
        b.addEventListener('click', () => {
          sel = n;
          if (r && !st.visited.includes(n)) commit(simVisit(seed, st, n));
          else render();
        });
        return b;
      }),
    );

    // the place
    const p = seed.places.get(sel)!,
      k = st.know[sel] ?? {},
      seen = st.visited.includes(sel);
    const facts: [string, 'info' | 'ok' | 'warn'][] = [];
    if (!reach.has(sel)) facts.push([`Out of reach for now${gateText(sel)}`, 'warn']);
    // (not an item already got: found, wherever it was)
    for (const f of findsAt(sel))
      facts.push([
        `${f.maybe ? 'Maybe holds' : 'Holds'} ${name(f.item)} (${f.deduced ? 'deduced, ' : ''}${by(f.by)})`,
        'info',
      ]);
    for (const f of k.needs ?? []) facts.push([`Needs ${name(f.item)} (${by(f.by)})`, 'info']);
    if (k.pointed) facts.push([`A clue sent you here (${by(k.pointed)})`, 'info']);
    if (k.joeTrail && !st.cleared.includes(sel)) facts.push([`Joe's trail (${by(k.joeTrail)})`, 'info']); // (cleared: he was moved on, the clue settled)
    if (p.kind === 'area') {
      if (k.noRoom) facts.push(['No comm room here: no communicator needed', 'ok']);
      else if (k.comm)
        facts.push([
          `Communicator: ${SYM[k.comm.item]} (${by(k.comm.by)})`,
          st.owned.includes(k.comm.item) ? 'ok' : 'warn',
        ]);
      else if (commLeft(sel))
        facts.push([
          `Communicator: ${SYM[commLeft(sel)!]} (deduced: not ${list(
            k.notComm!.map((c) => SYM[c]!),
            'or',
          )})`,
          st.owned.includes(commLeft(sel)!) ? 'ok' : 'warn',
        ]);
      else if (k.notComm?.length)
        facts.push([
          `Communicator: not ${list(
            k.notComm.map((c) => SYM[c]!),
            'or',
          )}, so ${list(
            (['alpha', 'beta', 'gamma', 'delta'] as Item[]).filter((c) => !k.notComm!.includes(c)).map((c) => SYM[c]!),
            'or',
          )}`,
          'warn',
        ]);
      else facts.push(['Communicator: unknown', 'warn']);
    }
    const flareless = st.flareless.includes(sel) && !st.owned.includes('flare');
    if (p.dark && seen)
      facts.push([
        st.owned.includes('flare')
          ? 'Dark area: the Flare lights it'
          : flareless
            ? 'Dark area: going in without the Flare'
            : 'Dark area: the Flare would light it',
        st.owned.includes('flare') ? 'ok' : 'warn',
      ]);
    if (sel === 0) facts.push(['Where the flight starts. Click any place the paths reach; travel is free.', 'ok']);
    const heading = el('div', 'sim-place-head');
    heading.append(el('h3', '', placeName(sel)), el('span', 'sim-code', seen && p.layout ? `Layout O${p.layout}` : ''));
    const factList = el('ul', 'sim-facts');
    factList.append(...facts.map(([t, kind]) => el('li', `is-${kind}`, t)));
    const acts = el('ul', 'sim-acts');
    if (seen && reach.has(sel))
      for (const a of p.actions) {
        const key = `${sel}:${a.id}`,
          done = st.done.includes(key),
          block = simBlock(seed, st, sel, a),
          said = a.says.some((m) => seed.text(m).trim());
        // (an impostor: named, tried, or the real one known)
        const tried = a.kind === 'destroyer' && (st.impostors.includes(a.man!.name) || (st.trusted && !a.man!.real));
        // (a comm room that gave static with every communicator carried)
        // (a comm room, the area's communicator not carried: the one a clue or a try told, else what static hasn't ruled out)
        const carried = st.owned.filter((i) => SYM[i]),
          isComm = a.kind === 'comm' || a.kind === 'wiretap';
        const commNeed = !isComm
          ? []
          : k.comm
            ? st.owned.includes(k.comm.item)
              ? []
              : [k.comm.item]
            : k.notComm && carried.every((c) => k.notComm!.includes(c))
              ? (['alpha', 'beta', 'gamma', 'delta'] as Item[]).filter((c) => !k.notComm!.includes(c))
              : [];
        const staticNow = commNeed.length > 0;
        const item = a.location ? seed.placement.get(a.location) : undefined;
        // (the real Destroyer found: all three settled, greyed; the impostors' lines still there to read)
        const settled =
          a.kind === 'destroyer' &&
          p.actions.some((x) => x.kind === 'destroyer' && x.man!.real && st.done.includes(`${sel}:${x.id}`));
        const li = el('li', done || settled ? 'done' : '');
        const text = el('span', 'sim-act-text');
        text.append(
          el('span', 'label', actionName(p, a)),
          el(
            'span',
            `note ${!done && (block || staticNow || tried) ? 'is-warn' : ''}`,
            done
              ? item || a.bullets || a.kind === 'room'
                ? `Done: got ${gotText(a, item)}`
                : a.kind === 'step' || a.kind === 'finish'
                  ? 'Done'
                  : 'Heard'
              : tried
                ? 'An impostor'
                : block
                  ? blockText(block, sel)
                  : staticNow
                    ? `Needs ${list(
                        commNeed.map((c) => SYM[c]!),
                        'or',
                      )}`
                    : a.kind === 'destroyer' && st.trusted
                      ? 'The real one'
                      : 'Ready',
          ),
        );
        li.append(text);
        const button = (label: string, cls: string, run: () => void, icon = false) => {
          const b = el('button', `small ${cls}${icon ? ' run' : ''}`, icon ? undefined : label);
          b.type = 'button';
          if (icon) {
            b.append(runIcon());
            b.setAttribute('aria-label', `${label}: ${actionName(p, a)}`);
          }
          b.addEventListener('click', run);
          li.append(b);
        };
        if ((done || settled) && said)
          button('Read again', 'ghost', () => commit(simAct(seed, st, sel, a.id, { again: true })), true);
        else if (!done && !block && !staticNow) button('Do it', 'go', () => commit(simAct(seed, st, sel, a.id)), true);
        acts.append(li);
      }
    // (a dark area without the Flare: going in anyway is a choice, for the whole area)
    const brute = el('div', 'sim-brute');
    if (p.dark && seen && reach.has(sel) && !st.owned.includes('flare') && !flareless && !seed.trueDark) {
      const b = el('button', 'small guess', 'Go Flareless');
      b.type = 'button';
      b.addEventListener('click', () => commit(simFlareless(st, sel)));
      brute.append(b);
    }
    // (the same place: the action list stays scrolled where it was)
    const scroll = shownSel === sel ? (place.querySelector('.sim-acts')?.scrollTop ?? 0) : 0;
    place.replaceChildren(
      heading,
      factList,
      ...(brute.childElementCount ? [brute] : []),
      ...(acts.childElementCount ? [acts] : []),
    );
    acts.scrollTop = scroll;
    shownSel = sel;

    // the items
    const grid = el('div', 'sim-item-grid'),
      gateCol = el('div', 'sim-item-col'),
      cells = el('div', 'sim-item-cells');
    const cell = (i: Item) => {
      const own = st.owned.includes(i),
        box = el('div', `sim-item ${own ? 'own' : ''}`);
      // (what clues said of where it is: "In NZ14 (per Area 3 · COMMUNICATE A)", "Maybe in Area 3 / Area 7")
      const where = [...new Set(clues.map((f) => f.n))].flatMap((n) => findsAt(n)).filter((f) => f.item === i);
      const maybes = where.filter((f) => f.maybe),
        sure = where.filter((f) => !f.maybe);
      // (a communicator: the areas it's known to work in, by a clue or a try)
      const works = SYM[i]
        ? Object.entries(st.know)
            .filter(([n, k]) => k.comm?.item === i || commLeft(Number(n)) === i)
            .map(([n]) => Number(n))
            .sort((x, y) => x - y)
        : [];
      // (where it's needed, owned or not: a clue that says so, a dark area seen (the Flare), the guard seen (the Permit))
      const needed = [
        ...Object.entries(st.know).flatMap(([n, k]) =>
          (k.needs ?? []).filter((f) => f.item === i).map((f) => `Needed in ${placeName(Number(n))} (${by(f.by)})`),
        ),
        ...(i === 'flare'
          ? [...seed.places.values()]
              .filter(
                (p) => p.dark && st.visited.includes(p.n) && !st.know[p.n]?.needs?.some((f) => f.item === 'flare'),
              )
              .map((p) => `Needed in ${placeName(p.n)} (dark)`)
          : []),
        ...[...seed.places.values()]
          .filter((p) => p.entry === i && st.visited.includes(p.n))
          .map((p) => `Needed in ${placeName(p.n)} (a guard)`),
      ];
      // (Joe, until rescued: his trail; where the hostage is, until the passage is found, said as such)
      const trail =
        i === 'joe' && !own
          ? Object.entries(st.know)
              .filter(([n, k]) => k.joeTrail && !st.cleared.includes(Number(n)))
              .map(([n, k]) => `Trail: ${placeName(Number(n))} (${by(k.joeTrail!)})`)
          : [];
      const at = i === 'passage' ? 'Hostage in' : 'In';
      box.dataset.tip = [
        name(i),
        ...(works.length ? [`Works in ${works.length > 1 ? 'Areas' : 'Area'} ${list(works.map(String))}`] : []),
        ...needed,
        ...(own
          ? []
          : [
              ...sure.map((f) => `${at} ${placeName(f.n)} (${f.deduced ? 'deduced, ' : ''}${by(f.by)})`),
              ...(maybes.length
                ? [`Maybe ${at.toLowerCase()} ${maybes.map((f) => placeName(f.n)).join(' / ')} (${by(maybes[0].by)})`]
                : []),
              ...trail,
            ]),
      ].join('\n');
      box.setAttribute('role', 'img');
      box.setAttribute('aria-label', `${box.dataset.tip.replace(/\n/g, '. ')}${own ? '' : ', not yet'}`);
      const url = iconUrl(rom, i);
      if (url)
        box.append(
          Object.assign(document.createElement('img'), {
            src: url,
            alt: '',
            ...(PORTRAIT[i] !== undefined
              ? { width: 36, height: 48, className: 'portrait' }
              : { width: 48, height: 48 }),
          }),
        );
      return box;
    };
    // (the IFF Code and Flak Map only when the seed has them)
    const pool = new Set(seed.placement.values()),
      shown = ITEM_ORDER.filter((i) => (i !== 'iff' && i !== 'flak') || pool.has(i));
    grid.append(...shown.slice(0, 16).map(cell));
    gateCol.append(...shown.slice(16).map(cell));
    cells.append(grid, gateCol);
    items.replaceChildren(
      el('h3', '', `Items · ${shown.filter((i) => st.owned.includes(i)).length} of ${shown.length}`),
      cells,
    );

    // what was said and found, newest first
    const entries = el('ol', 'sim-entries');
    entries.append(...st.log.map((l, i) => logEntry(l, i === 0)));
    if (st.finished)
      entries.prepend(el('li', 'sim-entry newest win', 'Mission complete: Master-D defeated, Ladd escapes.'));
    const logHead = el('h3', '', `What you've learned · ${st.log.length}`);
    logBox.replaceChildren(logHead, st.log.length ? entries : el('p', 'sim-empty', 'Nothing yet.'));
  }

  function logEntry(l: SimLog, newest: boolean) {
    const p = seed.places.get(l.place)!,
      a = p.actions.find((x) => x.id === l.action);
    const li = el('li', `sim-entry${newest ? ' newest' : ''}`);
    li.append(
      el(
        'span',
        'where',
        l.note === 'briefing'
          ? 'Briefing'
          : `${placeName(l.place)}${a ? ` · ${actionName(p, a)}` : ''}${l.note === 'again' ? ' (again)' : ''}`,
      ),
    );
    // (one line each: the box's rows run together, messages apart by a slash; a word the box hyphenated at a row's end, or
    // a message going on in the next ("STAY-" / "ING"), whole again; ¦ marks where one message ends: no game text has it)
    const text = l.messages
      .map((m) => seed.text(m))
      .filter(Boolean)
      .join('¦')
      .replace(/([A-Z])-[\n¦](?=[A-Z])/g, '$1')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/¦/g, ' / ');
    const note =
      l.note === 'static'
        ? "Static: not this area's communicator."
        : l.note === 'impostor'
          ? seed.destroyerTrap
            ? 'An impostor! A trap (3 HP in the game).'
            : 'An impostor: no gun this visit.'
          : l.note === 'flareless'
            ? 'Cleared in the dark, without the Flare.'
            : '';
    const got = l.got ? `Got ${name(l.got)}.` : a && a.kind === 'room' && !a.location ? `Got ${gotText(a)}.` : '';
    // (Area 12's steps say nothing: what was done)
    const did = a?.kind === 'finish' ? 'Mission complete.' : a?.kind === 'step' ? 'Done.' : '(nothing said)';
    li.append(el('span', 'said', [text, note, got].filter(Boolean).join('  ') || did));
    return li;
  }

  /** Why a place is out of reach: the gate it's behind, as far as the settings tell. */
  function gateText(n: number) {
    type Gate = { items: Item[]; areas: number[] };
    if (n === PASSAGE) return ": the passage hasn't been found";
    // (which gates stand in the way: the one that, opened, reaches it, else both, the 6-8 first as the road goes)
    const opened = (gs: Gate[]) =>
      simReach(seed, {
        ...st,
        owned: [...st.owned, ...gs.flatMap((g) => g.items)],
        cleared: [...st.cleared, ...gs.flatMap((g) => g.areas)],
      }).has(n);
    const met = (g: Gate) => g.items.every((i) => st.owned.includes(i)) && g.areas.every((m) => st.cleared.includes(m));
    const shut: [string, Gate][] = [];
    for (const [road, g] of [
      ['6-8', seed.rules.gate],
      ['8-10', seed.rules.gate10],
    ] as [string, Gate | undefined][])
      if (g && !met(g)) shut.push([road, g]);
    const one = shut.find(([, g]) => opened([g]));
    const need = one ? [one] : opened(shut.map(([, g]) => g)) ? shut : [];
    return need.length
      ? ` (behind the ${need.map(([road, g], i) => `${i ? 'then the ' : ''}${road} gate: needs ${gateNeed(g)}`).join('; ')})`
      : '';
  }

  render();
  dialog.showModal();
}
