// Comedic boss dialogue (option "Story Dialogue"). Vanilla bosses share six taunts (the room table 0F:$E6ED points
// several boss rooms at one message); here every boss room gets its own line, from pools for its portrait: Joe's
// captor and the boss who says Joe was moved (story.ts) take their portrait's JOE_HERE / JOE_GONE line, every other
// boss a line of POOLS, so no two bosses say the same thing. Some lines have a reply when that boss dies.
//
// The lines have no message numbers (the table of 128 is full): writeMessages packs them as extra texts, shown by
// room (roomtalk.ts). See docs/rom-notes.md#talk-and-scripts.

import type { Rng } from './rng.ts';
import { SPEAKER } from './ending.ts';
import type { Said, SpoilerDialogue } from './spoiler.ts';
import { NONSENSE } from './nonsense.ts';
import { LINE, type Message, messageForY, RADIO_PAGE, readMessage, wrap } from './text.ts';

const BOSS_TABLE = 0x3e6fd; // 0F:$E6ED + (room - $16)
/** Boss room order of the table ($16-$21) as area layouts. */
const BOSS_AREAS = [1, 2, 4, 5, 6, 7, 9, 10, 11, 3, 8, 12];
/** The vanilla generic taunts (not "JOE IS HERE" $9A, the transfer $8C, nor story.ts's captor/transfer messages). */
const GENERIC = new Set([0x22, 0x56, 0x30, 0x48, 0x70, 0xba]);
/** The vanilla Joe lines ($9A, $8C) and story.ts's copies in other portraits (#28 $34, #113 $DE). */
const JOE_Y = [0x9a, 0x8c, 0x34, 0xde];
/** The escape cyborg's taunt (#69, room $61: 0E:$B74B `LDA #$86 / JSR $D78A`), a message of its own. */
export const ESCAPE_Y = 0x86;
/** The self-destruct warning (#107, no portrait: "THIS BASE WILL EXPLOD IN 60 SECONDS…"), after Master-D. */
export const SELF_DESTRUCT_Y = 0xd2;
/** Comedic self-destruct warnings (one per seed; line and page breaks as written). */
export const SELF_DESTRUCTS = [
  'PORK CHOP\nSANDWICHES!\n\nOH S^^^!\fGET THE F^^^\nOUTTA HERE!',
  'THANK YOU FOR\nPRESSING THE\nSELF-DESTRUCT\nBUTTON.\fTHIS BASE WILL\nSELF-DESTRUCT IN\nONE MINUTE.',
  'DANGER. THE\nEMERGENCY\nDESTRUCT\nSYSTEM IS NOW\fACTIVATED. THE\nBASE WILL DET-\nONATE IN T-MINUS\n60 SECONDS.',
  'YES!! THE\nTICKING CLOCK!',
  'TIME BOMB SET\nGET OUT FAST!',
];
/** Ladd's report from the chopper (#7 "THIS IS LADD,OUR MISSION ACCOMPLISHED…", ending scene 3; the story box, no portrait). */
export const MISSION_REPORT_Y = 0x0a;
/** Comedic versions: other games' endings (one per seed, Mega Man's with LADD and THE BADDS). */
export const MISSION_REPORTS = [
  '***AND THE EVIL KING IS DEFEATED WITH HIS OWN HIDDEN SUPPLY OF VITAMINS AND ALL OF BLOBOLONIA SALUTES THEIR SAVIOR',
  "CONGRATULATIONS!\nYOU'VE DESTROYED THE VILE RED FALCON AND SAVED THE UNIVERSE.\nCONSIDER YOURSELF A HERO.",
  'BAD END\n\nTHIS IS NOT A TRUE ENDING!\fTRY AGAIN WITH YOUR FRIEND.',
  'LADD HAS ENDED THE EVIL DOMINATION OF THE BADDS AND RESTORED THE WORLD TO PEACE',
  'A WINNER IS YOU',
];
/** Joe's scrolling letter before his signature (#37 "NOW,SO MUCH TIME HAS ELAPSED…", ending scene 5; the story box). */
export const JOE_LETTER_Y = 0x46;
/** Comedic versions (one per seed; line and page breaks as written). */
export const JOE_LETTERS = [
  "THE LADD ABIDES.\n\nI DON'T KNOW\nABOUT YOU, BUT\fI TAKE COMFORT\nIN THAT. WELL,\nTHAT ABOUT DOES\nHER, WRAPS HER\fALL UP. MADE ME\nLAUGH TO BEAT\nTHE BAND. PARTS,\nANYWAY.",
  "I'VE SEEN THINGS\nYOU PEOPLE\nWOULDN'T\nBELIEVE. ATTACK\fSHIPS ON FIRE\nOFF THE SHOULDER\nOF ORION. I\nWATCHED C-BEAMS\fGLITTER IN THE\nDARK NEAR THE\nTANNHAUSER GATE.\nALL THOSE\fMOMENTS WILL BE\nLOST IN TIME,\nLIKE TEARS IN\nRAIN.",
  'YOU SEE US AS\nYOU WANT TO SEE\nUS. IN THE SIM-\nPLEST TERMS,\fTHE MOST CON-\nVENIENT DEFINI-\nTIONS. BUT WHAT\nWE FOUND OUT IS\fTHAT EACH ONE OF\nUS IS A BRAIN,\nAND AN ATHLETE,\nAND A BASKET\fCASE, A PRIN-\nCESS, AND A\nCOMMANDO.',
];
/** Joe's answer when rescued (#109 "THANK YOU. I'M SORRY TO CAUSE SO MUCH TROUBLE…", after Ladd's #108; 0D:$94E8). */
export const JOE_RESCUE_Y = 0xd6;
/** His story speech after it (#46, #110): skipped with a comedic answer, but a long answer goes on in #46 (patches.ts
 * skipRescueSpeech; his tip #47 stays). */
