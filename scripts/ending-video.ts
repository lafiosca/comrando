// Record a seed's final scene (Area 12, room $63: Killt, Master-D's capsule) to a video, without playing there:
//   node scripts/ending-video.ts --rom ROM [--seed CODE | --ending N] [--out ending.mp4] [--rom-out seed.nes]
// --ending N picks fresh seeds until one gets ENDINGS[N] (bosses.ts). Needs ffmpeg on the PATH. jsnes boots the
// generated ROM, flies to Area 12 with Joe rescued, jumps into room $63 and walks right until Killt's talk script
// starts, pressing A two seconds after each line finishes, and keeps recording through Master-D's script; then, in
// Hal's room ($60), it takes Hal's line, marks the chopper's cockpit hit and records the cockpit scene (script 5).
// Sound is jsnes's APU at 48 kHz, muxed in afterwards; video runs at the NES's 60.0988 frames per second.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { NES } from 'jsnes';
import { ENDINGS } from '../src/core/bosses.ts';
import { generate } from '../src/core/generate.ts';
import { newSeedCode } from '../src/core/settings.ts';
import { unzipRom } from '../src/core/zip.ts';

const { values } = parseArgs({
  options: {
    rom: { type: 'string' },
    seed: { type: 'string' },
    ending: { type: 'string' },
    out: { type: 'string' },
    'rom-out': { type: 'string' },
  },
});
if (!values.rom) {
  console.error(
    `usage: node scripts/ending-video.ts --rom ROM [--seed CODE | --ending N] [--out FILE.mp4] [--rom-out FILE.nes]\nendings: ${ENDINGS.map((e, i) => `${i} ${e.name}`).join(', ')}`,
  );
  process.exit(2);
}
const base = (await unzipRom(new Uint8Array(readFileSync(values.rom)))).data;
let gen = generate(base, values.seed ?? newSeedCode());
if (values.ending !== undefined && !values.seed) {
  const want = ENDINGS[Number(values.ending)].killt[0][1].replaceAll('\f', '\n'); // (as the spoiler shows it)
  for (let i = 0; !gen.spoiler.dialogue?.scenes.ending?.some((l) => l.text === want); i++) {
    if (i > 200) throw new Error('no seed with that ending');
    gen = generate(base, newSeedCode());
  }
}
const { rom, spoiler } = gen;
console.log(
  `seed ${spoiler.seedCode}\n\n${spoiler.dialogue?.scenes.ending?.map((l) => `${l.speaker?.toUpperCase()}: ${l.text}`).join('\n\n')}\n`,
);
if (values['rom-out']) writeFileSync(values['rom-out'], rom);

const fb = new Uint32Array(256 * 240);
const RATE = 48000,
  FPS = 39375000 / 655171; // (NTSC NES frame rate)
const audio: number[] = [];
let recording = false;
const nes = new NES({
  onFrame: (buf) => fb.set(buf),
  onAudioSample: (l, r) => {
    if (recording) audio.push(l, r);
  },
  emulateSound: true,
  sampleRate: RATE,
});
nes.loadROM(Array.from(rom, (b) => String.fromCharCode(b)).join(''));
const mem = (nes as unknown as { cpu: { mem: number[] } }).cpu.mem;
const peek = (a: number) => mem[a],
  poke = (a: number, v: number) => {
    mem[a] = v;
  };
const BTN = { A: 0, START: 3, RIGHT: 7 } as const;
type Btn = (typeof BTN)[keyof typeof BTN];

const out = values.out ?? `ending-${spoiler.seedCode}.mp4`;
let ffmpeg: ReturnType<typeof spawn> | undefined;
const rgb = Buffer.alloc(256 * 240 * 3);
const run = async (n = 1) => {
  for (let i = 0; i < n; i++) {
    nes.frame();
    if (!ffmpeg) continue;
    for (let p = 0; p < fb.length; p++) {
      rgb[3 * p] = fb[p] & 0xff;
      rgb[3 * p + 1] = (fb[p] >> 8) & 0xff;
      rgb[3 * p + 2] = fb[p] >> 16;
    }
    if (!ffmpeg.stdin!.write(Buffer.from(rgb))) await new Promise((ok) => ffmpeg!.stdin!.once('drain', ok));
  }
};
const press = async (b: Btn, hold = 3, after = 27) => {
  nes.buttonDown(1, b);
  await run(hold);
  nes.buttonUp(1, b);
  await run(after);
};

