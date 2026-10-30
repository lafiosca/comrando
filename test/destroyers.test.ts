import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { SHOT_TYPE } from '../src/core/patches/weapons.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { readMessage, wrap } from '../src/core/text.ts';
import { ITEMS, type Item } from '../src/core/world.ts';
import { Emu } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';
import { rewardOf } from './spoil.ts';

const seedCode = (n: number, settings = {}) =>
  makeSeedCode({ areas: 'vanilla', zones: 'vanilla', mapSpeed: '1', ...settings }, BigInt(n));
type Cpu = { REG_X: number; REG_Y: number };
const cpuOf = (emu: Emu) => (emu.nes as unknown as { cpu: Cpu }).cpu;
/** From inside a level, load `room` at map node `node`. */
const enter = (emu: Emu, node: number, room: number) => {
  emu.poke(0x4d, node);
  emu.poke(0x4c, room);
  emu.poke(0x4be, 0);
  emu.poke(0x536, 0x81);
  emu.poke(0x65a, 0x11);
  emu.poke(0x66d, 0);
  emu.run(300);
};
const raw = (rom: Uint8Array, y: number) => readMessage(rom, y / 2 + 2)!.text;
const text = (rom: Uint8Array, y: number) => raw(rom, y).replace(/ +/g, ' ').trim();

