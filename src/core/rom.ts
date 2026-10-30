// ROM identification and normalization. Only the No-Intro "Bionic Commando (USA)" dump is supported for now.

// No-Intro's NES 2.0 header for this game: mapper 1 (MMC1), 16x16K PRG, 8K CHR-RAM, horizontal mirroring.
const INES_HEADER = Uint8Array.of(
  0x4e,
  0x45,
  0x53,
  0x1a,
  0x10,
  0x00,
  0x10,
  0x08,
  0x00,
  0x00,
  0x00,
  0x07,
  0x00,
  0x00,
  0x00,
  0x01,
);
const PRG_SIZE = 16 * 0x4000;
const EXPECTED_PRG_CRC32 = 0xd2574720;

export const HEADER_SIZE = 16;

/**
 * Known Bionic Commando dumps by CRC32 of the 256 KiB PRG (no header). See docs/rom-notes.md.
 * Only `supported` dumps can be patched; the rest get a specific message instead of "unrecognized".
 */
export const KNOWN_DUMPS: { crc: number; name: string; supported: boolean }[] = [
  { crc: 0xd2574720, name: 'Bionic Commando (USA), No-Intro dump', supported: true },
  {
    crc: 0xbe4c6e42,
    name: 'the old GoodNES "Bionic Commando (U) [!]" dump (4 graphics bits differ from the cart)',
    supported: false,
  },
  { crc: 0xfa7ee642, name: 'Bionic Commando (Europe)', supported: false },
  { crc: 0x16a0a3a3, name: 'Hitler no Fukkatsu - Top Secret (Japan)', supported: false },
  { crc: 0xeb894034, name: 'Bionic Commando (prototype)', supported: false },
];

export function identifyPrg(crc: number) {
  return KNOWN_DUMPS.find((d) => d.crc === crc);
}

export const ROM_SIZE = HEADER_SIZE + PRG_SIZE;

let crcTable: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export type RomCheck = { ok: true; rom: Uint8Array; note?: string } | { ok: false; error: string };

/**
 * Verify a user-supplied file and return a normalized copy (canonical iNES header + PRG).
 * Accepts headered dumps (any header contents) and headerless PRG-only dumps.
 */
export function verifyRom(file: Uint8Array): RomCheck {
  let prg: Uint8Array;
  let note: string | undefined;
  if (file.length === ROM_SIZE && file[0] === 0x4e && file[1] === 0x45 && file[2] === 0x53 && file[3] === 0x1a) {
    prg = file.subarray(HEADER_SIZE);
    if (file.subarray(0, HEADER_SIZE).some((b, i) => b !== INES_HEADER[i])) note = 'iNES header normalized';
  } else if (file.length === PRG_SIZE) {
    prg = file;
    note = 'headerless dump; iNES header added';
  } else {
    return { ok: false, error: `Unexpected file size ${file.length} bytes (expected ${ROM_SIZE}).` };
  }
  const crc = crc32(prg);
  if (crc !== EXPECTED_PRG_CRC32) {
    const known = identifyPrg(crc);
    const crcText = crc.toString(16).toUpperCase().padStart(8, '0');
    return {
      ok: false,
      error: known
        ? `This is ${known.name} (PRG CRC32 ${crcText}), which isn't supported yet. ` +
          'The randomizer needs the No-Intro "Bionic Commando (USA)" dump (PRG CRC32 D2574720).'
        : `Unrecognized ROM (PRG CRC32 ${crcText}). ` +
          'The randomizer needs the No-Intro "Bionic Commando (USA)" dump (PRG CRC32 D2574720).',
    };
  }
  const rom = new Uint8Array(ROM_SIZE);
  rom.set(INES_HEADER, 0);
  rom.set(prg, HEADER_SIZE);
  return { ok: true, rom, note };
}

/** File offset of a CPU address in a PRG bank (bank 0x0F is fixed at $C000, others at $8000). */
export function fileOffset(bank: number, cpu: number): number {
  const base = bank === 0x0f ? 0xc000 : 0x8000;
  return HEADER_SIZE + bank * 0x4000 + (cpu - base);
}