// Title, intro, map: fly to Area 1, then descend into Area 12 with Joe rescued ($04F6).
for (let i = 0; i < 200 && !(peek(0xcb) === 1 && peek(0xcc) === 1); i++) await press(i % 2 ? BTN.A : BTN.START);
await run(400);
await press(BTN.A, 4, 4);
await run(300);
poke(0x4d, 12);
poke(0x4f6, 1);
for (let i = 0; i < 6; i++) await press(BTN.A, 4, 40);
if (peek(0x4c) !== 0x0b) throw new Error('did not reach Area 12');
await run(400);
// Into room $63 as if through a door (test/emu.ts enterRoom), power systems down.
poke(0x4c, 0x63);
poke(0x4be, 0);
poke(0x536, 0x81);
poke(0x65a, 0x11);
poke(0x66d, 0);
poke(0x4bf, 1);
poke(0x4c0, 1);

const tmp = mkdtempSync(join(tmpdir(), 'ending-video-'));
ffmpeg = spawn(
  'ffmpeg',
  [
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'rgb24',
    '-s',
    '256x240',
    '-r',
    String(FPS),
    '-i',
    '-',
    '-vf',
    'scale=768:720:flags=neighbor',
    '-pix_fmt',
    'yuv420p',
    '-c:v',
    'libx264',
    '-crf',
    '18',
    join(tmp, 'video.mp4'),
  ],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
recording = true;
await run(60);
nes.buttonDown(1, BTN.RIGHT);
for (let f = 0; f < 600 && peek(0x88) !== 8; f++) await run(1);
nes.buttonUp(1, BTN.RIGHT);
if (peek(0x88) !== 8) throw new Error("Killt's script did not start");
// Talk: $74 bit 7 = a finished line waits for A, pressed two seconds after the line is done.
let wait = 0;
const talk = async () => {
  if (peek(0x74) & 0x80) {
    if (++wait === 120) {
      await press(BTN.A, 2, 0);
      wait = 0;
    }
  } else wait = 0;
};
let over = -1;
for (let f = 0; f < 20000 && (over < 0 || f - over < 240); f++) {
  await run(1);
  await talk();
  if (over < 0 && peek(0x88) === 9 && peek(0xcc) !== 4) over = f;
}
// After the Albatros (room $65, skipped), Hal and the chopper are in room $60: Hal's line, then rather than
// jump and shoot the cockpit (object type $44, handler 0E:$B212), mark it hit (state 1): 256 frames later it starts the
// cockpit scene (talk script 5) as after a real hit. Stop once the scene is over and a few more seconds passed.
poke(0x4c, 0x60);
poke(0x4be, 0);
poke(0x536, 0x81);
poke(0x65a, 0x11);
poke(0x66d, 0);
await run(200);
// (Hal, object type $62, is out of a straight walk: he comes to Ladd)
const hal = Array.from({ length: 16 }, (_, i) => i + 3).find((s) => peek(0x536 + s) && peek(0x549 + s) === 0x62);
if (hal === undefined) throw new Error('no Hal in room $60');
for (let f = 0; f < 600 && peek(0x8f) !== 0xcc; f++) {
  for (const a of [0x55c, 0x56f, 0x5a9]) poke(a + hal, peek(a));
  await run(1);
}
for (let f = 0; f < 3000 && peek(0xcc) === 4; f++) {
  await run(1);
  await talk();
}
await run(60);
const cockpit = Array.from({ length: 16 }, (_, i) => i + 3).find((s) => peek(0x536 + s) && peek(0x549 + s) === 0x44);
if (cockpit === undefined) throw new Error('no cockpit in room $60');
poke(0x647 + cockpit, 1);
over = -1;
for (let f = 0; f < 20000 && (over < 0 || f - over < 600); f++) {
  await run(1);
  await talk();
  if (over < 0 && peek(0x88) === 5 && peek(0xcc) !== 4) over = f;
}
ffmpeg.stdin!.end();
await new Promise((ok) => ffmpeg!.on('close', ok));
writeFileSync(join(tmp, 'audio.f32'), new Float32Array(audio));
const mux = spawn(
  'ffmpeg',
  [
    '-loglevel',
    'error',
    '-y',
    '-i',
    join(tmp, 'video.mp4'),
    '-f',
    'f32le',
    '-ar',
    String(RATE),
    '-ac',
    '2',
    '-i',
    join(tmp, 'audio.f32'),
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-shortest',
    out,
  ],
  { stdio: 'inherit' },
);
await new Promise((ok) => mux.on('close', ok));
rmSync(tmp, { recursive: true });
console.log(`wrote ${out}`);
