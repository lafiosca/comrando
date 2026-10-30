// Hint mode Nonsense (option Routing Hints: old memes and quotes in the hint slots): no hints for
// the logic, and every hint says one of these lines instead, from a pool per box: the comm rooms' radio (box style 1,
// 6-row pages: text.ts RADIO_PAGE) or the NZ talkers (style 0, 4-row pages); and the intro briefing (radio boxes) from
// its own pool. No pool for the bosses: with Story Dialogue Comedic theirs come from bosses.ts, with Vanilla from the
// talkers' pool. The lines are kept as written
// (typos too), except the font has no double quote: those are apostrophes. "\f" is a page break (A to go on);
// "\n" a line break.
// test/text.test.ts checks every line has tiles in the game font and that none repeats.

import type { Rng } from './rng.ts';
import type { Said, SpoilerHint } from './spoiler.ts';
import { type Message, messageForY, RADIO_PAGE, wrap } from './text.ts';

/** The radio's messages Nonsense replaces besides the hint slots (hints.ts): O1A's briefing (#12; #13, which vanilla
 * chains after it, is skipped) and Area 12's comm rooms (Joe's lines, the wiretaps' first lines). Each wiretap says one
 * line: the replies are skipped. */
export const NONSENSE_RADIO_Y = [0x14, 0xbc, 0xbe, 0xc2, 0xc4];
/** The messages Nonsense leaves unshown, blanked (their bank space goes to its lines): O1A's #13 and every wiretap's
 * reply, Joe's rescue past his first message (patches.ts oneBriefingMessage, oneLineWiretaps, oneRescueLine). */
export const NONSENSE_BLANK_Y = [
  0x16, 0x1a, 0x20, 0x54, 0x6c, 0x2e, 0x42, 0x82, 0xb4, 0xf0, 0xc0, 0xc6, 0x58, 0xd8, 0x5a,
];
/** Joe's rescue (radio): his first message (#109; Ladd's "MR.JOE. I'VE COME TO RESCUE YOU." stays), and then the
 * scene ends (patches.ts oneRescueLine): his #46, #110 and tip #47 are blanked. */
export const NONSENSE_RESCUE_Y = [0xd6];
/** The NZ guards (talkers): "THIS IS A NEUTRAL AREA." (#49) and NZ14's "I CANNOT LET YOU GO THROUGH WITHOUT A PERMIT." (#50);
 * and NZ13's door-A man (`$52`, 0E:$B5FF[0]), in no hint slot: "SUPER JOE? I'M SORRY,BUT I DON'T KNOW ANYONE NAMED
 * SUPER JOE." (#20). (#88 "IF YOU CANNOT ADVANCE ON THE FLOOR,TRY CEILING." is never shown: nothing refers to it.) */
export const NONSENSE_GUARD_Y = [0x5e, 0x60, 0x24];
/** The rest of the characters' one-off lines (talkers): the
 * building soldiers' "WHAT ARE YOU DOING HERE?" (#22, NZ13), "GET THE HECK OUT OF HERE, YOU NERD!" (#41, NZ16), the
 * NZ19 ambusher's "YOU'RE MY 100TH OPPONENT." (#86, the knife man outside), and the passage room's captured
 * soldier (#74 on the way in, #76 the underground paths' clue). Not the lines never shown (#75 "OUCH", #77 M-2's "HOW
 * COULD YOU…", Captain Mack's #57/#59: docs/rom-notes.md#text-and-messages), Ladd's, the Destroyers', the intro, the
 * ending or the credits. */
export const NONSENSE_TALK_Y = [0x28, 0x4e, 0xa8, 0x90, 0x94];
/** NZ19's bombardier (type $02 in its door-B room $44, 0E:$8739 `LDA #$78 / JMP $D78A`: #62 "GO AHEAD,SHOOT ME!"): a
 * line of his own pool. */
