import '@fontsource/press-start-2p/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/700.css';
import './style.css';
import { COSMETIC_CHOICES, type Cosmetics, DEFAULT_COSMETICS } from './core/cosmetics.ts';
import { ENEMY_COLORS, HAIR_COLORS, UNIFORM_COLORS } from './core/palette.ts';
import { generate, GENERATOR_VERSION } from './core/generate.ts';
import { verifyRom } from './core/rom.ts';
import { abridge, renderRoute as routeText } from './core/routetext.ts';
import type { RouteVisit } from './core/spoiler.ts';
import { openSimulator } from './ui/simulator.ts';
import { colorPicker, RANDOM_SWATCH, swatchColor } from './ui/colorpicker.ts';
import { $, copyText, download, setStatus } from './ui/dom.ts';
import { infoIcon } from './ui/infotip.ts';
import { showRoute } from './ui/routeview.ts';
import { makeZip, unzipRom } from './core/zip.ts';
import {
  BRUTE_SETTINGS,
  DEFAULT_SETTINGS,
  GAMEPLAY_SCHEMA,
  IRON_SETTINGS,
  makeSeedCode,
  newSeedCode,
  parseSeedCode,
  randomSeedValue,
  runStyle,
  type Settings,
  blockers,
  chaosSettings,
  inertOptions,
  VANILLA_CODE,
  VANILLA_SETTINGS,
} from './core/settings.ts';

const romInput = $<HTMLInputElement>('rom');
const romStatus = $('rom-status');
const seedInput = $<HTMLInputElement>('seed');
const seedStatus = $('seed-status');
const gameplayDiv = $('gameplay');
const uniformBox = $('uniform');
const hairBox = $('hair');
const enemyBox = $('enemy');
const genButton = $<HTMLButtonElement>('generate');
const genStatus = $('gen-status');
const recent = $('recent'),
  recentList = $('recent-list');
const spoilerPre = $('spoiler');
const spoilerBody = $('spoiler-body'),
  spoilerShow = $<HTMLButtonElement>('spoiler-show'),
  spoilerStatus = $('spoiler-status');
const routeList = $('route');
const simOpen = $<HTMLButtonElement>('sim-open');
// the simulator (ui/simulator.ts): the seed entered, made from the loaded ROM like the spoiler, played without the game
simOpen.addEventListener('click', () => {
  if (!rom || !loadSeedCode(seedInput.value)) return;
  try {
    const r = rom; // (generated only for a new session; the same seed's comes back as it was left)
    openSimulator(seedInput.value, r, () => generate(r, seedInput.value, { cosmetics: currentCosmetics() }).sim);
    setStatus($('sim-status'), '');
  } catch (e) {
    setStatus($('sim-status'), (e as Error).message, 'error');
  }
});
/** This browser's memory (localStorage): the last seed code shown (its options come back on a reload), and the ROMs
 * generated lately. */
const SEED_KEY = 'bc-rando:seed';
const RECENT_KEY = 'bc-rando:recent';
const RECENT_MAX = 5;
const VERSION_PAGE = /v\/[^/]+\/(index\.html)?$/;
/** The site's root path (a version's own page sits at v/<version>/ under it). */
const siteRoot = () => location.pathname.replace(VERSION_PAGE, '');
/** A version's line, major.minor. A patch release never changes what a seed code makes (only the page around it), so
 * a link or page on an older patch goes to the newest patch of its line; another line may make another game. */
const lineOf = (v: string) => v.split('.').slice(0, 2).join('.');
/** The newest released version of `v`'s line (versions.json is in release order), and where its page is. */
const newestOfLine = (versions: string[], v: string) => versions.filter((x) => lineOf(x) === lineOf(v)).at(-1);
const pageOf = (versions: string[], v: string) =>
  v === versions.at(-1) ? siteRoot() : `${siteRoot()}v/${v}/index.html`;
