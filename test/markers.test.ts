import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { areaOf, clearOf } from './spoil.ts';

/** Nametable position of map number n's box (row, col), as drawn on the map screen. */
const BOX: Record<number, [number, number]> = {
  0: [18, 4],
  1: [10, 4],
  2: [14, 8],
  3: [18, 8],
  4: [6, 8],
  5: [10, 12],
  6: [18, 12],
  7: [6, 16],
  8: [10, 20],
  9: [14, 20],
  10: [4, 20],
  11: [10, 26],
  13: [6, 4],
  14: [18, 16],
  15: [6, 12],
  16: [10, 8],
  17: [18, 20],
  18: [10, 16],
  19: [14, 24],
};
const boxPalette = (emu: Emu, n: number) => {
  const [r, c] = BOX[n];
  const a = emu.vram(0x23c0 + (r >> 2) * 8 + (c >> 2));
  return (a >> (((r >> 1) & 1) * 4 + ((c >> 1) & 1) * 2)) & 3;
};
const visit = (emu: Emu, id: number) => emu.poke(0x1d0 + (id >> 3), emu.peek(0x1d0 + (id >> 3)) | (1 << (id & 7)));

/** Force the game's own clear sequence for the current area and wait for the map. */
function clearAndReturn(emu: Emu) {
  emu.poke(0xcb, 2);
  emu.poke(0xcc, 0);
  emu.poke(0xcd, 0);
  emu.poke(0xce, 0);
  for (let i = 0; i < 150 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 1); i++) {
    emu.run(40);
    if (emu.peek(0x74)) emu.press('A', 4, 4);
  }
  emu.run(200);
}

function layoutOf(spoiler: ReturnType<typeof generate>['spoiler']) {
  return (id: number) => areaOf(spoiler, id);
}

describe.skipIf(!HAVE_ROM)('map markers in the emulator', () => {
  it('entering marks visited (blue); cleared enemy areas turn green; by map number, not layout', () => {
    // a seed whose first area isn't Joe's (his clear plays the rescue instead of returning normally)
    let n = 1n;
    let gen!: ReturnType<typeof generate>;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      gen = generate(loadRom(), makeSeedCode({}, n));
      if (clearOf(gen.spoiler, 1) !== 'joe') break;
    }
    const spot = layoutOf(gen.spoiler);
    const emu = new Emu(gen.rom);
    expect(emu.bootToFirstArea()).toBe(true);
    const first = emu.peek(0x4d);
    expect(spot(first)).toBe(1);
    expect(emu.peek(0x1d0 + (first >> 3)) & (1 << (first & 7)), 'descending marked it visited').toBeTruthy();
    const nzVisited = 17,
      otherCleared = first === 6 ? 5 : 6;
    visit(emu, nzVisited);
    emu.poke(0x4ea + otherCleared, 1);
    clearAndReturn(emu);
    expect([emu.peek(0xcb), emu.peek(0xcc)]).toEqual([1, 1]);
    for (const id of [first, otherCleared]) {
      expect(boxPalette(emu, spot(id)), `cleared area ${id} at ${spot(id)}`).toBe(3);
    }
    expect(boxPalette(emu, spot(nzVisited)), `visited NZ${nzVisited} at ${spot(nzVisited)}`).toBe(2);
    // untouched areas stay vanilla
    const untouched = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].find((id) => id !== first && id !== otherCleared)!;
    expect(boxPalette(emu, spot(untouched))).toBe(0);
    expect(boxPalette(emu, 0), 'the start, always green').toBe(3);
  }, 120_000);

  it('a neutral zone turns green once its significant items are taken; one with none, once visited', () => {
    // vanilla buildings and items: NZ15 δ ($04E3), NZ17 the passage room ($04F7), NZ18 the Destroyers' Machine Gun
    // ($04CE), NZ19 only a 1UP (Flak Map off)
    const settings = {
      zones: 'vanilla',
      areas: 'vanilla',
      buildings: 'vanilla',
      pickups: 'vanilla',
      destroyer: 'vanilla',
      flak: 'open',
      depth: '0',
      pathComm: 'off',
    };
    const emu = new Emu(generate(loadRom(), makeSeedCode(settings, 1n)).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    for (const id of [15, 17, 18, 19]) visit(emu, id);
    emu.poke(0x4e3, 1);
    emu.poke(0x4ce, 1); // δ and the Machine Gun taken; the passage not yet revealed
    clearAndReturn(emu);
    expect([emu.peek(0xcb), emu.peek(0xcc)]).toEqual([1, 1]);
    expect([15, 17, 18, 19].map((n) => boxPalette(emu, n))).toEqual([3, 2, 3, 3]);
  }, 120_000);

  it('backing out of the equipment screen does not mark the area visited; going in does', () => {
    const emu = new Emu(generate(loadRom(), makeSeedCode({ areas: 'vanilla', mapSpeed: '1' }, 3n)).rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    const visited = () => emu.peek(0x1d0) & 0x02; // map number 1 = identity 1
    for (let i = 0; i < 10 && emu.peek(0xcc) !== 2; i++) emu.press('A', 4, 40); // DESCEND -> equipment screen
    expect(emu.peek(0xcc)).toBe(2);
    emu.run(60);
    for (let i = 0; i < 10 && emu.peek(0xcc) !== 1; i++) emu.press('B', 4, 40); // cancel back to the map
    expect(emu.peek(0xcc)).toBe(1);
    expect(visited(), 'cancelled').toBe(0);
    emu.run(200);
    for (let i = 0; i < 30 && emu.peek(0xcc) !== 3; i++) emu.press('A', 4, 40); // descend and go in
    expect(emu.peek(0xcc)).toBe(3);
    expect(visited(), 'entered').not.toBe(0);
  }, 120_000);

  it('visited flags and the Flak Map survive a continue and are cleared by a new game', () => {
    for (const [continues, kept] of [
      ['1', true],
      ['0', false],
    ] as const) {
      const emu = new Emu(generate(loadRom(), makeSeedCode({ continues }, 3n)).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      visit(emu, 19);
      emu.poke(0x1d3, 1); // the Flak Map
      emu.poke(0xcb, 0);
      emu.poke(0xcc, 1);
      emu.poke(0xcd, 0);
      emu.poke(0xce, 0); // game over
      emu.run(400);
      emu.press('START', 4, 60); // CONTINUE when offered, else a new game
      for (let i = 0; i < 100 && !(emu.peek(0xcb) === 1 && emu.peek(0xcc) === 3); i++) emu.press(i % 2 ? 'A' : 'START');
      expect(emu.peek(0x1d2) & 0x08, `continues ${continues}`).toBe(kept ? 0x08 : 0);
      expect(emu.peek(0x1d3), `Flak Map, continues ${continues}`).toBe(kept ? 1 : 0);
    }
  }, 120_000);

  it('markers off leaves the map code alone', () => {
    const rom = loadRom();
    const out = generate(
      rom,
      makeSeedCode({ markers: 'off', gateDisplay: 'off', zones: 'vanilla', areas: 'vanilla' }, 3n),
    ).rom;
    for (let a = 0x2f4b0; a < 0x2f710; a++) expect(out[a]).toBe(rom[a]); // 0B:$B4A0-$B6FF ($B700+ is text space)
    for (let a = 0x3e3cd; a < 0x3e400; a++) expect(out[a]).toBe(rom[a]); // the map's attributes (box 0 stays pink)
  });
});