export const BOMBER_Y = 0x78;
export const NONSENSE_BOMBER = [
  "I BET YOU'D LIKE TO HAVE MORE BOMBS.",
  "I'VE GOT A PRESENT FOR YA!",
  'CAN I GET FIVE BIG BOOMS?',
  "SOME DAYS YOU JUST CAN'T GET RID OF A BOMB.",
  'BOMB VOYAGE.',
];
/** Killt's visit to a neutral zone: the grunt's announcement (#29 "...MAKE WAY FOR MR.KILLT.") stays, Killt's speech
 * (#30) is a talker line. */
export const NONSENSE_KILLT_Y = 0x38;
/** The Destroyers' opening lines (#80, #82, #83: "I AM DESTROYER-1. DO YOU HAVE ANY NEED FOR A MACHINEGUN?", or "I AM
 * <name>. ARE YOU WITH THE FEDERATION?"), each a question of its own pool, no name: the YES/NO
 * follows. The spoiler names the real one by where he stands. */
export const DESTROYER_Y = [0x9c, 0xa0, 0xa2];
export const NONSENSE_QUESTIONS = [
  'DO YOU LIKE ME? CIRCLE ONE.',
  'ARE YOU NOT ENTERTAINED?',
  'WILL YOU JOIN ME, AND TOGETHER WE WILL RULE THE WORLD?',
  'DO YOU WANT TO DELETE YOUR SAVE DATA?',
  'DO YOU THINK THAT EVEN THE WORST PERSON CAN CHANGE***?',
  'WOULD YOU LIKE TO TAKE A BREAK?',
  'ARE YOU READY TO DIE?',
  'DO YOU HATE ME?',
  'WOULD YOU LIKE TO RESTART YOUR LIFE?',
  'WILL YOU SACRIFICE ARCADIA BAY?',
  'IS THE THOUGHT OF A UNICORN A REAL THOUGHT?',
  'DO YOU ACCEPT MY CONFESSION?',
];
/** The wrong communicator's static (#51 "GA*GA*GA****", no portrait): Nonsense's own line. */
export const STATIC_Y = 0x62;
export const NONSENSE_STATIC = 'ALL WE HEAR IS\nRADIO\nGA*GA*GA****';
/** The intro briefing's two messages (#125, #126) and their speakers' headers. */
export const BRIEFING_Y = [0xf6, 0xf8];
export const BRIEFING_HEADER = { officer: 0x46, hq: 0x48 } as const;

/** Lines in a random order, every one before any repeats (and never the same twice in a row). */
export function deck(rng: Rng, lines: readonly string[]): () => string {
  let left: string[] = [],
    last: string | undefined;
  return () => {
    if (!left.length) {
      left = rng.shuffle([...lines]);
      if (left.length > 1 && left[left.length - 1] === last) left.unshift(left.pop()!);
    }
    last = left.pop()!;
    return last;
  };
}

