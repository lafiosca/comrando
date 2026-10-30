import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { FLAK_FLAG } from '../src/core/patches/roads.ts';
import { makeSeedCode, type Settings } from '../src/core/settings.ts';
import { ITEMS } from '../src/core/world.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { clearOf } from './spoil.ts';

/** The reward of map number n's area clear (spoiler keys name the layout too: "Area 3 clear (O10)"). */

const IFF_FLAG = 0x04ca + ITEMS.iff.inventory;
/** The gated roads' tiles (column, row) on the map screen. */
const ROAD_68 = [
  [14, 16],
  [15, 16],
  [14, 17],
  [15, 17],
  [16, 14],
  [17, 14],
  [16, 15],
  [17, 15],
  [18, 12],
  [19, 12],
  [18, 13],
  [19, 13],
];
const ROAD_810 = [
  [20, 6],
  [21, 6],
  [20, 7],
  [21, 7],
  [20, 8],
  [21, 8],
  [20, 9],
  [21, 9],
];

/** Screen pixels drawn by visible sprites with tile `lo`..`hi` (8x8 sprites, pattern table $0000). */
function spritePixels(emu: Emu, lo: number, hi: number): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < 64; i++) {
    const [y, tile, , x] = emu.ram(0x200 + 4 * i, 4);
    if (y >= 0xef || tile < lo || tile > hi) continue;
    for (let r = 0; r < 8; r++) {
      const bits = emu.vram(tile * 16 + r) | emu.vram(tile * 16 + 8 + r);
      for (let c = 0; c < 8; c++) if (bits & (0x80 >> c)) out.add(`${x + c},${y + 1 + r}`);
    }
  }
  return out;
}

/** White (color 1) pixels of background tiles. */
function roadPixels(emu: Emu, tiles: number[][]): string[] {
  const out: string[] = [];
  for (const [col, row] of tiles) {
    const t = emu.vram(0x2000 + row * 32 + col);
    for (let r = 0; r < 8; r++) {
      const p0 = emu.vram(0x1000 + t * 16 + r),
        p1 = emu.vram(0x1000 + t * 16 + 8 + r);
      for (let c = 0; c < 8; c++)
        if (p0 & (0x80 >> c) && !(p1 & (0x80 >> c))) out.push(`${col * 8 + c},${row * 8 + r}`);
    }
  }
  return out;
}

/** Visible card sprites (tiles $A2-$A5): [OAM y, tile, attributes, x]. */
const cards = (emu: Emu) =>
  Array.from({ length: 64 }, (_, i) => emu.ram(0x200 + 4 * i, 4)).filter(
    ([y, t]) => y < 0xef && t >= 0xa2 && t <= 0xa5,
  );
const IFF_NAME = 0x2000 + 23 * 32 + 23,
  FLAK_NAME = 0x2000 + 26 * 32 + 23;

/** A seed whose first area isn't Joe's (his clear plays the rescue instead of returning to the map). */
function seed(settings: Settings) {
  for (let n = 1n; ; n++) {
    const gen = generate(loadRom(), makeSeedCode({ areas: 'vanilla', ...settings }, n));
    if (clearOf(gen.spoiler, 1) !== 'joe') return gen;
  }
}

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

