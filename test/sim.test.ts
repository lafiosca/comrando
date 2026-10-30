import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import {
  PASSAGE,
  simAct,
  simBlock,
  simFlareless,
  simReach,
  simStart,
  simVisit,
  type SimSeed,
  type SimState,
} from '../src/core/sim.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

/** A player who does everything they can, everywhere they can go (Destroyers by guess, dark areas Flareless), until done. */
function playOut(seed: SimSeed): SimState {
  let st = simStart();
  for (let round = 0; round < 200 && !st.finished; round++) {
    let progress = false;
    for (const n of simReach(seed, st)) {
      if (!st.visited.includes(n)) {
        st = simVisit(seed, st, n);
        progress = true;
      }
      for (const a of seed.places.get(n)!.actions) {
        if (st.done.includes(`${n}:${a.id}`) || simBlock(seed, st, n, a, true)) continue;
        const before = JSON.stringify([st.owned, st.done, st.cleared]);
        st = simAct(seed, st, n, a.id, { brute: true });
        if (JSON.stringify([st.owned, st.done, st.cleared]) !== before) progress = true;
      }
    }
    if (!progress) break;
  }
  return st;
}

describe.skipIf(!HAVE_ROM)('the seed simulator', () => {
  it('every item location is something to do at some place', () => {
    const { sim } = generate(loadRom(), makeSeedCode({}, 3n));
    const actions = new Set([...sim.places.values()].flatMap((p) => p.actions.map((a) => a.location)).filter(Boolean));
    expect([...sim.placement.keys()].filter((id) => !actions.has(id))).toEqual([]);
  });

  it('a player doing everything they can finishes the seed, across settings', () => {
    const variants: Record<string, string>[] = [
      {},
      { areas: 'vanilla', zones: 'vanilla' },
      { hints: 'nonsense' },
      { hints: 'vanilla' },
      { gate: 'vanilla', flak: 'vanilla' },
      { area12: 'joe+10+11', area12Comm: 'both' },
      { darkAreas: 'more', dark: 'true' },
      { commLocks: 'all' },
      { buildings: 'vanilla', pickups: 'vanilla' },
    ];
    for (const v of variants)
      for (let n = 1n; n <= 6n; n++) {
        const st = playOut(generate(loadRom(), makeSeedCode(v, n)).sim);
        expect(st.finished, `${JSON.stringify(v)} seed ${n}: ${st.owned.join()}`).toBe(true);
      }
  }, 300_000);

  it("fog of war: an area's comm room gives static on the wrong communicator, and the place says so", () => {
    for (let n = 1n; n <= 30n; n++) {
      const { sim } = generate(loadRom(), makeSeedCode({}, n));
      const p = [...sim.places.values()].find(
        (x) => x.kind === 'area' && x.commRoom && x.comm !== 'alpha' && simReach(sim, simStart()).has(x.n),
      );
      if (!p) continue;
      let st = simVisit(sim, simStart(), p.n);
      expect(st.know[p.n] ?? {}, 'nothing known on the way in').toEqual({});
      const comm = p.actions.find((a) => a.kind === 'comm')!;
      st = simAct(sim, st, p.n, comm.id);
      expect(st.log[0]).toMatchObject({ note: 'static', messages: [sim.staticMessage] });
      expect(st.know[p.n].notComm, 'α tried: static').toEqual(['alpha']);
      expect(st.know[p.n].comm).toBeUndefined();
      expect(st.done).not.toContain(`${p.n}:${comm.id}`);
      return;
    }
    throw new Error('no seed with a reachable non-α area');
  });

  it("a clue's facts land on the places it names; the message is the ROM's", () => {
    const { sim } = generate(loadRom(), makeSeedCode({ hints: 'verbose' }, 2n));
    let st = simStart();
    const one = [...sim.places.values()].find(
      (p) => p.kind === 'area' && p.comm === 'alpha' && p.actions.some((a) => a.teaches.length && a.kind === 'comm'),
    )!;
    st = simVisit(sim, st, one.n);
    const a = one.actions.find((x) => x.teaches.length && x.kind === 'comm')!;
    st = simAct(sim, st, one.n, a.id);
    expect(st.log[0].messages.length).toBeGreaterThan(0);
    expect(sim.text(st.log[0].messages[0])).toMatch(/[A-Z]/);
    const told = Object.entries(st.know).filter(
      ([, k]) =>
        k.comm?.by === `${one.n}:${a.id}` ||
        k.finds?.some((f) => f.by === `${one.n}:${a.id}`) ||
        k.needs?.length ||
        k.pointed,
    );
    expect(told.length, JSON.stringify(a.teaches)).toBeGreaterThan(0);
  });

  it('Flareless (brute force) opens a whole dark area: its comm rooms as well as its clear', () => {
    for (let n = 1n; n <= 40n; n++) {
      const { sim } = generate(loadRom(), makeSeedCode({ darkAreas: 'more' }, n));
      const p = [...sim.places.values()].find(
        (x) => x.dark && x.actions.some((a) => a.kind === 'comm') && simReach(sim, simStart()).has(x.n),
      );
      if (!p) continue;
      let st = simVisit(sim, simStart(), p.n);
      const comm = p.actions.find((a) => a.kind === 'comm')!,
        clear = p.actions.find((a) => a.kind === 'clear')!;
      expect(simBlock(sim, st, p.n, comm)).toEqual({ kind: 'dark' });
      expect(simBlock(sim, st, p.n, clear)?.kind).toBe('dark');
      st = simFlareless(st, p.n);
      expect(simBlock(sim, st, p.n, comm)).toBeUndefined();
      expect(simBlock(sim, st, p.n, clear)?.kind).not.toBe('dark');
      return;
    }
    throw new Error('no seed with a reachable dark area with a comm room');
  });

  it("a comm-locked area's clear waits for Communicate in the room that opens its door", () => {
    const { sim } = generate(loadRom(), makeSeedCode({}, 6n));
    const p = [...sim.places.values()].find((x) => x.layout === 1)!; // (O1: always locked, on α)
    expect(p.unlock).toEqual(['A']);
    let st = simVisit(sim, simStart(sim), p.n);
    const clear = p.actions.find((a) => a.kind === 'clear')!;
    expect(simBlock(sim, st, p.n, clear, true)).toEqual({ kind: 'unlock', rooms: ['A'] });
    for (const id of ['commB', 'wireB'])
      expect(simBlock(sim, st, p.n, p.actions.find((a) => a.id === id)!), `${id}: past O1's door`).toEqual({
        kind: 'unlock',
        rooms: ['A'],
      });
    st = simAct(sim, st, p.n, 'commA');
    expect(simBlock(sim, st, p.n, clear, true)).toBeUndefined();
    expect(simBlock(sim, st, p.n, p.actions.find((a) => a.id === 'commB')!)).toBeUndefined();
  });

  it('Area 12 is its steps in order, by its door locks, the escape last', () => {
    const { sim } = generate(loadRom(), makeSeedCode({ area12Comm: 'both' }, 2n));
    const p = sim.places.get(12)!;
    expect(p.actions.map((a) => a.label ?? a.id)).toEqual([
      'Communicate A: opens Power A',
      'wireA',
      'Destroy Power A',
      'Communicate B: opens miniboss door',
      'wireB',
      'Defeat miniboss: opens Power B',
      'Destroy Power B',
      'Defeat Master-D',
      'Escape',
    ]);
    expect(p.actions.at(-1)!.kind).toBe('finish');
    const st = playOut(sim);
    expect(st.done.filter((k) => k.startsWith('12:')).sort()).toEqual(p.actions.map((a) => `12:${a.id}`).sort());
    expect(sim.text(p.actions[0].says[0])).toMatch(/SUPER JOE|JOE/); // (#96, or the seed's line there)
    // (no door locks: its comm rooms are there all the same, B's past the first barrier)
    const open = generate(loadRom(), makeSeedCode({ area12Comm: 'none' }, 2n)).sim.places.get(12)!;
    expect(open.actions.map((a) => a.id)).toEqual([
      'commA',
      'wireA',
      'step0',
      'commB',
      'wireB',
      'step1',
      'step2',
      'finish',
    ]);
    expect(open.actions.find((a) => a.id === 'commB')!.after).toBe('step0');
  });

  it('the passage stage opens only once the passage is found', () => {
    const { sim } = generate(loadRom(), makeSeedCode({}, 4n));
    expect(simReach(sim, simStart()).has(PASSAGE)).toBe(false);
    const st = playOut(sim);
    expect(st.owned).toContain('passage');
  });
});