export const NONSENSE: Record<'radio' | 'talker', string[]> = {
  radio: [
    'THE NEXT THING I SAY TO YOU WILL BE TRUE.\fTHE LAST THING I SAID WAS FALSE.',
    'SNAKE? SNAKE!?\fSNAAAAAKE!',
    "TIME IS A TOOL YOU CAN PUT ON THE WALL, OR WEAR IT ON YOUR WRIST.\fTHE PAST IS FAR BEHIND US. THE FUTURE DOESN'T EXIST.",
    "WOLFMAN JACK SAYS SOMEONE'S AT THE FRONT DOOR, BABY!",
    'THIS ROOM IS AN ILLUSION AND IS A TRAP DEVISUT BY SATAN.\fGO AHEAD DAUNTLESSLY! MAKE RAPID PROGRES!',
    "YOU KNOW,\nLADD*** IT'S\nSUCH A\nBEAUTIFUL\nEVENING AND YET\n***OUT THERE***\fBERLIN AT NIGHT\n***\nAN IRON CURTAIN\nJUST DOESN'T\nSEEM RIGHT.",
    'JOIN THE NINTENDO FUN CLUB TODAY! LADD.',
    "I'M ON A MEXICAN RADIO. I'M ON A MEXICAN WHOA-OH RADIO.",
    'VIDEO KILLED\nTHE RADIO STAR!',
    '23, COME IN 23! DO YOU NEED ME OUT THERE? DO YOU NEED MY ASSISTANCE?',
    'CAR 54, WHERE ARE YOUUUUU?',
    "AH BREAKER 1-9, THIS HERE'S THE RUBBER DUCK.\nYOU GOT A COPY\nON ME PIG PEN,\nCOME ON?",
    'LISTEN LADD!! DODGE HIS PUNCH THEN COUNTER PUNCH!',
    'DO A BARREL ROLL!',
    'SAVE KEYS TO OPEN DOORS',
    'THE WHITE ZONE IS FOR IMMEDIATE LOADING AND UNLOADING OF PASSENGERS ONLY.',
    'SHOP SMART!\nSHOP S-MART!',
    'WHAT WE GOT HERE IS A FAILURE TO COMMUNICATE.',
    'MR. WATSON, COME HERE, I WANT TO SEE YOU.',
    'SORRY, WRONG NUMBER!',
    "GOOD, YOU'RE NOT DEAD. I'VE BEEN TRYING TO GET IN TOUCH WITH YOU FOR 45 MINUTES.",
    'TALKY, TALKY, TALKY. NO MORE TALKY.',
    'THIS IS A WARNING. STEP AWAY FROM THE CAR. THIS CAR IS PROTECTED BY VIPER.',
    "YOU WON'T HEAR A BUZZ, BUT I'M BUZZING YOU IN. I'M BUZZING YOU IN.",
    "GUESS WHERE I AM. I'M CALLING FROM THE PLANE. I'LL CALL YOU WHEN I GET THERE.",
    "BELIEVE IT OR NOT, GEORGE ISN'T AT HOME. PLEASE LEAVE A MESSAGE AT THE BEEP.",
    'TALK TO ME, GOOSE.',
    "HELLO DAD, I'M IN JAIL! HI DAD, I'M CALLING YOU FROM JAIL!",
    'CAN YOU HOLD ON A SECOND? I HAVE CALL WAITING.',
    'THE NUMBER YOU HAVE DIALED IS NOT IN SERVICE. PLEASE HANG UP AND TRY AGAIN.',
    'WE URGE YOU TO STAY TUNED TO RADIO AND TV AND TO STAY INDOORS AT ALL COSTS.',
    "I'M GOING NUTS BEING ON THE RADIO ALL THE TIME. I'D REALLY LIKE TO GET SOME FIELD WORK.",
    'THIS IS RADIO FREEDOM!',
    'HARD HAT. CODE NAME HARD HAT. DO YOU READ, RADIO DISPATCH?',
    'GOOOOOOOOOD MORNING VIETNAAAM!!!',
    "WE'VE BEEN TRYING TO REACH YOU ABOUT YOUR CAR'S EXTENDED WARRANTY.",
  ],
  talker: [
    "WHERE'S THE BEEF?",
    "IT'S PEANUT BUTTER JELLY TIME!!",
    'WHO WANTS A BODY MASSAGE?',
    'I AM ERROR.',
    'PORK CHOP SANDWICHES!!',
    'HEY, LISTEN!',
    'WELCOME HERE. THIS IS A WARP ZONE.',
    'I FEEL ASLEEP!!',
    "IT'S A SECRET TO EVERYBODY.",
    'YOU SPOONY BARD!',
    'UH-OH! THE TRUCK HAVE STARTED TO MOVE!!',
    'I AM COWARD DUCK.',
    'SECRET IS IN THE TREE AT THE DEAD-END.',
    'PAY ME FOR THE DOOR REPAIR CHARGE.',
    'DODONGO DISLIKES SMOKE.',
    'OUCH! WHAT DO YOU DO?',
    'GET A SILK BAG FROM THE GRAVEYARD DUCK TO LIVE LONGER.',
    'HELLO! YOU FOUND MY SHOP OF STRANGE AND WONDERFUL THINGS!',
    'LOOSE WEIGHT AND RIDE THE ELEVATORS',
    "DON'T BE A TUNA HEAD!",
    "LET'S PLAY MONEY MAKING GAME.",
    'LET ME REMOVE THE EGGPLANT CURSE',
    'JUST A GIRL. GET OUT OF HERE!',
    'EAT MY SHORTS!',
    'COWABUNGA!!!',
    "WE'RE NO STRANGERS TO LOVE. YOU KNOW THE RULES, AND SO DO I!",
    'SOMEBODY ONCE TOLD ME THE WORLD IS GONNA ROLL ME***',
    'THIS IS FINE!',
    'ONE DOES NOT SIMPLY WALK INTO AREA 12.',
    'I AM ONCE AGAIN ASKING FOR YOUR FINANCIAL SUPPORT.',
    "SIR, THIS IS A WENDY'S.",
    'THE CAKE IS A LIE.',
    'ENCHANTMENT?!',
    'I USED TO BE A COMMANDO LIKE YOU.\fTHEN I TOOK A BULLET TO THE KNEE.',
    'WAR. WAR NEVER CHANGES.',
    'YOU MUST CONSTRUCT ADDITIONAL PYLONS!',
    'PRESS F TO PAY RESPECTS.',
    "IN THIS WORLD, IT'S KILL OR BE KILLED.",
    'HOI! IM TEMMIE!',
    "I'M COMMANDER SHEPARD, AND THIS IS MY FAVORITE STORE ON THE CITADEL.",
    'ZUG ZUG.',
    'SHAKE IT BABY!!',
  ],
};