const releasedVersions = (): Promise<string[]> =>
  fetch(`${siteRoot()}versions.json`)
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => []);
$('logo-version').textContent = `v${GENERATOR_VERSION}`;
$('logo-version').title = `Logic version ${GENERATOR_VERSION}`;

let rom: Uint8Array | undefined;

// --- gameplay options (built from the schema; they live inside the seed code) ---
/** Display only: which group each option sits in, and short chip names (the schema's labels show underneath). */
const GROUPS: [string, string[]][] = [
  ['Shuffles', ['rewards', 'pickups', 'destroyer', 'comms', 'areas', 'zones', 'buildings']],
  [
    'Route & Goal',
    [
      'commLocks',
      'pathComm',
      'area12',
      'area12Comm',
      'gate',
      'flak',
      'darkAreas',
      'dark',
      'barrier',
      'turrets',
      'rocket',
      'depth',
    ],
  ],
  ['Dialogue', ['hints', 'story', 'd1Portrait', 'pickupText', 'typos', 'titleO']],
  [
    'Quality of Life',
    [
      'timer',
      'rapidFire',
      'machineGun',
      'markers',
      'gateDisplay',
      'mapSpeed',
      'trucks',
      'topDownDrops',
      'eagles',
      'music',
      'health',
      'continues',
      'lives',
    ],
  ],
];
/** Chips even with more than 4 values (short, ordered choices). */
const CHIPS = new Set(['depth', 'hints']);
/** Chips that start a second row (Routing Hints: Vanilla / Nonsense, then Terse / Normal / Verbose). */
const CHIP_BREAK: Record<string, number> = { hints: 2 };

