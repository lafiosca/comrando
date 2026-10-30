import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { Rng } from '../src/core/rng.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { readMessage } from '../src/core/text.ts';
import { AREA_NUMBERS, applyMapLayout, shuffleGroup, spotOf, vanillaLayout, ZONE_NUMBERS } from '../src/core/zones.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { areaOf, joeTip, layoutAt } from './spoil.ts';

const BANK0D = 0x10 + 0x0d * 0x4000 - 0x8000;

const shuffled = (seed: string) => {
  const layout = vanillaLayout();
  shuffleGroup(layout, ZONE_NUMBERS, new Rng(`z${seed}`));
  shuffleGroup(layout, AREA_NUMBERS, new Rng(`a${seed}`));
  return layout;
};

describe('map layout shuffle', () => {
  it('permutes enemy areas and neutral zones separately; 0 and 12 stay', () => {
    for (let i = 0; i < 50; i++) {
      const layout = shuffled(`${i}`);
      for (const group of [AREA_NUMBERS, ZONE_NUMBERS]) {
        expect(group.map((n) => layout.get(n)!).sort((a, b) => a - b)).toEqual(group);
      }
      expect(layout.has(0) || layout.has(12)).toBe(false);
      const spot = spotOf(layout);
      for (const [n, id] of layout) expect(spot(id)).toBe(n);
      expect(spot(0)).toBe(0);
      expect(spot(12)).toBe(12);
    }
  });
});

/** Seed code whose spoiler puts a layout other than NZ13 at map number 13, and that layout's identity. */
function seedMovingZone13(): { rom: Uint8Array; id: number; spoiler: ReturnType<typeof generate>['spoiler'] } {
  for (let n = 1; ; n++) {
    if (n > 300) throw new Error('no seed found');
    const { rom, spoiler } = generate(loadRom(), makeSeedCode({ areas: 'vanilla' }, BigInt(n))); // Area 1 where the flight starts
    const id = layoutAt(spoiler, 13);
    if (id !== 13) return { rom, id, spoiler };
  }
}

describe.skipIf(!HAVE_ROM)('opening briefing', () => {
  it('Area 1\'s layout (the briefing\'s "AGENTS IN AREA x") always sits at map numbers 1-6', () => {
    const seen = new Set<number>();
    for (let n = 1n; n <= 60n; n++) {
      const spot = areaOf(generate(loadRom(), makeSeedCode({}, n)).spoiler, 1);
      seen.add(spot);
      expect(spot).toBeLessThanOrEqual(6);
    }
    expect(seen.size).toBeGreaterThan(3); // still moves around
  });
});

describe.skipIf(!HAVE_ROM)('map layout shuffle in the ROM', () => {
  it('vanilla layout changes nothing; passage gates name the identity at spots 14, 18 and 15', () => {
    const rom = loadRom();
    const same = rom.slice();
    applyMapLayout(same, vanillaLayout());
    expect(same).toEqual(rom);

    const layout = shuffled('gates');
    const out = rom.slice();
    applyMapLayout(out, layout);
    expect(out[BANK0D + 0xa602]).toBe(layout.get(14));
    expect(out[BANK0D + 0xa606]).toBe(layout.get(18));
    expect(out[BANK0D + 0xa60a]).toBe(layout.get(15));
  });

  it('flying to map number 13 lands in the layout placed there', () => {
    const { rom, id } = seedMovingZone13();
    const e = new Emu(rom);
    expect(e.bootToMapAtArea1()).toBe(true);
    // open the route menu (TRANSFER) and pick Area 1's third road, the one to spot 13
    e.poke(0x491, 0);
    for (let i = 0; i < 200 && e.peek(0x491) !== 2; i++) e.press('A', 4, 10);
    e.run(200);
    e.press('RIGHT', 4, 30);
    for (let i = 0; i < 100 && e.peek(0x491) !== 3; i++) e.press('A', 4, 10);
    e.run(60);
    for (let i = 0; i < 10 && e.peek(0x49a) !== 2; i++) e.press('RIGHT', 4, 40);
    for (let i = 0; i < 20 && e.peek(0x74); i++) e.press('A', 2, 8);
    e.press('A', 4, 10);
    e.run(800);
    expect(e.peek(0x4d)).toBe(id);
    for (let i = 0; i < 6; i++) e.press('A', 4, 40); // descend
    expect(e.peek(0xcc)).toBe(3);
    expect(e.peek(0x4c)).toBe(id - 1);
  });

  it('enemy areas: map number 1 lands in the layout placed there; trucks, clear digits, text follow', () => {
    let n = 1,
      rom: Uint8Array,
      spoiler: ReturnType<typeof generate>['spoiler'],
      id: number;
    for (; ; n++) {
      if (n > 300) throw new Error('no seed found');
      ({ rom, spoiler } = generate(
        loadRom(),
        makeSeedCode({ mapSpeed: '1', hints: 'vanilla', comms: 'vanilla' }, BigInt(n)),
      )); // input timings: normal speed
      id = layoutAt(spoiler, 1);
      if (id !== 1 && id !== 4) break;
    }
    const layout = new Map(spoiler.layouts.map((p) => [p.area, p.layout]));
    const spot = spotOf(layout);
    const e = new Emu(rom);
    expect(e.bootToMapAtArea1(id)).toBe(true);
    for (let i = 0; i < 6; i++) e.press('A', 4, 40); // descend
    expect(e.peek(0xcc)).toBe(2); // enemy areas stop at the equipment screen first
    expect(e.peek(0x4c)).toBe(id - 1);

    // truck convoys start from the same spots (vanilla 4, 3, 7, 10, 8)
    const trucks = [...rom.subarray(BANK0D + 0xa99f, BANK0D + 0xa9a4)];
    expect(trucks.map((b) => spot(b & 15))).toEqual([4, 3, 7, 10, 8]);
    // "xxAREA CLEAR" digits: BCD map number by identity
    const table = 0x10 + 0x0a * 0x4000 + 0xbb4e - 0x8000; // by identity 0-12 (only enemy areas have a clear screen)
    for (let a = 0; a <= 12; a++) expect(rom[table + a]).toBe(parseInt(String(spot(a)), 16));
    // area-numbered lines name map numbers
    const text = (y: number) => readMessage(rom, y / 2 + 2)!.text.replace(/ +/g, '');
    expect(text(0x1c)).toContain(`AREA${spot(4)}ISAN`);
    const alpha = [1, 4, 5].map(spot).sort((a, b) => a - b);
    expect(text(0x2a)).toContain(`AREAS${alpha[0]},${alpha[1]},AND${alpha[2]}.`); // (Fix Typos, the default: an Oxford comma)
    expect(text(0xf8)).toContain(`AGENTSINAREA${spot(1)}NOW`);
  });

  it("Joe's Destroyer tip names the map number holding the Destroyers' layout", () => {
    const { rom, spoiler } = seedMovingZone13();
    const spot = areaOf(spoiler, 18);
    // (no tip when the route took the Destroyer item before Joe: hints.ts)
    if (!joeTip(spoiler)?.startsWith('THANKS'))
      expect(readMessage(rom, 47)!.text.replace(/ +/g, ' ')).toContain(`AREA ${spot} `);
  });
});