/**
 * The intro briefing: vanilla's two messages, #125 ($F6, the officer's "CAPTAIN,IT'S FROM HEADQUARTERS.") then #126
 * ($F8, HQ's orders), each with who says it (its portrait). A new message reconnects the radio (the connection sound,
 * the portrait redrawn), so a speech too long for one message (255 characters) goes on in the second, as vanilla's
 * Area 1 COMMUNICATE does (#12 "...DEPENDS ON STAY-", #13 "ING IN TOUCH.").
 */
type Speaker = 'officer' | 'hq';
export const NONSENSE_BRIEFINGS: [[Speaker, string], [Speaker, string]][] = [
  [
    ['officer', 'NOW IT IS THE BEGINNING OF A FANTASTIC STORY!'],
    ['hq', 'LET US MAKE A JOURNEY TO THE CAVE OF MONSTERS!\fGOOD LUCK!'],
  ],
  [
    ['officer', "OH, IT'S TERRIBLE!"],
    ['hq', 'THE KING HAS BEEN TRANSFORMED!\fPLEASE FIND THE MAGIC WAND SO WE CAN CHANGE HIM BACK.'],
  ],
  [
    ['officer', "IT'S DANGEROUS TO GO ALONE!"],
    ['hq', 'TAKE THIS.'],
  ],
  [
    ['officer', 'SUPER JOE HAS BEEN KIDNAPPED BY NINJAS.'],
    ['hq', 'ARE YOU A BAD ENOUGH DUDE TO RESCUE SUPER JOE?'],
  ],
  [
    [
      'hq',
      "BIG BOSS\nSPEAKING\nOPERATION\nINTRUDE N313.\fYOU ARE TO INFILTRATE THE ENEMY FORTRESS 'OUTER HEAVEN'\fTHEN DESTROY THEIR FINAL WEAPON METAL GEAR.",
    ],
    ['officer', "FIRST, ATTEMPT TO CONTACT MISSING OUR 'SUPER JOE.'\fTHEN TRY TO FIND THE METAL GEAR."],
  ],
  [
    ['officer', 'THE WORLD IS VEILED IN DARKNESS.'],
    [
      'hq',
      'THE WIND STOPS, THE SEA IS WILD, AND THE EARTH BEGINS TO ROT.\fTHE PEOPLE WAIT, THEIR ONLY HOPE, A PROPHECY****',
    ],
  ],
  [
    // (HQ alone: six pages, two messages)
    [
      'hq',
      "LADD, I WANT TO SEND YOU ON A MISSION.\fIT'S DANGEROUS, BUT YOU'LL BE FREE IF YOU SUCCEED.\fOUR MEN ARE STILL MISSING IN A JUNGLE IN VIETNAM.",
    ],
    [
      'hq',
      'WE BELIEVE THEY ARE ALIVE, PRISONERS OF THE ENEMY.\fYOUR MISSION IS TO SNEAK INTO THE ENEMY CAMP AND FIND THEM.\fARE YOU UP TO IT?',
    ],
  ],
];