/** One option's control: chips (radio inputs) for up to 4 values, a dropdown beyond that. */
interface Control {
  get(): string;
  set(v: string): void;
  mod: HTMLElement;
  row: HTMLElement;
  /** Allow a value, or block it (`why`: its tooltip). */
  allow(v: string, why?: string): void;
  /** Disable the whole option (moot). */
  disable(on: boolean): void;
}
const gameplayControls = new Map<string, Control>();
/** What the changed-option dots compare against: the last preset applied (Standard on a fresh page or a loaded code). */
let baseline: { name: string; settings: Settings } = { name: 'Standard', settings: DEFAULT_SETTINGS };
function setBaseline(name: string, settings: Settings) {
  baseline = { name, settings: { ...settings } };
  for (const [k, c] of gameplayControls) {
    c.mod.title = `Changed from the ${name} preset`;
    refreshOption(k);
  }
}
const schemaByKey = new Map(GAMEPLAY_SCHEMA.map((o) => [o.key, o]));
const grouped = new Set(GROUPS.flatMap(([, keys]) => keys));
/** An info icon after an option's label: what it needs (bold), its caption, then what each value does. */
function infoTip(o: (typeof GAMEPLAY_SCHEMA)[number]): HTMLElement {
  return infoIcon(o.label, {
    requires: o.requires,
    summary: o.caption,
    items: o.valueInfo?.map((info, i) => [o.valueLabels[i], info]),
    note: o.note,
  });
}
document.querySelector('.presets-label')!.after(
  infoIcon('presets', {
    summary: 'One-click game option presets',
    items: [
      ['Vanilla', 'No changes to the original game'],
      ['Standard', 'Recommended default game options'],
      ['Iron', 'A longer, more difficult run'],
      ['Brute', 'Grueling run without hints or continues'],
      ['Chaos', 'Every game option chosen randomly'],
    ],
  }),
);
const groups = [
  ...GROUPS,
  ['Other', GAMEPLAY_SCHEMA.map((o) => o.key).filter((k) => !grouped.has(k))] as [string, string[]],
];
for (const [title, keys] of groups) {
  const options = keys.map((k) => schemaByKey.get(k)).filter((o) => o !== undefined);
  if (!options.length) continue;
  const group = document.createElement('div');
  group.className = 'group';
  group.innerHTML = `<h3>${title}</h3><div class="group-body"></div>`;
  const body = group.lastElementChild!;
  for (const o of options) {
    const row = document.createElement('div');
    row.className = 'opt';
    const head = document.createElement('div');
    head.className = 'opt-head';
    const label = Object.assign(document.createElement('span'), { className: 'opt-label', textContent: o.label });
    const mod = Object.assign(document.createElement('span'), {
      className: 'mod',
      title: 'Changed from the Standard preset',
    });
    head.append(label);
    head.append(infoTip(o), mod);
    const changed = () => {
      refreshOption(o.key);
      optionsChanged();
      selectPreset(null);
    };
    let control: Control;
    if (o.values.length > 4 && !CHIPS.has(o.key)) {
      const wrap = Object.assign(document.createElement('div'), { className: 'select' });
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', o.label);
      o.values.forEach((v, i) => sel.add(new Option(o.valueLabels[i], v)));
      sel.addEventListener('change', changed);
      wrap.append(sel);
      row.append(head, wrap);
      const opts = [...sel.options];
      control = {
        get: () => sel.value,
        set: (v) => {
          sel.value = v;
        },
        mod,
        row,
        allow: (v, why) => {
          const x = opts.find((x) => x.value === v)!;
          x.disabled = !!why;
          x.title = why ?? '';
        },
        disable: (on) => {
          sel.disabled = on;
        },
      };
    } else {
      const seg = document.createElement('div');
      seg.className = 'seg';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', o.label);
      const inputs = o.values.map((v, i) => {
        const chip = document.createElement('label');
        chip.className = 'chip';
        chip.title = o.valueInfo?.[i] ?? o.valueLabels[i];
        const input = Object.assign(document.createElement('input'), { type: 'radio', name: `opt-${o.key}`, value: v });
        input.addEventListener('change', changed);
        chip.append(
          input,
          Object.assign(document.createElement('span'), { textContent: o.valueLabels[i] }),
          Object.assign(document.createElement('small'), { className: 'chip-tip' }),
        ); // (why it's blocked)
        if (i && i === CHIP_BREAK[o.key])
          seg.append(Object.assign(document.createElement('div'), { className: 'seg-break' }));
        seg.append(chip);
        return input;
      });
      row.append(head, seg);
      const blocked = new Set<string>();
      let off = false;
      control = {
        get: () => inputs.find((x) => x.checked)!.value,
        set: (v) =>
          inputs.forEach((x) => {
            x.checked = x.value === v;
          }),
        mod,
        row,
        allow: (v, why) => {
          const i = o.values.indexOf(v),
            chip = inputs[i].parentElement!;
          if (why) blocked.add(v);
          else blocked.delete(v);
          inputs[i].disabled = off || !!why;
          chip.classList.toggle('blocked', !!why);
          chip.title = why ? '' : (o.valueInfo?.[i] ?? o.valueLabels[i]);
          chip.querySelector('.chip-tip')!.textContent = why ?? '';
        },
        disable: (on) => {
          off = on;
          inputs.forEach((x) => {
            x.disabled = on || blocked.has(x.value);
          });
        },
      };
    }
    body.append(row);
    gameplayControls.set(o.key, control);
  }
  gameplayDiv.append(group);
}
function refreshOption(key: string) {
  const o = schemaByKey.get(key)!,
    c = gameplayControls.get(key)!;
  const i = o.values.indexOf(c.get());
  c.mod.hidden = o.values[i] === baseline.settings[key] || mootSaved.has(key); // (none on disabled options)
}
/** Show a seed code in the box, and remember it in this browser (a reload keeps its options, with a new seed). */
function setSeed(code: string) {
  if (seedInput.value !== code) hideSpoiler(); // (another seed: its spoiler stays hidden until asked for)
  seedInput.value = code;
  // (Vanilla: nothing to roll)
  const reseed = $('reseed') as HTMLButtonElement;
  reseed.disabled = code === VANILLA_CODE;
  reseed.title = reseed.disabled ? 'Vanilla has nothing random to roll' : 'Roll a new seed (keeps the options)';
  try {
    localStorage.setItem(SEED_KEY, code);
  } catch {
    // not remembered
  }
  ($('old-version-link') as HTMLAnchorElement).href = `${siteRoot()}?seed=${encodeURIComponent(code)}`;
}
/** Options the rest make moot (settings.ts `inertOptions`) show their vanilla value, disabled; the value they had comes
 * back once they matter again. */
