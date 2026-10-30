// Writes public/logo.png, the page's BIONIC COMRANDO logo, from a ROM's title tiles (with the R edit). Run again only
// if the logo art changes:
//   node src/make-logo.ts --rom path/to/rom.(zip|nes)

import { writeFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { deflateSync } from 'node:zlib';
import { crc32, verifyRom } from './core/rom.ts';
import { renderLogo } from './core/title.ts';
import { unzipRom } from './core/zip.ts';

const { values } = parseArgs({ options: { rom: { type: 'string' }, out: { type: 'string' } } });
if (!values.rom) {
  console.error('usage: node src/make-logo.ts --rom ROM [--out public/logo.png]');
  process.exit(2);
}
const check = verifyRom((await unzipRom(new Uint8Array(readFileSync(values.rom)))).data);
if (!check.ok) throw new Error(check.error);
const { width, height, rgba } = renderLogo(check.rom);

/** A minimal RGB PNG (the logo is opaque). */
function png(w: number, h: number, pixels: Uint8ClampedArray): Uint8Array {
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++)
      raw.set(pixels.subarray((y * w + x) * 4, (y * w + x) * 4 + 3), y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Uint8Array) => {
    const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat([...data]));
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const out = values.out ?? 'public/logo.png';
writeFileSync(out, png(width, height, rgba));
console.log(`${out}: ${width}x${height}`);
