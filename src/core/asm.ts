// Minimal 6502 assembly helper for patches written in TypeScript: raw bytes, labels, branches, absolute operands.

export type Asm =
  | number
  | number[]
  | { label: string }
  | { rel: number; to: string }
  | { abs: number; to: string }
  | { word: string };

/** Minimal two-pass assembler: raw bytes, labels, relative branches and absolute operands to labels. */
export function assemble(origin: number, items: Asm[], labels: Record<string, number> = {}): number[] {
  const size = (it: Asm) =>
    typeof it === 'number'
      ? 1
      : Array.isArray(it)
        ? it.length
        : 'label' in it
          ? 0
          : 'rel' in it
            ? 2
            : 'abs' in it
              ? 3
              : 2;
  let pc = origin;
  for (const it of items) {
    if (typeof it === 'object' && !Array.isArray(it) && 'label' in it) labels[it.label] = pc;
    pc += size(it);
  }
  const out: number[] = [];
  pc = origin;
  for (const it of items) {
    if (typeof it === 'number') out.push(it);
    else if (Array.isArray(it)) out.push(...it);
    else if ('rel' in it) {
      const d = labels[it.to] - (pc + 2);
      if (d < -128 || d > 127) throw new Error(`branch to ${it.to} out of range`);
      out.push(it.rel, d & 0xff);
    } else if ('abs' in it) out.push(it.abs, labels[it.to] & 0xff, labels[it.to] >> 8);
    else if ('word' in it) out.push(labels[it.word] & 0xff, labels[it.word] >> 8);
    pc += size(it);
  }
  return out;
}