export const JOE_SPEECH_Y = [0x58, 0xd8] as const;
/** Comedic answers (one per seed; line, blank line and page breaks as written). */
export const JOE_RESCUES = [
  "HEY LADD, THANKS\nFOR RESCUING ME!\nLET'S GO FOR A\nBURGER****\n\nHA! HA! HA! HA!",
  'CONGRATULATIONS!\n\nYOU HAVE SAVED\nYOUR LOVELY JOE.',
  'YOU HAVE\nACCOMPLISHED THE\nMISSION. YOU ARE\nTHE VERY\fPREVAILER THAT\nPROTECT RIGHT\nAND JUSTICE. I\nWOULD EXPRESS\fMY SINCERE.\nTHANKS TO YOU.\n\nTAKE GOOD REST !',
  'THANK YOU. BUT\nOUR PRINCESS IS\nIN ANOTHER\nCASTLE!***\fJUST KIDDING! HA\nHA HA! BYE BYE.',
];
/** Ladd outside the exploding base (#124 "IS JOE STILL INSIDE?", 0D:$B710, his portrait), after the escape. */
export const STILL_INSIDE_Y = 0xf4;
/** Comedic versions of it (one per seed; line and page breaks as written). */
export const STILL_INSIDES = [
  'AH S^^^, HERE WE\nGO AGAIN.',
  'JUST WHEN I\nTHOUGHT I WAS\nOUT, THEY PULL\nME BACK IN!',
  'WE HAVE TO GO\nBACK! WE HAVE TO\nGO BAAACK!!!',
  "IF I'M NOT BACK\nIN FIVE\nMINUTES***\fJUST WAIT\nLONGER.",
  "I'M TOO OLD FOR\nTHIS S^^^.",
];