describe.skipIf(!HAVE_ROM)('barriers', () => {
  it('each barrier site breaks only for its weapon: Area 6 Rocket Launcher, Area 7 3-Way Gun, NZ15 Machine Gun', () => {
    const { rom } = generate(loadRom(), seedCode(1));
    const breaks = (room: number, shot: number) => {
      const emu = new Emu(rom);
      emu.poke(0x4c, room);
      emu.poke(0x549 + 2, shot); // the shot that hit (slot 2)
      emu.poke(0x647 + 15, 1); // the barrier (slot 15), standing
      const cpu = cpuOf(emu);
      cpu.REG_X = 15;
      cpu.REG_Y = 2;
      emu.callSub(0x0e, 0xbfc0); // after the collision test
      return emu.peek(0x647 + 15) === 2; // state 2: breaking
    };
    const rules: [number, number][] = [
      [0x05, SHOT_TYPE.rocket],
      [0x06, SHOT_TYPE.threeway],
      [0x0e, SHOT_TYPE.machine],
    ];
    for (const [room, needed] of rules) {
      for (const shot of Object.values(SHOT_TYPE))
        expect(breaks(room, shot), `room $${room.toString(16)}, shot ${shot}`).toBe(shot === needed);
    }
  });

  it("an alert (any shot in a neutral zone) no longer clears NZ15's barriers; vanilla setting keeps the old behaviour", () => {
    for (const [barrier, stay] of [
      ['machine', true],
      ['vanilla', false],
    ] as const) {
      const emu = new Emu(generate(loadRom(), seedCode(1, { barrier })).rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      enter(emu, 15, 0x0e);
      expect(emu.ram(0x549 + 15, 2)).toEqual([0x35, 0x35]);
      expect(emu.ram(0x536 + 15, 2)).toEqual([1, 1]);
      emu.poke(0x4c4, 1); // the alert
      emu.run(120);
      expect(emu.ram(0x536 + 15, 2), barrier).toEqual(stay ? [1, 1] : [0, 0]);
    }
  }, 120_000);
});

describe.skipIf(!HAVE_ROM)('Destroyers', () => {
  /** A seed whose Destroyer rooms hold `want` (or anything, without it). */
  const seedWith = (want?: Item) => {
    for (let n = 1; n <= 300; n++) {
      const gen = generate(loadRom(), seedCode(n));
      const item = rewardOf(gen.spoiler, 'destroyer')!;
      if (!want || item === want) return { gen, item: ITEMS[item].name };
    }
    throw new Error(`no seed puts ${want} in the Destroyer rooms`);
  };

  it('three named men ask about the Federation; the real one names his item; Joe names him', () => {
    const { gen, item } = seedWith();
    const { rom, spoiler } = gen;
    const { men, real } = spoiler.destroyers!;
    const names = men.map((m) => m.name);
    expect(new Set(names).size).toBe(3);
    expect(names).toContain(real);
    const intros = [0x9c, 0xa0, 0xa2].map((y) => raw(rom, y));
    for (const name of names) expect(intros).toContain(wrap(`I AM ${name}.\nARE YOU WITH THE FEDERATION?`));
    expect(text(rom, 0xa2), 'script 4 is the real one').toContain(real);
    expect(text(rom, 0xa6).replace(/ /g, '')).toMatch(
      new RegExp(`^GOOD\\.THE${item.replace(/[a-z]/g, (c) => c.toUpperCase()).replace(/ /g, '')}(IS|ARE)INMYROOM`),
    );
    // Joe vouches for him unless the route took his item first (hints.ts); either way he names Area 12's comm
    const joe = spoiler.hints.find((h) => h.kind === 'joeRescue')!.lines[0].text.replace(/\n/g, ' ');
    expect(text(rom, 0x5a).replace(/ /g, '')).toBe(joe.replace(/ /g, ''));
    expect(joe).toMatch(
      new RegExp(
        `^(ONLY ${real} IN AREA 18 IS ONE OF US\\. THE OTHER TWO ARE IMPOSTORS\\.|THANKS FOR GETTING ME OUT\\.) OUR AGENTS IN AREA 12 USE THE [αβγδ] COMMUNICATOR\\.$`,
      ),
    );
    // the man standing where the spoiler says runs the real script
    expect(men.map((m) => m.position)).toEqual(['right of door B', 'by door A', 'left of door B']);
    expect(rom[0x3f894 + names.indexOf(real)]).toBe(4);
  });

  it('YES to an impostor raises the alert (hostile zone), spoils the pickup and hits Ladd (3 pips)', () => {
    const { rom } = generate(loadRom(), seedCode(1));
    for (const script of [6, 7]) {
      const emu = new Emu(rom);
      expect(emu.bootToFirstArea()).toBe(true);
      emu.run(60);
      enter(emu, 18, 0x11); // NZ18
      emu.poke(0x779, 5);
      emu.poke(0x7e0, 0);
      emu.poke(0x80, 0);
      emu.poke(0x88, script); // YES, to this impostor
      emu.poke(0x4c4, 0);
      emu.poke(0x4c5, 0);
      emu.callSub(0x0d, 0xa3b6);
      expect([emu.peek(0x4c4), emu.peek(0x4c5)]).toEqual([2, 2]);
      expect(emu.peek(0x779), `script ${script}: 3 pips lost`).toBe(2);
      expect(emu.peek(0x7e0), 'invincibility flash').toBe(0x7e);
      expect(emu.peek(0x65a), 'hit state').toBe(0x0a);
      // knocked away from the man who lied (his slot holds that script)
      const slot = 0x0b + [0, 1, 2].find((i) => rom[0x3f894 + i] === script)!;
      expect(emu.peek(0x620), 'pushed away from him').toBe(emu.peek(0x56f) < emu.peek(0x56f + slot) ? 1 : 0);
    }
    // on 1 pip the hit leaves -2 ($FE): an ordinary death, a life lost, back with health (callSub leaves bank 0D mapped,
    // so the game is resumed from the state the hit leaves instead)
    const probe = new Emu(rom);
    expect(probe.bootToFirstArea()).toBe(true);
    probe.run(60);
    enter(probe, 18, 0x11);
    probe.poke(0x779, 1);
    probe.poke(0x80, 0);
    probe.poke(0x88, 6);
    probe.callSub(0x0d, 0xa3b6);
    expect(probe.peek(0x779)).toBe(0xfe);
    const emu = new Emu(rom);
    expect(emu.bootToFirstArea()).toBe(true);
    emu.run(60);
    enter(emu, 18, 0x11);
    const lives = emu.peek(0x4a);
    emu.poke(0x779, 0xfe);
    emu.poke(0x536, emu.peek(0x536) | 0x81);
    emu.poke(0x65a, 0x0a); // (as the hit leaves it)
    for (let f = 0; f < 1500 && emu.peek(0x4a) === lives; f++) emu.run(1);
    expect(emu.peek(0x4a), 'a life lost').toBe(lives - 1);
    emu.run(600);
    expect(emu.peek(0x779), 'alive again ($0779 = pips - 1)').toBeLessThan(0x80);
  }, 90_000);

  it('the pickup appears only after YES to the real one, and gives his item (both rooms)', () => {
    for (const want of ['rocket', 'flak'] as Item[]) {
      const { gen } = seedWith(want);
      for (const room of [0x41, 0x42]) {
        for (const yes of [0, 1, 2]) {
          const emu = new Emu(gen.rom);
          expect(emu.bootToFirstArea()).toBe(true);
          emu.run(60);
          const flag = want === 'flak' ? 0x1d3 : 0x4ca + ITEMS[want].inventory;
          emu.poke(flag, 0);
          emu.poke(0x4c5, yes);
          const slot = emu.enterRoom(room, 18);
          expect(slot).toBeGreaterThanOrEqual(0);
          const active = emu.peek(0x536 + slot) === 1;
          expect(active, `${want} room $${room.toString(16)}, $04C5=${yes}: spawned`).toBe(yes === 1);
          if (!active) continue;
          emu.touch(slot);
          expect(emu.peek(flag), `${want} given`).toBe(1);
          expect(emu.peek(0x4c5)).toBe(0xff);
          expect(emu.peek(0x4ce), 'not the Machine Gun').toBe(0);
        }
      }
    }
  }, 240_000);
});
