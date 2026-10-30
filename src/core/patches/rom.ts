// Gameplay ROM patches share this check: every write first verifies the original bytes, so a patch fails loudly instead
// of corrupting an unexpected ROM. File offset = 0x10 + bank * 0x4000 + (cpu - $8000).

export function expect(rom: Uint8Array, at: number, bytes: number[], what: string) {
  if (!bytes.every((b, i) => rom[at + i] === b)) {
    const got = Array.from(rom.subarray(at, at + bytes.length), (b) => b.toString(16).padStart(2, '0')).join(' ');
    throw new Error(`patch "${what}": unexpected bytes at 0x${at.toString(16)} (${got})`);
  }
}