/** The radio after the escape (radio boxes, 6-row pages; 0D:$92D0: HQ's #128 "WHAT HAPPENED TO THE CAPTAIN?***", then the officer's #129). */
export const ESCAPE_RADIO_Y = [0xfc, 0xfe] as const;
/** Comedic versions (one per seed; line and page breaks as written): turns alternate, HQ first (ending.ts plays any number). */
export const ESCAPE_RADIOS = [
  [
    "IT'S ME. THE DOG\nOF WISDOM.\fI DISPENSE\nWISDOM FROM MY\nMIGHTY WISDOM\nTOOTH.",
    'HI. WHAT IS YOUR\nWISDOM?',
    "HERE IS MY\nWISDOM. IF YOUR\nBALL IS TOO BIG\nFOR YOUR MOUTH,\fIT'S NOT YOURS.",
    'THAT IS A GOOD\nWISDOM.',
  ],
  ["LET'S GO.", "WE CAN'T.", 'WHY NOT?', "WE'RE WAITING\nFOR LADDOT."],
  [
    "WHERE'S THE\nCAPTAIN?",
    "LADD'S THE\nCAPTAIN. WARE\nIS OUR\nSPECIALIST.",
    "YES, LADD.\nWHAT'S HIS 20?\nAND WHY DO YOU\nNEED THE\nSPECIALIST?",
    "NO, WATT'S OVER\nIN 13. WY'S NOT\nON THE LINE.",
    'WHAT??',
    'AREA 13, SIR.',
    'IS LADD COMING\nOR NOT?!',
    'LADD, SIR.\nKNOTT IS\nALREADY BACK AT\nBASE.',
    'WHO??',
    'YES, SIR. PFC HU\nREPORTING, SIR.',
    'I THINK I SEE\nHIM ON THE WAY.',
    "YES, HYMM'S\nPILOTING THE\nCHOPPER.",
  ],
  [
    "I'LL GIVE HIM\nFIVE MORE\nMINUTES THEN I'M\nCALLING THE\nCOPS. I DON'T\nNEED THIS, MAN.\fI'M NOT EVEN\nSUPPOSED TO BE\nHERE TODAY!",
  ],
];

export const COMMANDER = 0x09,
  ROBOT = 0x00,
  CYBORG = 0x02,
  MUSTACHE = 0x01; // message headers (portraits; the robots' $00 shows none)
/**
 * Each boss room's portrait, in BOSS_AREAS order: vanilla's, but Area 12's boss (room $21) is Area 4's (object type $03,
 * the mustache) and talks with Area 11's line ($BA) in its bearded commander portrait; here he has his own face.
 */