const mootSaved = new Map<string, string>();
function applyMoot() {
  for (let pass = 0; pass < 4; pass++) {
    const inert = inertOptions(currentGameplay());
    let changed = false;
    for (const [k, c] of gameplayControls) {
      if (inert.has(k) && !mootSaved.has(k)) {
        mootSaved.set(k, c.get());
        c.set(VANILLA_SETTINGS[k]);
        changed = true;
      } else if (!inert.has(k) && mootSaved.has(k)) {
        c.set(mootSaved.get(k)!);
        mootSaved.delete(k);
        changed = true;
      }
      c.disable(inert.has(k));
      refreshOption(k);
    }
    if (!changed) break;
  }
}
function optionsChanged() {
  applyMoot();
  // keep the random part, re-encode the options (or roll a new seed if the box holds an invalid code, or Vanilla's,
  // which has no random part)
  let seed = randomSeedValue();
  try {
    if (seedInput.value.trim().toUpperCase() !== VANILLA_CODE) seed = parseSeedCode(seedInput.value).seed;
  } catch {
    // (keep the new one)
  }
  setSeed(makeSeedCode(currentGameplay(), seed));
  setStatus(seedStatus, '');
  checkConflicts();
}

// --- conflicting options (settings.ts `conflicts`: worked out in advance) ---
/** Block every value that would conflict with the rest as set, naming the options in the way; dim moot options. */
function checkConflicts() {
  const cur = currentGameplay(),
    inert = inertOptions(cur);
  for (const [k, c] of gameplayControls) {
    c.row.classList.toggle('inert', inert.has(k));
    for (const v of schemaByKey.get(k)!.values) {
      const by = v === cur[k] ? [] : blockers({ ...cur, [k]: v }, k);
      c.allow(v, by.length ? `Conflicts with ${by.map((x) => schemaByKey.get(x)!.label).join(', ')}` : undefined);
    }
  }
}
function currentGameplay(): Settings {
  return Object.fromEntries([...gameplayControls].map(([k, c]) => [k, c.get()]));
}
function showGameplay(s: Settings) {
  mootSaved.clear();
  for (const [k, c] of gameplayControls) {
    c.set(s[k]);
    refreshOption(k);
  }
  applyMoot();
  checkConflicts();
}
showGameplay(DEFAULT_SETTINGS);
/** The preset button shown as selected: the last one clicked (or matched by a loaded seed code), until an option is changed. */
const PRESETS = ['preset-vanilla', 'preset-standard', 'preset-iron', 'preset-brute', 'preset-chaos'];
const FIXED_PRESETS = [
  ['preset-vanilla', 'Vanilla', VANILLA_SETTINGS],
  ['preset-standard', 'Standard', DEFAULT_SETTINGS],
  ['preset-iron', 'Iron', IRON_SETTINGS],
  ['preset-brute', 'Brute', BRUTE_SETTINGS],
] as const;
function selectPreset(id: string | null) {
  for (const p of PRESETS) {
    $(p).classList.toggle('selected', p === id);
    $(p).setAttribute('aria-pressed', String(p === id));
  }
}
for (const [id, name, settings] of FIXED_PRESETS) {
  $(id).addEventListener('click', () => {
    // (a new seed, like Chaos)
    setBaseline(name, settings);
    showGameplay(settings);
    optionsChanged();
    setSeed(makeSeedCode(currentGameplay(), randomSeedValue()));
    selectPreset(id);
  });
}
$('preset-chaos').addEventListener('click', () => {
  if (loadSeedCode(newSeedCode(chaosSettings()))) {
    setBaseline('Chaos', currentGameplay());
    selectPreset('preset-chaos');
  }
});

