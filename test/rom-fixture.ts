// The real ROM is never committed. Tests that need it read BC_ROM (default: the No-Intro dump in ../source-roms/, as
// the .nes or its .zip) and skip if absent.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { unzipRom } from '../src/core/zip.ts';

const DUMP = resolve(import.meta.dirname, '../../source-roms/Bionic Commando (USA)');
export const ROM_PATH =
  process.env.BC_ROM ?? [`${DUMP}.nes`, `${DUMP}.zip`].find((p) => existsSync(p)) ?? `${DUMP}.nes`;
export const HAVE_ROM = existsSync(ROM_PATH);
const bytes = HAVE_ROM ? (await unzipRom(new Uint8Array(readFileSync(ROM_PATH)))).data : new Uint8Array();
export const loadRom = () => bytes.slice();