const PORTRAIT = [
  COMMANDER,
  COMMANDER,
  MUSTACHE,
  ROBOT,
  CYBORG,
  CYBORG,
  COMMANDER,
  ROBOT,
  COMMANDER,
  ROBOT,
  COMMANDER,
  MUSTACHE,
];
/** A taunt, or a taunt and the reply when that boss dies: Ladd's, or the boss's own (`'boss'`). */
type Line = string | [taunt: string, reply: string, by?: 'boss'];
export const POOLS: Record<number, Line[]> = {
  [COMMANDER]: [
    "GENTLEMEN, YOU CAN'T FIGHT IN HERE! THIS IS THE WAR ROOM!",
    "LOOKS LIKE MEAT'S BACK ON THE MENU, BOYS!",
    'THIS IS SPARTA!!',
    'I LOVE THE SMELL OF NAPALM IN THE MORNING.',
    'THE BEARD STAYS, YOU GO!!',
    ["YOU SHALL NEVER RETRIEVE THE NECRONOMICON!\n\nWE'LL SWALLOW YOUR SOUL!!", 'SWALLOW THIS!'],
  ],
  [ROBOT]: [
    'FRANKLY, THIS CHAMBER WAS A MISTAKE.\n\nIF WE WERE YOU, WE WOULD QUIT NOW.',
    'ASSUME THE PARTY ESCORT SUBMISSION POSITION.',
    'PLEASE PUT DOWN YOUR WEAPON. YOU HAVE 20 SECONDS TO COMPLY.',
    'HELLO! THIS IS THE PART WHERE I KILL YOU!',
    [
      "YOUR ENTIRE LIFE HAS BEEN A MATHEMATICAL ERROR.\nA MATHEMATICAL ERROR I'M ABOUT TO CORRECT.",
      'YOU DANGEROUS, MUTE LUNATIC.',
      'boss',
    ],
  ],
  [CYBORG]: [
    'GET OVER HERE!!!',
    'RESISTANCE IS FUTILE. YOUR LIFE, AS IT HAS BEEN, IS OVER.',
    'WHO RUN BARTERTOWN?',
    "DEAD OR ALIVE, YOU'RE COMING WITH ME.",
    [
      "I'M BAD LADD***\nAND YOU'RE GOOD LADD!\n\nYOU'RE A GOODY LITTLE TWO-SHOES!",
      "GOOD, BAD***\nI'M THE GUY WITH THE GUN",
    ],
  ],
  [MUSTACHE]: [
    'I FART IN YOUR GENERAL DIRECTION!',
    'CALL AN AMBULANCE***\n\nBUT NOT FOR ME!',
    'I WAS PROMISED A QUIET POSTING IN A NEUTRAL ZONE.',
    'EATING A MEAL? A SUCCULENT CHINESE MEAL?\n\nTHIS IS DEMOCRACY MANIFEST!',
    [
      'YOUR REVOLUTION IS OVER, MR. LADD.\n\nCONDOLENCES! THE BUMS LOST!',
      "YEAH? WELL, YOU KNOW, THAT'S JUST LIKE***\n\nYOUR OPINION, MAN.",
    ],
  ],
};
/** The boss who says Joe was moved (story.ts transferArea). */
export const JOE_GONE: Record<number, string[]> = {
  [COMMANDER]: ["WE'RE SORRY, BUT YOUR PRINCESS IS IN ANOTHER CASTLE!"],
  [ROBOT]: ['404 JOE NOT FOUND'],
  [CYBORG]: ["THESE ARE NOT THE JOES YOU'RE LOOKING FOR."],
  [MUSTACHE]: ["JOE'S NOT HERE, MAN."],
};
/** Joe's captor. */
export const JOE_HERE: Record<number, string[]> = {
  [COMMANDER]: ["YOU DIDN'T THINK IT WAS GONNA BE THAT EASY, DID YOU?\n\nHYAAAAAAAH!"],
  [ROBOT]: ['WELL, YOU FOUND JOE. CONGRATULATIONS. WAS IT WORTH IT?'],
  [CYBORG]: ["I POSSESS JOE. I'VE CRUSHED YOUR PATHETIC ARMY.\n\nNOW I'LL HAVE MY VENGEANCE!"],
  [MUSTACHE]: [
    "JOE'S MY BEST FRIEND.\n\nHE'S MY PAL.\n\nHE'S MY HOMEBOY.\n\nMY ROTTEN SOLDIER.\n\nHE'S MY SWEET CHEESE.\n\nMY GOOD TIME BOIII.",
  ],
};
/**
 * The final scene: Killt's lines up to his death (vanilla messages $C8, $5C: "OH? THE KID WHO WAS HERE BEFORE***" /
 * "FOR THE REVIVAL DEVICE*** UH? WHAT!? AYHH***", where Master-D rises and kills him), then Master-D's ($CA, $66: "YOU
 * WOKE ME FROM A LONG SLEEP***" / "*** THE HORROR OF THE ALBATROS!"). One ending per seed; any line may be Ladd's
 * (ending.ts prints them in order, each with its speaker's portrait). After the chopper, the cockpit scene (vanilla $CE,
 * Ladd: "YOUR NUMBER'S UP! MONSTER!", $D0, Master-D: "AH***!") plays one of the ending's `cockpit` variants (by weight).
 */