// --- seed code ---
function loadSeedCode(code: string): boolean {
  try {
    const { settings, seed } = parseSeedCode(code);
    showGameplay(settings);
    setSeed(makeSeedCode(currentGameplay(), seed)); // (moot options shown vanilla)
    setStatus(seedStatus, '');
    return true;
  } catch (e) {
    setStatus(seedStatus, (e as Error).message, 'error');
    return false;
  }
}
/** After loading a code: select Vanilla, Standard, Iron or Brute when the shown options are exactly that preset (moot ones
 * aside); otherwise the dots compare against the nearest of them (fewest options changed; Standard on a tie). */
function matchPreset() {
  const changed = (preset: Settings) =>
    [...gameplayControls].filter(([k, c]) => !mootSaved.has(k) && c.get() !== preset[k]).length;
  const [id, name, settings] = [...FIXED_PRESETS]
    .map((p) => ({ p, n: changed(p[2]) - (p[2] === DEFAULT_SETTINGS ? 0.5 : 0) }))
    .reduce((a, b) => (b.n < a.n ? b : a)).p;
  setBaseline(name, settings);
  selectPreset(changed(settings) ? null : id);
}
// A seed link (?v=…&seed=…) opens on its seed; the address bar is then left plain (the page never writes the seed
// there: a reload starts afresh, below, and Copy Link makes a link). Otherwise the last options used in this browser,
// with a new seed, or Standard.
const fromUrl = new URLSearchParams(location.search).get('seed'),
  linkVersion = new URLSearchParams(location.search).get('v');
if (location.search) history.replaceState(null, '', location.pathname + location.hash);
if (fromUrl && loadSeedCode(fromUrl)) {
  matchPreset();
  // (a link from another line of versions: the same code may make a different ROM here. A released one opens its
  // line's page (openLinkVersion); this says so meanwhile, and stays if it isn't online. Another patch of this line
  // makes the same game: nothing to say)
  if (linkVersion && lineOf(linkVersion) !== lineOf(GENERATOR_VERSION)) {
    openLinkVersion(linkVersion, fromUrl);
    setStatus(
      seedStatus,
      `This link was made with v${linkVersion}. This page is v${GENERATOR_VERSION}, so this seed may make a different game.`,
      'error',
    );
  }
} else if (!rememberedOptions()) {
  setSeed(newSeedCode(currentGameplay()));
  selectPreset('preset-standard');
}
/** Load the options last used in this browser, with a new seed (Vanilla's code stays VANILLA). */
function rememberedOptions(): boolean {
  try {
    const code = localStorage.getItem(SEED_KEY);
    if (!code || !loadSeedCode(makeSeedCode(parseSeedCode(code).settings, randomSeedValue()))) return false;
    matchPreset();
    return true;
  } catch {
    return false; // (nothing remembered, or a code this version can't read)
  }
}
seedInput.addEventListener('change', () => {
  if (loadSeedCode(seedInput.value)) matchPreset();
  else selectPreset(null);
});
$('reseed').addEventListener('click', () => {
  setSeed(makeSeedCode(currentGameplay(), randomSeedValue()));
  setStatus(seedStatus, '');
});

// --- cosmetics (not saved in any code) ---
const COSMETIC_KEY = 'bc-rando:cosmetics';
let cosmetics: Cosmetics = { ...DEFAULT_COSMETICS };
try {
  cosmetics = { ...cosmetics, ...JSON.parse(localStorage.getItem(COSMETIC_KEY) ?? '{}') };
} catch {
  // ignore unreadable storage
}
for (const [box, key, colors, label] of [
  [uniformBox, 'uniformColor', UNIFORM_COLORS, 'Uniform color'],
  [hairBox, 'hairColor', HAIR_COLORS, 'Hair color'],
  [enemyBox, 'enemyColor', ENEMY_COLORS, 'Enemy uniform color'],
] as const) {
  if (!COSMETIC_CHOICES[key].includes(cosmetics[key])) cosmetics[key] = DEFAULT_COSMETICS[key];
  colorPicker(
    box,
    label,
    COSMETIC_CHOICES[key],
    (v) => (v === 'random' ? RANDOM_SWATCH : swatchColor(colors[v])),
    (v) => (v === DEFAULT_COSMETICS[key] ? `${v} (vanilla)` : v),
    cosmetics[key],
    (v) => {
      cosmetics = { ...cosmetics, [key]: v };
      hideSpoiler();
      try {
        localStorage.setItem(COSMETIC_KEY, JSON.stringify(cosmetics));
      } catch {
        /* not remembered */
      }
    },
  );
}
function currentCosmetics(): Cosmetics {
  return { ...cosmetics };
}

