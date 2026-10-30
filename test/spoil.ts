// Lookups on the spoiler's data for tests (generate.ts Spoiler).
import type { Spoiler } from '../src/core/generate.ts';
import type { Item } from '../src/core/world.ts';

type S = Pick<Spoiler, 'rewards'>;
/** The item for clearing map number `area`. */
export const clearOf = (spoiler: S, area: number): Item | undefined =>
  spoiler.rewards.find((r) => r.location.startsWith('clear') && r.area === area)?.item;
/** The item at location `id` (world.ts ids: clearN, roomNN, destroyer, passage). */
export const rewardOf = (spoiler: S, id: string): Item | undefined =>
  spoiler.rewards.find((r) => r.location === id)?.item;
/** Where `item` is. */
export const whereIs = (spoiler: S, item: Item) => spoiler.rewards.find((r) => r.item === item);
/** The layout at map number `area`, and the map number of `layout`. */
export const layoutAt = (spoiler: Pick<Spoiler, 'layouts'>, area: number) =>
  spoiler.layouts.find((p) => p.area === area)?.layout ?? area;
export const areaOf = (spoiler: Pick<Spoiler, 'layouts'>, layout: number) =>
  spoiler.layouts.find((p) => p.layout === layout)?.area ?? layout;
/** Every hint's text on one line (a wiretap's line and reply: "line / reply"). */
export const hintTexts = (spoiler: Pick<Spoiler, 'hints'>) =>
  spoiler.hints.map((h) =>
    h.lines
      .map((l) => l.text)
      .join(' / ')
      .replace(/\n/g, ' '),
  );
/** Joe's rescue tip (hints on), on one line. */
export const joeTip = (spoiler: Pick<Spoiler, 'hints'>) =>
  spoiler.hints.find((h) => h.kind === 'joeRescue')?.lines[0].text.replace(/\n/g, ' ');
/** Every line of the story dialogue: the bosses' taunts and replies, then the scenes'. */
export const dialogueTexts = (spoiler: Pick<Spoiler, 'dialogue'>) =>
  !spoiler.dialogue
    ? []
    : [
        ...spoiler.dialogue.bosses.flatMap((b) => [b.line, ...(b.reply ? [b.reply.text] : [])]),
        ...Object.values(spoiler.dialogue.scenes).flatMap((lines) => lines.map((l) => l.text)),
      ];