type Speaker = keyof typeof SPEAKER;
type Lines = [Speaker, string][];
/** Hal's line in Area 12 (`hal`) is the ending's: one of its lines, picked per seed. */
export const ENDINGS: {
  name: string;
  killt: Lines;
  masterD: Lines;
  hal: string[];
  cockpit: { weight: number; lines: Lines }[];
}[] = [
  {
    name: 'Frankenstein / Castlevania',
    killt: [
      ['killt', "IT'S ALIVE***\fIT'S ALIVE!\n\nIT'S ALIIIVE!!"],
      ['ladd', 'IN THE NAME OF GOD!'],
      ['killt', 'OH, IN THE NAME OF GOD!\fNOW I KNOW WHAT IT FEELS LIKE TO BE-- GHYAHH***'],
    ],
    masterD: [
      ['ladd', "DIE MONSTER.\nYOU DON'T BELONG IN THIS WORLD!"],
      [
        'masterD',
        'IT WAS NOT BY MY HAND THAT I AM ONCE AGAIN GIVEN FLESH.\nI WAS CALLED HERE BY HUMANS WHO WISH TO PAY ME TRIBUTE.',
      ],
      ['ladd', "TRIBUTE!?!\fYOU STEAL MEN'S SOULS AND MAKE THEM YOUR SLAVES!"],
      ['masterD', 'PERHAPS THE SAME COULD BE SAID OF ALL RELIGIONS***'],
      ['ladd', 'YOUR WORDS ARE AS EMPTY AS YOUR SOUL!\fCOMMANDOKIND ILL NEEDS A SAVIOR SUCH AS YOU!'],
      ['masterD', 'WHAT IS A COMMANDO?\fA MISERABLE LITTLE COMPILEDO OF SECRETS!\fBUT ENOUGH TALK***\nHAVE AT YOU!'],
    ],
    hal: ["I'LL GIVE YOUR BAZOOKA POWER TO BURN AWAY EVIL.", 'WHAT A HORRIBLE NIGHT TO HAVE A CURSE.'], // (half each)
    cockpit: [
      {
        weight: 3,
        lines: [
          ['ladd', 'DIE, MONSTER!'],
          ['masterD', 'IT CANNOT BE!!\n\nAAAAAHHHH!***'],
        ],
      },
      {
        weight: 1,
        lines: [
          ['ladd', "IF YOU'RE BLUE AND YOU DON'T KNOW WHERE TO GO TO WHY DON'T YOU GO WHERE FASHION SITS***"],
          ['masterD', "PUTTIN' ON THE RIITZZ!!"],
        ],
      },
    ],
  },
  {
    name: 'Revenge of the Sith',
    killt: [
      ['killt', "I'M GOING TO END THIS, ONCE AND FOR ALL."],
      ['ladd', "YOU CAN'T. HE MUST STAND TRIAL."],
      ['masterD', "I'M TOO WEAK***\nOH, DON'T KILL ME***\nPLEASE."],
      ['ladd', "IT'S NOT THE COMMANDO WAY."],
      ['killt', '***'],
      ['masterD', 'POWER!!!'],
    ],
    masterD: [['masterD', 'UNLIMITED POWER!!!']],
    hal: ['USE THE FORCE, LADD.'],
    cockpit: [
      {
        weight: 1,
        lines: [
          ['hal', 'LET GO. LADD, TRUST ME.'],
          ['ladd', '***'],
          ['masterD', 'NOOOOOOOOOO!'],
        ],
      },
    ],
  },
  {
    name: 'Zero Wing',
    killt: [
      ['killt', 'WHAT HAPPEN ?'],
      ['ladd', 'SOMEBODY SET UP US THE BOMB.'],
      ['ladd', 'WE GET SIGNAL.'],
      ['killt', 'WHAT !'],
      ['ladd', 'MAIN SCREEN TURN ON.'],
      ['killt', "IT'S YOU !!"],
    ],
    masterD: [
      ['masterD', 'HOW ARE YOU GENTLEMEN !!\fALL YOUR BASE ARE BELONG TO US.\fYOU ARE ON THE WAY TO DESTRUCTION.'],
      ['ladd', 'WHAT YOU SAY !!'],
      ['masterD', 'YOU HAVE NO CHANCE TO SURVIVE MAKE YOUR TIME.'],
    ],
    hal: ["TAKE OFF EVERY 'ZIG'!!\fYOU KNOW WHAT YOU DOING.\fMOVE 'ZIG'."],
    cockpit: [{ weight: 1, lines: [['ladd', 'FOR GREAT JUSTICE.']] }],
  },
];
/** The vanilla final-scene messages (Killt's two, Master-D's two, the cockpit's two) and the escape radio's two: blanked, their
 * space goes to the new lines. */
const ENDING_Y = [0xc8, 0x5c, 0xca, 0x66, 0xce, 0xd0, ...ESCAPE_RADIO_Y];
/** Hal in Area 12 (message $CC, 0E:$BA8D; vanilla: "I'M HAL. MASTER-D IS*** LEAVING*** AIM AT THE COCKPIT AS YOU JUMP***"). */
export const HAL_Y = 0xcc;

/** Radio-box text (6-row pages) as messages of at most 255 characters, split at page ends (the next message starts a page). */
export function radioMessages(text: string): string[] {
  const all = wrap(text, undefined, RADIO_PAGE),
    size = LINE * RADIO_PAGE,
    parts: string[] = [];
  let cur = '';
  for (let i = 0; i < all.length; i += size) {
    const page = all.slice(i, i + size);
    if (cur && (cur + page).trimEnd().length > 255) {
      parts.push(cur.trimEnd());
      cur = '';
    }
    cur += page;
  }
  return [...parts, cur.trimEnd()];
}

