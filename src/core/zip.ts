// Minimal ZIP reading/writing (stored + deflate) using the platform's DecompressionStream/CompressionStream, which
// exist in browsers and Node. Enough to accept No-Intro's zipped ROMs and to hand back a zipped patched ROM.

import { crc32 } from './rom.ts';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export function isZip(data: Uint8Array): boolean {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

async function transform(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([data.slice()]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** All file entries of a ZIP archive (stored or deflated; CRCs verified). */
export async function readZip(zip: Uint8Array): Promise<ZipEntry[]> {
  // End of central directory: scan back over the (up to 64 KiB) comment.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 0xffff); i--) {
    if (u32(zip, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP file.');
  const count = u16(zip, eocd + 10);
  let p = u32(zip, eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (u32(zip, p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory.');
    const method = u16(zip, p + 10),
      crc = u32(zip, p + 16),
      csize = u32(zip, p + 20),
      size = u32(zip, p + 24);
    const nameLen = u16(zip, p + 28),
      extraLen = u16(zip, p + 30),
      commentLen = u16(zip, p + 32);
    const local = u32(zip, p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const start = local + 30 + u16(zip, local + 26) + u16(zip, local + 28);
    const raw = zip.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await transform(raw, new DecompressionStream('deflate-raw'));
    else throw new Error(`ZIP entry "${name}" uses unsupported compression (method ${method}).`);
    if (data.length !== size || crc32(data) !== crc) throw new Error(`ZIP entry "${name}" is corrupt (CRC mismatch).`);
    entries.push({ name, data });
  }
  return entries;
}

/** If `file` is a ZIP, return the NES ROM inside it (the one .nes/.unh/.bin entry, or the only entry). */
export async function unzipRom(file: Uint8Array): Promise<{ data: Uint8Array; name?: string }> {
  if (!isZip(file)) return { data: file };
  const entries = await readZip(file);
  const roms = entries.filter((e) => /\.(nes|unh|bin)$/i.test(e.name));
  const pick = roms.length === 1 ? roms[0] : entries.length === 1 ? entries[0] : undefined;
  if (!pick) throw new Error(`The ZIP holds ${entries.length} files; expected exactly one NES ROM.`);
  return { data: pick.data, name: pick.name };
}

/**
 * Build a ZIP (deflated entries). Timestamps are fixed at 1980-01-01 00:00 so the same inputs always produce the
 * same bytes (keeps seeds reproducible down to the download).
 */
export async function makeZip(entries: ZipEntry[], { store = false } = {}): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    const body = store ? e.data : await transform(e.data, new CompressionStream('deflate-raw'));
    const method = store ? 0 : 8;
    const crc = crc32(e.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of all) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
