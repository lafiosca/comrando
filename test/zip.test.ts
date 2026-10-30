import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generate } from '../src/core/generate.ts';
import { verifyRom } from '../src/core/rom.ts';
import { makeSeedCode } from '../src/core/settings.ts';
import { isZip, makeZip, readZip, unzipRom } from '../src/core/zip.ts';
import { HAVE_ROM, loadRom } from './rom-fixture.ts';

const sample = () => Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 0xff);

describe('zip', () => {
  it('round-trips deflated and stored entries', async () => {
    for (const store of [false, true]) {
      const zip = await makeZip(
        [
          { name: 'a.nes', data: sample() },
          { name: 'b.txt', data: new Uint8Array([1, 2, 3]) },
        ],
        { store },
      );
      expect(isZip(zip)).toBe(true);
      const entries = await readZip(zip);
      expect(entries.map((e) => e.name)).toEqual(['a.nes', 'b.txt']);
      expect(entries[0].data).toEqual(sample());
    }
  });

  it('is deterministic (same input, same bytes)', async () => {
    const a = await makeZip([{ name: 'x.nes', data: sample() }]);
    const b = await makeZip([{ name: 'x.nes', data: sample() }]);
    expect(a).toEqual(b);
  });

  it('unzipRom passes non-zip data through and picks the single ROM entry', async () => {
    expect((await unzipRom(sample())).data).toEqual(sample());
    const zip = await makeZip([
      { name: 'readme.txt', data: new Uint8Array(3) },
      { name: 'game.nes', data: sample() },
    ]);
    expect(await unzipRom(zip)).toEqual({ data: sample(), name: 'game.nes' });
  });

  it('rejects corrupt data', async () => {
    const zip = await makeZip([{ name: 'x.nes', data: sample() }], { store: true });
    zip[40] ^= 0xff; // flip a payload byte
    await expect(readZip(zip)).rejects.toThrow(/CRC/);
  });

  it.skipIf(!existsSync('/usr/bin/unzip'))('produces archives the system unzip accepts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bczip-'));
    const path = join(dir, 'out.zip');
    writeFileSync(path, await makeZip([{ name: 'game.nes', data: sample() }]));
    expect(execFileSync('/usr/bin/unzip', ['-t', path]).toString()).toMatch(/No errors detected/);
    expect(new Uint8Array(execFileSync('/usr/bin/unzip', ['-p', path, 'game.nes']))).toEqual(sample());
  });
});

const NOINTRO_ZIP = resolve(import.meta.dirname, '../../source-roms/Bionic Commando (USA).zip');

describe.skipIf(!existsSync(NOINTRO_ZIP))('the No-Intro zip', () => {
  it('is read and verified like the unzipped ROM', async () => {
    const { data, name } = await unzipRom(new Uint8Array(readFileSync(NOINTRO_ZIP)));
    expect(name).toBe('Bionic Commando (USA).nes');
    expect(verifyRom(data).ok).toBe(true);
  });
});

describe.skipIf(!HAVE_ROM)('zipped output', () => {
  it('contains the patched ROM, byte-identical to the unzipped output', async () => {
    const { rom } = generate(loadRom(), makeSeedCode({}, 3n), {
      cosmetics: { uniformColor: 'blue', hairColor: 'blond' },
    });
    const zip = await makeZip([{ name: 'BC-rando-A-ZIP.nes', data: rom }]);
    expect((await unzipRom(zip)).data).toEqual(rom);
  });
});