/** Human portraits borrow each other's unused lines once their own run out (the commander has up to 6 bosses). */
const HUMAN = [COMMANDER, CYBORG, MUSTACHE];

export interface BossLines {
  /** Boss room per line. */
  rooms: number[];
  texts: Message[];
  /** The replies when a boss dies, by boss room (roomtalk.ts talkOnBossDeath). */
  replies: { room: number; text: Message }[];
  /** The final scene (one of ENDINGS): Killt's script, up to his death, Master-D's, the cockpit's (none: vanilla's), and the
   * radio after the escape (one of ESCAPE_RADIOS). */
  ending?: { killt: Message[]; masterD: Message[]; cockpit: Message[]; radio: Message[] };
  /** The escape cyborg's line (message ESCAPE_Y). */
  escape?: Message;
  /** The self-destruct warning (message SELF_DESTRUCT_Y), with the ending. */
  selfDestruct?: Message;
  /** Joe's letter (message JOE_LETTER_Y), with the ending. */
  joeLetter?: Message;
  /** Ladd's report from the chopper (message MISSION_REPORT_Y), with the ending. */
  missionReport?: Message;
  /** Joe's answer when rescued: message JOE_RESCUE_Y, and JOE_SPEECH_Y[0] when it's longer than a message. */
  rescue?: Message[];
  /** Ladd's line outside the base (message STILL_INSIDE_Y), with the ending. */
  stillInside?: Message;
  /** Hal's line in Area 12 (message HAL_Y), with the ending. */
  hal?: string;
  /** Vanilla taunts no boss shows any more (message number -> a blank): their bank space goes to the new lines. */
  freed: Map<number, string>;
  spoiler: SpoilerDialogue;
}

/**
 * Pick a line for every boss room (after story.ts has set the table): Joe's captor (`joeArea`, a layout) and the
 * transfer boss (`transferArea`) get their portrait's Joe line. `nonsense` (hint mode Nonsense with vanilla boss
 * dialogue): every boss says a talker line of nonsense.ts instead, the Joe bosses too (the lines the talkers don't say
 * first), and the ending stays vanilla.
 */