describe.skipIf(!HAVE_ROM)('the map screen from the ROM', () => {
  it('draws the frame and the boxes, and the hidden roads only once the passage is found', async () => {
    const { boxCenter, mapPixels, MAP_H, MAP_W } = await import('../src/core/mapart.ts');
    const rom = loadRom(),
      shut = mapPixels(rom, false),
      open = mapPixels(rom, true);
    expect(shut.length).toBe(MAP_W * MAP_H * 4);
    const changed = new Set<string>();
    for (let i = 0; i < shut.length; i += 4)
      if (shut[i] !== open[i] || shut[i + 1] !== open[i + 1] || shut[i + 2] !== open[i + 2])
        changed.add(`${((i / 4) % MAP_W) >> 3},${Math.floor(i / 4 / MAP_W) >> 3}`);
    expect([...changed].sort()).toEqual(['12,6', '12,7', '13,6', '13,7', '16,16', '16,17', '17,16', '17,17'].sort()); // (two roads, four tiles each)
    for (let n = 0; n <= 19; n++) {
      const [x, y] = boxCenter(rom, n);
      expect(x > 0 && x < MAP_W && y > 0 && y < MAP_H, `box ${n}`).toBe(true);
    }
  });
});

describe.skipIf(!HAVE_ROM)('dialogue portraits from the ROM', () => {
  it("draws Super Joe's and the enemy soldier's faces (the simulator's Joe and passage icons)", async () => {
    const { portraitPixels, PORTRAIT_H, PORTRAIT_W } = await import('../src/core/portraits.ts');
    for (const header of [0x44, 0x45]) {
      const px = portraitPixels(loadRom(), header);
      expect([px.length, px[0].length]).toEqual([PORTRAIT_H, PORTRAIT_W]);
      expect(px.flat().filter((c) => c >= 0).length, `$${header.toString(16)}`).toBeGreaterThan(1500); // (a face, not blank)
    }
    expect(portraitPixels(loadRom(), 0x44)).not.toEqual(portraitPixels(loadRom(), 0x45));
  });
});