// --- ROM (remembered in this browser's localStorage; never uploaded anywhere) ---
const ROM_KEY = 'bc-rando:rom';
const forgetButton = $<HTMLButtonElement>('forget-rom');
const drop = $('drop');

function useRom(file: Uint8Array, source: string): boolean {
  const check = verifyRom(file);
  if (check.ok) {
    rom = check.rom;
    setStatus(romStatus, `✓ Bionic Commando (USA) ${source}${check.note ? ` (${check.note})` : ''}.`, 'ok');
  } else {
    rom = undefined;
    setStatus(romStatus, check.error, 'error');
  }
  genButton.disabled = !rom;
  spoilerShow.disabled = !rom;
  simOpen.disabled = !rom;
  forgetButton.hidden = !rom;
  drop.classList.toggle('loaded', !!rom);
  return check.ok;
}

function saveRom(data: Uint8Array) {
  try {
    let bin = '';
    for (const b of data) bin += String.fromCharCode(b);
    localStorage.setItem(ROM_KEY, btoa(bin));
  } catch {
    // storage unavailable or full: just don't remember it
  }
}

function loadSavedRom() {
  try {
    const saved = localStorage.getItem(ROM_KEY);
    if (!saved) return;
    const bin = atob(saved);
    if (
      !useRom(
        Uint8Array.from(bin, (c) => c.charCodeAt(0)),
        'loaded from this browser',
      )
    )
      localStorage.removeItem(ROM_KEY);
  } catch {
    // ignore unreadable storage
  }
}

async function readRomFile(file: File) {
  try {
    const { data, name } = await unzipRom(new Uint8Array(await file.arrayBuffer()));
    const source = `recognized${name ? ` (from ${name} in the zip)` : ''} and remembered in this browser`;
    if (useRom(data, source)) saveRom(rom!);
  } catch (e) {
    rom = undefined;
    genButton.disabled = true;
    spoilerShow.disabled = true;
    simOpen.disabled = true;
    hideSpoiler();
    setStatus(romStatus, (e as Error).message, 'error');
  }
}
romInput.addEventListener('change', () => {
  const f = romInput.files?.[0];
  if (f) readRomFile(f);
});
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) readRomFile(f);
});

forgetButton.addEventListener('click', () => {
  try {
    localStorage.removeItem(ROM_KEY);
  } catch {
    // ignore
  }
  rom = undefined;
  romInput.value = '';
  genButton.disabled = true;
  spoilerShow.disabled = true;
  simOpen.disabled = true;
  hideSpoiler();
  forgetButton.hidden = true;
  drop.classList.remove('loaded');
  setStatus(romStatus, 'ROM forgotten.');
});

loadSavedRom();

// --- generate ---