export function pickBossLines(
  rom: Uint8Array,
  rng: Rng,
  spot: (layout: number) => number,
  joeArea: number,
  transferArea?: number,
  nonsense?: { said: string[] },
): BossLines {
  const left = new Map(Object.entries(POOLS).map(([h, ls]) => [Number(h), rng.shuffle([...ls])]));
  // (the lines the talkers don't say first, then theirs, repeats)
  const order = [
    ...rng.shuffle(NONSENSE.talker.filter((l) => !nonsense?.said.includes(l))),
    ...rng.shuffle([...new Set(nonsense?.said ?? [])]),
  ];
  let next = 0;
  const talker = () => order[next++ % order.length];
  const out: BossLines = { rooms: [], texts: [], replies: [], spoiler: { bosses: [], scenes: {} }, freed: new Map() };
  const scenes = out.spoiler.scenes,
    shown = (t: string) => t.replaceAll('\f', '\n'); // (a page break shown as a line break)
  BOSS_AREAS.forEach((area, i) => {
    const y = rom[BOSS_TABLE + i],
      header = PORTRAIT[i];
    if (area !== 12 && GENERIC.has(y) && readMessage(rom, messageForY(y))!.header !== header)
      throw new Error('bosses: unexpected portrait');
    let line: string | undefined, reply: string | undefined, by: 'boss' | undefined;
    if (nonsense) line = talker();
    else if (area === joeArea) line = rng.pick(JOE_HERE[header]);
    else if (area === transferArea) line = rng.pick(JOE_GONE[header]);
    else {
      const from = [header, ...(HUMAN.includes(header) ? HUMAN.filter((h) => h !== header) : [])].find(
        (h) => left.get(h)?.length,
      );
      if (from === undefined) return; // (pools exhausted: the vanilla taunt stays)
      [line, reply, by] = [left.get(from)!.pop()!].flat() as [string, string?, 'boss'?];
    }
    out.rooms.push(0x16 + i);
    out.texts.push({ header, text: wrap(line) });
    out.spoiler.bosses.push({
      area: spot(area),
      layout: area,
      line: shown(line),
      ...(reply && { reply: { speaker: by ? 'boss' : 'ladd', text: shown(reply) } as Said }),
    });
    if (reply) out.replies.push({ room: 0x16 + i, text: { header: by ? header : SPEAKER.ladd, text: wrap(reply) } });
  });
  // the escape cyborg: a line the bosses left (one without a reply: his death has none), else the vanilla taunt
  const escapeLine = nonsense
    ? talker()
    : (() => {
        for (const h of [CYBORG, ...HUMAN.filter((h) => h !== CYBORG)]) {
          const i = left.get(h)!.findIndex((l) => typeof l === 'string');
          if (i >= 0) return left.get(h)!.splice(i, 1)[0] as string;
        }
      })();
  if (escapeLine) {
    out.escape = { header: CYBORG, text: wrap(escapeLine) };
    scenes.escapeCyborg = [{ text: shown(escapeLine) }];
  }
  const stillShown = new Set(
    BOSS_AREAS.map((_, i) => rom[BOSS_TABLE + i]).filter((_, i) => !out.rooms.includes(0x16 + i)),
  );
  for (const y of [...GENERIC, ...JOE_Y]) if (!stillShown.has(y)) out.freed.set(messageForY(y), ' ');
  if (nonsense) return out;
  const ending = rng.pick(ENDINGS);
  let roll = rng.int(ending.cockpit.reduce((n, c) => n + c.weight, 0));
  const cockpit = ending.cockpit.find((c) => {
    roll -= c.weight;
    return roll < 0;
  })!.lines;
  const say = (lines: Lines) => lines.map(([who, line]) => ({ header: SPEAKER[who], text: wrap(line) }));
  const show = (lines: Lines): Said[] => lines.map(([who, line]) => ({ speaker: who, text: shown(line) }));
  const speakers = ESCAPE_RADIO_Y.map((y) => readMessage(rom, messageForY(y))!.header),
    radio = rng.pick(ESCAPE_RADIOS);
  out.ending = {
    killt: say(ending.killt),
    masterD: say(ending.masterD),
    cockpit: say(cockpit),
    radio: radio.map((line, i) => ({ header: speakers[i % 2], text: wrap(line, undefined, RADIO_PAGE) })),
  };
  scenes.ending = show([...ending.killt, ...ending.masterD]);
  scenes.cockpit = show(cockpit);
  out.hal = rng.pick(ending.hal);
  scenes.hal = [{ speaker: 'hal', text: shown(out.hal) }];
  const boom = rng.pick(SELF_DESTRUCTS);
  out.selfDestruct = { header: 0, text: wrap(boom) };
  scenes.selfDestruct = [{ text: shown(boom) }];
  const rescue = rng.pick(JOE_RESCUES);
  const joe = readMessage(rom, messageForY(JOE_RESCUE_Y))!.header;
  out.rescue = radioMessages(rescue).map((text) => ({ header: joe, text }));
  if (out.rescue.length > 2) throw new Error("bosses: Joe's answer is too long");
  scenes.joeRescue = [{ speaker: 'joe', text: shown(rescue) }];
  for (const y of JOE_SPEECH_Y.slice(out.rescue.length - 1)) out.freed.set(messageForY(y), ' ');
  const inside = rng.pick(STILL_INSIDES);
  out.stillInside = { header: SPEAKER.ladd, text: wrap(inside) };
  scenes.outsideBase = [{ speaker: 'ladd', text: shown(inside) }];
  const report = rng.pick(MISSION_REPORTS);
  out.missionReport = { header: 0xb0, text: wrap(report) };
  scenes.missionReport = [{ text: shown(report) }];
  scenes.escapeRadio = radio.map((l, i) => ({ speaker: i % 2 ? 'officer' : 'hq', text: shown(l) }));
  const letter = rng.pick(JOE_LETTERS);
  out.joeLetter = { header: 0xb0, text: wrap(letter) };
  scenes.joeLetter = [{ text: shown(letter) }];
  for (const y of ENDING_Y) out.freed.set(messageForY(y), ' ');
  return out;
}