/** Messages that say Nonsense (hints.ts): the radio's or a talker's, and the spoiler's name for them. */
export interface NonsenseSlot {
  label: string;
  box: 'radio' | 'talker' | 'bomber';
  ys: number[];
  where?: Omit<SpoilerHint, 'kind' | 'lines' | 'slot'>;
}

/**
 * Draw every Nonsense line of a seed: each slot's messages from its box's pool, and a briefing. The radio has ~40
 * messages but bank 0B room for only ~10-15 long distinct ones (a message's copy is its header and text: identical ones
 * share it, text.ts writeMessages), so past `budget` bytes of distinct copies a message repeats a line already stored
 * under its header (generate.ts draws again with less on a full bank). `headerOf`: the message's header in the ROM.
 */
export function drawNonsense(rng: Rng, slots: NonsenseSlot[], headerOf: (y: number) => number, budget: number) {
  const messages = new Map<number, string | Message>(),
    spoiler: SpoilerHint[] = [],
    talkerLines: string[] = [];
  const radio = deck(rng, NONSENSE.radio),
    talker = deck(rng, NONSENSE.talker),
    bomber = deck(rng, NONSENSE_BOMBER);
  const stored = new Map<number, string[]>(); // header -> radio lines stored under it
  const radioLine = (y: number) => {
    const h = headerOf(y),
      mine = stored.get(h) ?? [];
    let line = radio();
    if (!mine.includes(line)) {
      const size = wrap(line, undefined, RADIO_PAGE).length + 2;
      if (size > budget && mine.length) line = rng.pick(mine);
      else {
        budget -= size;
        stored.set(h, [...mine, line]);
      }
    }
    return line;
  };
  const say = (y: number, box: NonsenseSlot['box']) => {
    const line = box === 'radio' ? radioLine(y) : box === 'bomber' ? bomber() : talker();
    if (box === 'talker') talkerLines.push(line);
    messages.set(messageForY(y), box === 'radio' ? wrap(line, undefined, RADIO_PAGE) : wrap(line));
    return line.replace(/\f/g, '\n');
  };
  const entry = (slot: string, lines: Said[], where?: NonsenseSlot['where']): SpoilerHint => ({
    kind: 'nonsense',
    slot,
    ...where,
    lines,
  });
  for (const s of slots)
    spoiler.push(
      entry(
        s.label,
        s.ys.map((y) => ({ text: say(y, s.box) })),
        s.where,
      ),
    );
  for (const y of NONSENSE_BLANK_Y) messages.set(messageForY(y), ' ');
  messages.set(messageForY(STATIC_Y), wrap(NONSENSE_STATIC, undefined, RADIO_PAGE));
  spoiler.push(entry('Wrong communicator', [{ text: NONSENSE_STATIC }]));
  const questions = rng.shuffle([...NONSENSE_QUESTIONS]).slice(0, DESTROYER_Y.length);
  DESTROYER_Y.forEach((y, i) => messages.set(messageForY(y), wrap(questions[i])));
  spoiler.push(
    entry(
      'Destroyers',
      questions.map((text) => ({ text })),
    ),
  );
  const briefing = rng.pick(NONSENSE_BRIEFINGS);
  briefing.forEach(([who, line], i) =>
    messages.set(messageForY(BRIEFING_Y[i]), { header: BRIEFING_HEADER[who], text: wrap(line, undefined, RADIO_PAGE) }),
  );
  spoiler.push(
    entry(
      'Intro briefing',
      briefing.map(([who, line]) => ({ speaker: who, text: line.replace(/\f/g, '\n') })),
    ),
  );
  return { messages, spoiler, talkerLines };
}