/** The last few ROMs generated in this browser, newest first: each one's seed can be loaded again or linked. */
interface RecentRom {
  seedCode: string;
  version: string;
  /** When it was generated (ms). */
  at: number;
}
function recentRoms(): RecentRom[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list)
      ? list.filter((r) => typeof r?.seedCode === 'string' && typeof r?.version === 'string')
      : [];
  } catch {
    return [];
  }
}
function rememberRom(seedCode: string) {
  const list = [
    { seedCode, version: GENERATOR_VERSION, at: Date.now() },
    ...recentRoms().filter((r) => r.seedCode !== seedCode || r.version !== GENERATOR_VERSION),
  ].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // not remembered
  }
  showRecent(list);
}
/** "Standard", "Custom", …: the run style of a code, if this version reads it. */
function styleOf(code: string) {
  try {
    const style = runStyle(parseSeedCode(code).settings);
    return style[0] + style.slice(1).toLowerCase();
  } catch {
    return '';
  }
}
function showRecent(list = recentRoms()) {
  recentList.replaceChildren(
    ...list.map((r) => {
      const li = document.createElement('li'),
        code = Object.assign(document.createElement('span'), { className: 'recent-code', textContent: r.seedCode }),
        when = new Date(r.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
        meta = Object.assign(document.createElement('span'), {
          className: 'recent-meta',
          textContent: [`v${r.version}`, styleOf(r.seedCode), when].filter(Boolean).join(' · '),
        }),
        load = Object.assign(document.createElement('button'), {
          type: 'button',
          className: 'small',
          textContent: 'Load',
          title: 'Put this seed (and its options) back in the seed box',
        }),
        copy = Object.assign(document.createElement('button'), { type: 'button', className: 'small' });
      copy.append(Object.assign(document.createElement('span'), { textContent: 'Copy Link' }));
      // (another line of versions: its own page makes this seed's game; the link takes it there)
      load.addEventListener('click', () => {
        if (lineOf(r.version) !== lineOf(GENERATOR_VERSION)) location.assign(seedLink(r.seedCode, r.version));
        else if (loadSeedCode(r.seedCode)) {
          matchPreset();
          seedInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      copyButton(copy, () => seedLink(r.seedCode, r.version));
      const text = document.createElement('div');
      text.append(code, meta);
      li.append(text, load, copy);
      return li;
    }),
  );
  recent.hidden = !list.length;
}

// --- spoiler: made for the seed entered, on request (no ROM download; it takes the ROM, as the hints are fitted to
// its text bank), hidden again whenever the seed or cosmetics change (no accidental spoilers) ---
type Spoiler = ReturnType<typeof generate>['spoiler'];
let lastSpoiler: { name: string; json: string } | undefined;
let spoilerFor: string | undefined; // the seed and cosmetics the spoiler shown was made for
const spoilerKey = () => `${seedInput.value}|${JSON.stringify(currentCosmetics())}`;
function setSpoilerShown(shown: boolean) {
  spoilerBody.hidden = !shown;
  spoilerShow.textContent = shown ? 'Hide Spoiler' : 'View Spoiler';
  spoilerShow.setAttribute('aria-expanded', String(shown));
}
function hideSpoiler() {
  setSpoilerShown(false);
}
function fillSpoiler(spoiler: Spoiler) {
  const json = JSON.stringify(spoiler, null, 2);
  lastSpoiler = { name: `BC-rando-${spoiler.seedCode}.spoiler.json`, json };
  spoilerPre.textContent = json;
  routes = { route: spoiler.route, oracle: spoiler.oracle ?? [] };
  renderRoute();
  spoilerFor = spoilerKey();
}
spoilerShow.addEventListener('click', () => {
  if (!spoilerBody.hidden) {
    setSpoilerShown(false);
    return;
  }
  if (!rom || !loadSeedCode(seedInput.value)) return;
  if (spoilerFor !== spoilerKey()) {
    try {
      fillSpoiler(generate(rom, seedInput.value, { cosmetics: currentCosmetics() }).spoiler);
      setStatus(spoilerStatus, '');
    } catch (e) {
      setStatus(spoilerStatus, (e as Error).message, 'error');
      return;
    }
  }
  setSpoilerShown(true);
});
// the route's tools: open or close every entry; hide what the win didn't need (default: everything shown)
$('route-expand').addEventListener('click', () =>
  routeList.querySelectorAll('details').forEach((d) => {
    d.open = true;
  }),
);
$('route-collapse').addEventListener('click', () =>
  routeList.querySelectorAll('details').forEach((d) => {
    d.open = false;
  }),
);
// (Full Route, as played with the hints; Abridged, without what the win didn't need; Oracle, a short
// way through knowing every placement)
const routeMode = $<HTMLSelectElement>('route-mode');
let routes: { route: RouteVisit[]; oracle: RouteVisit[] } = { route: [], oracle: [] };
function renderRoute() {
  showRoute(
    routeList,
    routeText(
      routeMode.value === 'oracle'
        ? routes.oracle
        : routeMode.value === 'abridged'
          ? abridge(routes.route)
          : routes.route,
    ),
    rom,
  );
}
routeMode.addEventListener('change', renderRoute);

$('spoiler-dl').addEventListener('click', () => {
  if (lastSpoiler) download(lastSpoiler.name, lastSpoiler.json, 'application/json');
});

genButton.addEventListener('click', async () => {
  if (!rom || !loadSeedCode(seedInput.value)) return;
  try {
    const { rom: out, spoiler } = generate(rom, seedInput.value, { cosmetics: currentCosmetics() });
    const base = `BC-rando-${spoiler.seedCode}`;
    const name = `${base}.zip`;
    const zip = await makeZip([{ name: `${base}.nes`, data: out }]);
    download(name, zip.slice().buffer, 'application/zip');
    rememberRom(spoiler.seedCode);
    fillSpoiler(spoiler);
    hideSpoiler();
    setStatus(genStatus, `Downloaded ${name}`, 'ok');
  } catch (e) {
    setStatus(genStatus, (e as Error).message, 'error');
  }
});
showRecent();
try {
  localStorage.removeItem('bc-rando:last-result'); // (the single last ROM, before the list)
} catch {
  // nothing to tidy
}
/** Every released version stays online at v/<version>/ (versions.json at the site's root lists them): a link made by
 * another line of versions opens the newest page of that line, where its seed code makes the same game it did. */
function openLinkVersion(version: string, seed: string) {
  if (VERSION_PAGE.test(location.pathname)) return; // (already a version's own page)
  releasedVersions().then((versions) => {
    const target = newestOfLine(versions, version);
    if (target && target !== GENERATOR_VERSION)
      location.replace(`${pageOf(versions, target)}?v=${encodeURIComponent(target)}&seed=${encodeURIComponent(seed)}`);
  });
}
/** A link that opens the page on this seed code, with the generator version that makes its ROM. (A declaration: the
 * remembered ROMs are shown before this point.) */
function seedLink(code: string, version = GENERATOR_VERSION) {
  // (a version's own page: links from the root, which sends them to their version)
  return `${location.origin}${siteRoot()}?v=${encodeURIComponent(version)}&seed=${encodeURIComponent(code)}`;
}
/** A copy button: copies `text()` and says so on its label for a moment. */
function copyButton(button: HTMLElement, text: () => string, from?: HTMLInputElement) {
  const label = button.querySelector('span')!,
    idle = label.textContent!;
  let timer = 0;
  button.addEventListener('click', async () => {
    label.textContent = (await copyText(text(), from)) ? 'Copied!' : 'Copy failed';
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      label.textContent = idle;
    }, 1500);
  });
}
copyButton($('copy-seed'), () => seedInput.value, seedInput);

// --- an older version's own page: a newer patch of its line takes over; an older line says so, with the latest ---
if (VERSION_PAGE.test(location.pathname)) {
  releasedVersions().then((versions) => {
    const latest = versions.at(-1),
      newest = newestOfLine(versions, GENERATOR_VERSION);
    if (newest && newest !== GENERATOR_VERSION)
      location.replace(`${pageOf(versions, newest)}?seed=${encodeURIComponent(seedInput.value)}`);
    else if (latest && lineOf(latest) !== lineOf(GENERATOR_VERSION)) {
      $('old-version-text').textContent =
        `You're looking at v${GENERATOR_VERSION}, an older version kept online so its seed links still make the same games. ` +
        `The latest is v${latest}: `;
      $('old-version').hidden = false;
    }
  });
}