describe.skipIf(!HAVE_ROM)('map gate display in the emulator', () => {
  it('shut roads are covered in red sprites; the IFF Code and Flak Map show in the corner once held', () => {
    const emu = new Emu(seed({ gate: 'iff', flak: 'flak' }).rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    const red = spritePixels(emu, 0x9d, 0xa1);
    for (const [name, tiles] of [
      ['6-8', ROAD_68],
      ['8-10', ROAD_810],
    ] as const) {
      const road = roadPixels(emu, tiles);
      expect(road.length, name).toBeGreaterThan(40);
      expect(
        road.filter((p) => !red.has(p)),
        `${name}: white pixels left`,
      ).toEqual([]);
    }
    expect(red.size).toBe(roadPixels(emu, [...ROAD_68, ...ROAD_810]).length); // nothing else turns red
    expect(cards(emu), 'no cards yet').toEqual([]);
    expect(emu.vram(IFF_NAME), 'no names yet').toBe(0x20);

    // the IFF Code: 6<->8 opens (white again) and its green card shows; 8<->10 stays red
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(IFF_FLAG, 1);
    clearAndReturn(emu);
    expect([emu.peek(0xcb), emu.peek(0xcc)]).toEqual([1, 1]);
    const red2 = spritePixels(emu, 0x9d, 0xa1);
    expect(roadPixels(emu, ROAD_68).filter((p) => red2.has(p))).toEqual([]);
    expect(roadPixels(emu, ROAD_810).filter((p) => !red2.has(p))).toEqual([]);
    // its card: 4 sprites in palette 1 (green) at x 160-175, 4 px above its name's row (y 184)
    expect(cards(emu).map(([y, t, a, x]) => [y + 1, t, a, x])).toEqual([
      [180, 0xa2, 1, 160],
      [180, 0xa3, 1, 168],
      [188, 0xa4, 1, 160],
      [188, 0xa5, 1, 168],
    ]);
    expect(emu.vram(FLAK_NAME), 'no Flak Map yet').toBe(0x20);
    // "IFF CODE": letter tiles hold the font's glyphs (I: rows $7E $18 ...)
    const i = emu.vram(IFF_NAME);
    expect(i).toBeGreaterThanOrEqual(0x80);
    expect([0, 1, 8].map((r) => emu.vram(0x1000 + i * 16 + r))).toEqual([0x7e, 0x18, 0]);
    expect(emu.vram(IFF_NAME + 1), 'F').not.toBe(i);

    // the Flak Map: both roads open, both cards
    expect(emu.bootToFirstArea()).toBe(true);
    emu.poke(FLAK_FLAG, 1);
    clearAndReturn(emu);
    expect(spritePixels(emu, 0x9d, 0xa1).size).toBe(0);
    expect(emu.vram(FLAK_NAME)).toBe(emu.vram(IFF_NAME + 1)); // F
    expect(
      cards(emu)
        .filter(([, , a]) => a === 0)
        .map(([y, t, , x]) => [y + 1, t, x]),
      'Flak Map card: palette 0 (red), y 204',
    ).toEqual([
      [204, 0xa2, 160],
      [204, 0xa3, 168],
      [212, 0xa4, 160],
      [212, 0xa5, 168],
    ]);
    expect(cards(emu).filter(([, , a]) => a === 1)).toHaveLength(4);
  }, 120_000);

  it('the SELECT screen in a level shows the red paths too (and the level gets its sprite tiles back after)', () => {
    const emu = new Emu(seed({ gate: 'iff', flak: 'flak' }).rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    const level = Array.from({ length: 0x50 }, (_, i) => emu.vram(0x9d0 + i));
    emu.press('SELECT', 4, 120);
    const red = spritePixels(emu, 0x9d, 0xa1);
    for (const tiles of [ROAD_68, ROAD_810]) expect(roadPixels(emu, tiles).filter((p) => !red.has(p))).toEqual([]);
    emu.press('SELECT', 4, 180);
    expect([emu.peek(0xcb), emu.peek(0xcc)]).toEqual([1, 3]);
    expect(
      Array.from({ length: 0x50 }, (_, i) => emu.vram(0x9d0 + i)),
      "the level's sprite tiles",
    ).toEqual(level);
  }, 60_000);

  it('vanilla gates show their roads red until their own conditions are met; open roads never', () => {
    const gen = seed({ gate: 'vanilla', flak: 'open' });
    const emu = new Emu(gen.rom);
    expect(emu.bootToMapAtArea1()).toBe(true);
    const red = spritePixels(emu, 0x9d, 0xa1);
    expect(roadPixels(emu, ROAD_68).filter((p) => !red.has(p))).toEqual([]);
    expect(roadPixels(emu, ROAD_810).filter((p) => red.has(p))).toEqual([]);
    // Areas 3 and 6 cleared and γ held (vanilla layouts: layout = map number)
    for (const f of [0x04ea + 3, 0x04ea + 6, 0x04ca + ITEMS.gamma.inventory]) emu.poke(f, 1);
    emu.run(2);
    expect(spritePixels(emu, 0x9d, 0xa1).size).toBe(0);
  }, 60_000);

  it('off leaves the map code alone', () => {
    const rom = loadRom();
    const out = generate(
      rom,
      makeSeedCode({ gateDisplay: 'off', markers: 'off', zones: 'vanilla', areas: 'vanilla' }, 3n),
    ).rom;
    const at = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
    for (let a = at(0x0b, 0xb276); a < at(0x0b, 0xb279); a++) expect(out[a]).toBe(rom[a]);
    for (let a = at(0x0d, 0xa409); a < at(0x0d, 0xa40c); a++) expect(out[a]).toBe(rom[a]);
    for (let a = at(0x0d, 0x9d00); a < at(0x0d, 0x9db0); a++) expect(out[a]).toBe(rom[a]); // ($9DB0 on: truck drops)
  });
});
