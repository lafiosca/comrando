import { describe, expect, it } from 'vitest';
import { cellAt, chunkAt, metaEntry, roomMap } from '../src/core/doorpanels.ts';
import { generate } from '../src/core/generate.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

const off = (bank: number, cpu: number) => 0x10 + bank * 0x4000 + cpu - 0x8000;
/** The map bytes under every doorway (door objects $2A-$2E: their 2 × 2 blocks, top left at x − $10, y − $10 − $20·(y div
 * 256)), any room's: the panels and the boss rooms' shutter rewrite those (their chunks are shared). */
function doorways(rom: Uint8Array) {
  const out = new Set<number>();
  for (let r = 0; r < 0x70; r++) {
    const m = roomMap(rom, r);
    if (!m) continue;
    for (let at = off(3, rom[off(3, 0xad6b + 2 * r)] | (rom[off(3, 0xad6c + 2 * r)] << 8)); rom[at] !== 0xff; at += 5) {
      if (rom[at] < 0x2a || rom[at] > 0x2e) continue;
      const x = rom[at + 1] | (rom[at + 2] << 8),
        y = rom[at + 3] | (rom[at + 4] << 8);
      const bx = x - 0x10,
        by = y - 0x10 - 0x20 * (y >> 8);
      for (const [cx, cy] of [
        [0, 0],
        [0, 1],
        [1, 0],
        [1, 1],
      ])
        out.add(cellAt(rom, m, bx + 16 * cx, by + 16 * cy).byte);
    }
  }
  return out;
}

describe.skipIf(!HAVE_ROM)('level maps', () => {
  // (playtest: a panel's metatile copy took O3's ceiling's slot, read from a chunk's eighth row, and the
  // ceiling lost its grip; panels in tile groups objects draw into, Area 6's spikes)
  it('with every lock on, every placed metatile (all 8 × 8 of each chunk), its collision and its tiles are as vanilla but the doorways', () => {
    const vanilla = loadRom();
    const rom = generate(loadRom(), makeSeedCode({ areas: 'vanilla', commLocks: 'all', area12Comm: 'both' }, 1n)).rom;
    const bad: string[] = [],
      doors = doorways(vanilla);
    for (let r = 0; r < 0x70; r++) {
      const v = roomMap(vanilla, r),
        m = roomMap(rom, r);
      if (!v || !m) continue;
      const groups = new Set<number>();
      for (let i = 0; i < v.w * v.h; i++) {
        const cv = chunkAt(vanilla, v, vanilla[off(2, v.grid + i)]),
          cm = chunkAt(rom, m, rom[off(2, m.grid + i)]);
        for (let k = 0; k < 0x40; k++) {
          const ev = [
            ...vanilla.subarray(
              metaEntry(v, vanilla[off(cv.bank, cv.at + k)]),
              metaEntry(v, vanilla[off(cv.bank, cv.at + k)]) + 7,
            ),
          ];
          const em = [
            ...rom.subarray(metaEntry(m, rom[off(cm.bank, cm.at + k)]), metaEntry(m, rom[off(cm.bank, cm.at + k)]) + 7),
          ];
          const door = doors.has(off(cv.bank, cv.at + k));
          if (door) {
            if (em.slice(4).join() !== ev.slice(4).join())
              bad.push(`room $${r.toString(16)} chunk ${i} cell ${k}: a doorway's collision`);
            continue;
          }
          if (em.join() !== ev.join())
            bad.push(`room $${r.toString(16)} chunk ${i} cell ${k}: ${ev.join(' ')} -> ${em.join(' ')}`);
          ev.slice(0, 4).forEach((b) => groups.add(b >> 2));
        }
      }
      // the tile groups those metatiles draw from load the same CHR
      for (const g of groups) {
        const nib = (rom_: Uint8Array, list: number) => (rom_[off(1, list) + 0x40 + (g >> 1)] >> (g & 1 ? 0 : 4)) & 0xf;
        if (rom[off(1, m.chr) + g] !== vanilla[off(1, v.chr) + g] || nib(rom, m.chr) !== nib(vanilla, v.chr))
          bad.push(`room $${r.toString(16)}: group $${g.toString(16)}'s CHR`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});
