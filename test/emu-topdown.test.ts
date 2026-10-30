import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { Emu, seedCode } from './emu.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

// The top-down stages in the emulator: drops and the eagle pickup.

describe.skipIf(!HAVE_ROM)('gameplay patches in the emulator: the top-down stages', () => {
  it('truck-stage drops: overhead enemies drop bullets (1 in 3) that raise the bullet counter; vanilla drops none', () => {
    const run = (topDownDrops: 'on' | 'off', room: number, trucks: 'on' | 'off' = 'on') => {
      const e = new Emu(generate(loadRom(), seedCode(1, { topDownDrops, trucks })).rom);
      expect(e.bootToMapAtArea1()).toBe(true);
      for (let i = 0; i < 80; i++) {
        // descend, and swap the level for the stage on the equipment screen
        if (e.peek(0xcc) === 2) {
          e.poke(0x4d, 1);
          e.poke(0x4c, room);
        }
        e.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
        if (e.peek(0xcc) === 3 && e.peek(0xcd) >= 2) break;
      }
      expect(e.peek(0x4c)).toBe(room);
      const counter = () => Number(e.ram(0x4e7, 3).join(''));
      const start = counter(),
        continues = e.ram(0x4f9, 2);
      let drops = 0,
        collected = 0;
      const SLOTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      for (let f = 0; f < 3000 && e.peek(0xcc) === 3; f++) {
        // shoot up, walk to enemies, pick up drops
        e.poke(0x779, 8);
        const t = e.ram(0x549, 19),
          act = e.ram(0x536, 19);
        const drop = SLOTS.find((i) => act[i] && t[i] === 0x0d && e.peek(0x647 + i) === 1);
        const enemy = SLOTS.find((i) => act[i] && [0, 1, 2, 4, 6, 11].includes(t[i]) && e.peek(0x5a9 + i) < 0xb0);
        if (drop !== undefined && f % 4 === 0) {
          e.poke(0x56f, e.peek(0x56f + drop));
          e.poke(0x5a9, e.peek(0x5a9 + drop));
        } else if (drop === undefined && enemy !== undefined && f % 30 === 0) {
          e.poke(0x56f, e.peek(0x56f + enemy));
          e.poke(0x5a9, Math.min(0xd0, e.peek(0x5a9 + enemy) + 40));
        }
        e.nes.buttonDown(1, 4); // (UP)
        if (f % 8 < 4) e.nes.buttonDown(1, 1);
        else e.nes.buttonUp(1, 1);
        const before = counter();
        e.run(1);
        e.ram(0x549, 19).forEach((v, i) => {
          if (i >= 5 && v === 0x0d && t[i] !== 0x0d && e.peek(0x65a + i) === 1) drops++;
        });
        if (counter() > before) collected++;
      }
      e.nes.buttonUp(1, 4);
      e.nes.buttonUp(1, 1);
      expect(e.ram(0x4f9, 2), 'no continues from these enemies').toEqual(continues);
      return { drops, collected, gained: counter() - start };
    };
    for (const room of [0x13, 0x15]) {
      // a convoy stage, the underground passage
      const on = run('on', room);
      expect(on.drops, `room $${room.toString(16)}: bullets dropped`).toBeGreaterThanOrEqual(1);
      expect(on.gained, 'each one picked up counts').toBe(on.collected);
      expect(on.collected).toBeGreaterThanOrEqual(1);
      expect(run('off', room)).toEqual({ drops: 0, collected: 0, gained: 0 });
    }
    // (with Truck Encounters Off the passage still drops)
    expect(run('on', 0x15, 'off').collected).toBeGreaterThanOrEqual(1);
  }, 180_000);

  it("truck-stage drops: the bullet is sprite tile $FC over a blank $FD; every other sprite tile is as vanilla (Ladd's death, the jeep explosion)", () => {
    const chr = (topDownDrops: 'on' | 'off', room: number) => {
      const e = new Emu(generate(loadRom(), seedCode(1, { topDownDrops, trucks: 'on' })).rom);
      expect(e.bootToMapAtArea1()).toBe(true);
      for (let i = 0; i < 80; i++) {
        if (e.peek(0xcc) === 2) {
          e.poke(0x4d, 1);
          e.poke(0x4c, room);
        }
        e.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
        if (e.peek(0xcc) === 3 && e.peek(0xcd) >= 2) break;
      }
      e.run(60);
      return Array.from({ length: 0x1000 }, (_, i) => e.vram(i));
    };
    for (const room of [0x13, 0x14, 0x15]) {
      const on = chr('on', room),
        off = chr('off', room);
      expect(on.slice(0xfc0, 0xfd0), `room $${room.toString(16)}: the bullet`).toEqual([
        ...loadRom().subarray(0x200a0, 0x200b0),
      ]);
      expect(on.slice(0xfd0, 0xfe0), 'blank below it').toEqual(new Array(16).fill(0));
      const rest = (t: number[]) => t.filter((_, i) => i < 0xf20 || (i >= 0xf60 && i < 0xfc0) || i >= 0xfe0); // ($F2-$F5: the passage item's icon, per seed)
      expect(rest(on), 'the other sprite tiles as vanilla').toEqual(rest(off));
    }
  }, 60_000);

  it('truck-stage drops: the bionic arm picks them up from a distance, as it sweeps enemies away', () => {
    const tryArm = (useArm: boolean) => {
      const e = new Emu(generate(loadRom(), seedCode(1, { topDownDrops: 'on', trucks: 'on' })).rom);
      expect(e.bootToMapAtArea1()).toBe(true);
      for (let i = 0; i < 80; i++) {
        if (e.peek(0xcc) === 2) {
          e.poke(0x4d, 1);
          e.poke(0x4c, 0x13);
        }
        e.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
        if (e.peek(0xcc) === 3 && e.peek(0xcd) >= 2) break;
      }
      const counter = () => Number(e.ram(0x4e7, 3).join(''));
      const SLOTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
      let tries = 0,
        grabs = 0;
      for (let f = 0; f < 5000 && tries < 3; f++) {
        e.poke(0x779, 8);
        const t = e.ram(0x549, 19),
          act = e.ram(0x536, 19);
        e.nes.buttonUp(1, 0);
        e.nes.buttonUp(1, 1);
        e.nes.buttonUp(1, 4);
        const drop = SLOTS.find((i) => act[i] && t[i] === 0x0d && e.peek(0x65a + i) === 1);
        if (drop !== undefined) {
          // stand 30 px to its right: out of Ladd's own reach
          const dx = e.peek(0x56f + drop),
            dy = e.peek(0x5a9 + drop);
          for (let k = 0; k < 4; k++) {
            e.poke(0x56f, Math.min(0xe0, dx + 30));
            e.poke(0x5a9, Math.min(0xd8, dy + 16));
            e.run(1);
          }
          const before = counter();
          if (useArm) e.nes.buttonDown(1, 0); // (A)
          for (let k = 0; k < 40 && counter() === before; k++) e.run(1);
          if (counter() > before) grabs++;
          e.poke(0x536 + drop, 0);
          tries++;
          continue;
        }
        const enemy = SLOTS.find((i) => act[i] && [0, 1, 2, 4, 6, 11].includes(t[i]) && e.peek(0x5a9 + i) < 0xb0);
        if (enemy !== undefined && f % 30 === 0) {
          e.poke(0x56f, e.peek(0x56f + enemy));
          e.poke(0x5a9, Math.min(0xd0, e.peek(0x5a9 + enemy) + 40));
        }
        e.nes.buttonDown(1, 4);
        if (f % 8 < 4) e.nes.buttonDown(1, 1);
        e.run(1);
      }
      expect(tries).toBe(3);
      return grabs;
    };
    expect(tryArm(true), 'the arm grabs').toBe(3);
    expect(tryArm(false), 'Ladd alone is too far').toBe(0);
  }, 120_000);

  it('Top-Down Eagles Nothing: overhead type 8 (its own death, 0D:$9753) leaves no eagle either; vanilla turns it into one', () => {
    const die = (settings: Record<string, string>) => {
      const e = new Emu(generate(loadRom(), seedCode(1, settings)).rom);
      expect(e.bootToMapAtArea1()).toBe(true);
      for (let i = 0; i < 80; i++) {
        if (e.peek(0xcc) === 2) {
          e.poke(0x4d, 1);
          e.poke(0x4c, 0x13);
        }
        e.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
        if (e.peek(0xcc) === 3 && e.peek(0xcd) >= 2) break;
      }
      e.run(30);
      const slot = 16; // a type 8 dying, away from Ladd
      e.poke(0x536 + slot, 1);
      e.poke(0x549 + slot, 8);
      e.poke(0x647 + slot, 2);
      e.poke(0x66d + slot, 0);
      e.poke(0x65a + slot, 0);
      e.poke(0x56f + slot, (e.peek(0x56f) + 0x60) & 0xff);
      e.poke(0x5a9 + slot, e.peek(0x5a9));
      e.run(20);
      return e.peek(0x536 + slot) ? e.peek(0x549 + slot) : 'gone';
    };
    expect(die({ eagles: 'vanilla', topDownDrops: 'off', trucks: 'on' })).toBe(0x0d);
    expect(die({ eagles: 'none', topDownDrops: 'off', trucks: 'on' })).toBe('gone');
    expect(die({ eagles: 'none', topDownDrops: 'on', trucks: 'on' })).toBe('gone');
  }, 120_000);

  it('Top-Down Eagles 1-UP: the eagle pickup (top-down +1 continue) gives a life instead', () => {
    const touchEagle = (settings: Record<string, string>) => {
      const e = new Emu(generate(loadRom(), seedCode(1, settings)).rom);
      expect(e.bootToMapAtArea1()).toBe(true);
      for (let i = 0; i < 80; i++) {
        if (e.peek(0xcc) === 2) {
          e.poke(0x4d, 1);
          e.poke(0x4c, 0x13);
        }
        e.press(i % 3 === 2 ? 'START' : 'A', 3, 27);
        if (e.peek(0xcc) === 3 && e.peek(0xcd) >= 2) break;
      }
      e.run(30);
      const lives = e.peek(0x4a),
        conts = e.peek(0x4fa);
      const slot = 16; // an eagle on Ladd
      e.poke(0x536 + slot, 1);
      e.poke(0x549 + slot, 0x0d);
      e.poke(0x647 + slot, 0);
      e.poke(0x65a + slot, 0);
      for (let f = 0; f < 20; f++) {
        e.poke(0x56f + slot, e.peek(0x56f));
        e.poke(0x5a9 + slot, e.peek(0x5a9));
        e.poke(0x779, 8);
        e.run(1);
      }
      return { lives: e.peek(0x4a) - lives, continues: e.peek(0x4fa) - conts, gone: e.peek(0x536 + slot) === 0 };
    };
    expect(touchEagle({ continues: 'unlimited', eagles: 'oneup', topDownDrops: 'on', trucks: 'on' })).toEqual({
      lives: 1,
      continues: 0,
      gone: true,
    });
    expect(touchEagle({ continues: '0', eagles: 'oneup', topDownDrops: 'off', trucks: 'on' })).toEqual({
      lives: 1,
      continues: 0,
      gone: true,
    });
    expect(touchEagle({ continues: '0', eagles: 'vanilla', topDownDrops: 'on', trucks: 'on' })).toEqual({
      lives: 0,
      continues: 1,
      gone: true,
    });
  }, 120_000);
});
