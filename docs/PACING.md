# Story pacing and clarity

The owner's playtest: story cards came too quickly (about 40 an hour at speed 1)
and did not explain what was going on. This pass adds a **story pace** setting,
turns most cards into **messages that wait** instead of interruptions, and adds
plain-language **clarity surfaces**. Sim speed, growth and the economy are
unchanged; only the story's clocks and delivery changed.

## Story pace (Settings → Story pace)

`Settings.storyPace: 'relaxed' | 'normal' | 'brisk'`, default **relaxed**. Older
stored settings without it (or with an unknown value) read as relaxed. A change
applies at once: the director reads the pace live (`STORY_PACE` in
`src/game/config.ts`) and the view is rebuilt.

Every clock is **unpaused real seconds**, kept in `world.story` and saved, so
higher sim speeds never compress the story in real time and a reload neither
resets nor skips a gap.

| Knob (`PaceTuning`) | Relaxed | Normal | Brisk | What it does |
|---|---|---|---|---|
| `chapterMinSec` | 1,440 (24 min) | 840 (14 min) | 600 (10 min) | Chapter floor: unpaused seconds between chapter completions (the boot counts as one). Ch6's first count waits for it too. |
| `quietSec` | 300 | 180 | 0 | Quiet build window after a chapter title: no faction or ⚑ cards. |
| `minActiveSecBetween` | 900 | 540 | 120 | Deck gap between faction / ⚑ deliveries. |
| `beatGapSec` | 90 | 45 | 10 | Gap between story cards, from the last card closed (direct replies skip it). |
| `maxChain` | 1 | 1 | 2 | Cards in a row after a close. 1 = no chains, except direct replies. |
| `pendingMinSec` | 300 | 180 | 60 | Unpaused seconds before a COMMS card takes its ‡ default (and 20 sim days). |
| `cardChanceMul` | 0.5 | 0.6 | 1 | Multiplier on the random draw's 0.35 chance. |

Pace-independent: urgent system cards (bailout, the Clip) need only 120 s since
the last deck card (`STORY_PACING.systemGapSec`) and may come inside the quiet
window. Goal waivers start once a chapter has run 720 d **and** its floor is met
(so no goal is waived while the chapter still has minutes to run), then one per
360 d. A seasonal card never takes a deck slot it took in the last three deck
cards (on slow paces a slot opens about every two sim years, always in the same
month). Fallbacks (720 / 1,440 d), beat time-outs (360 d) and waivers still
finish the story for a city that never grows.

### Measured (headless, speed 1 = 0.5 s a day, steady and greedy builders × 3 seeds)

Median chapter starts, unpaused / wall minutes (wall adds a reading-time model:
15 s a beat or log, 12 s a faction card), and cards per wall hour up to the first
Charter Night. "All" counts every card delivered (banners plus cards that opened
by themselves); "forced" only the ones that opened by themselves and paused.

| Pace | Ch2 | Ch3 | Ch4 | Ch5 | Ch6 | Charter Night | Cards / h (all) | Forced / h |
|---|---|---|---|---|---|---|---|---|
| Before (one pace) | 10 / 11 | 20 / 23 | 30 / 34 | 48 / 54 | 63 / 71 | 66 / 75 | 40.7–40.9 | 20.1 |
| Brisk | 10 / 12 | 20 / 23 | 30 / 34 | 52 / 58 | 67–70 / 74–77 | 71–74 / 79–82 | 37.9–38.9 | 10.3–10.8 |
| Normal | 14 / 16 | 28 / 31 | 42–45 / 46–49 | 68–71 / 73–76 | 85–88 / 91–94 | 93–96 / 100–103 | 19.8–19.9 | 6.4 |
| Relaxed | 24 / 26 | 48 / 51 | 72 / 76 | 108 / 113 | 135–138 / 141–144 | 153–156 / 160–162 | 12.0–12.4 | 3.4–3.8 |

A chapter's own beats, logs and reward are about 25 cards over the main story,
which alone is ~10 an hour on relaxed; that is why relaxed keeps the deck to one
faction card per ~15 min and its chapters at 24 min.

## Interruptions

Only these open by themselves and pause the sim:

- `ch1.boot` (the story's first card, before COMMS exists);
- the key choices: `ch1.lark`, `ch2.vote`, `ch3.pier`, `ch4.brine`, `ch5.choice`,
  and `ch6.count` (it opens Charter Night);
- Charter Night, ending cards and Log 6 after them;
- urgent system cards: `sys.bailout`, `sys.revealed` (`URGENT_SYSTEM`);
- a **direct reply** to the choice just made: a card queued `+0d` by that
  choice, its Silt Log, or the chapter reward when that choice completed the
  chapter. It opens right after the card closes, on every pace.

Everything else arrives as a **message** and the game keeps running:

- **Story messages** (other beats, Silt Logs, chapter rewards) wait in
  `story.waiting`, one at a time. The incoming banner shows ("Message · Basalt",
  "Silt Log recovered") with the usual chime, the goal chip reads
  "✉ 1 message waiting" (amber), and the banner repeats gently every 150 s of
  play while it stays unread. Tap the banner, the goal chip → **Read**, or the
  COMMS row to open it. It counts as shown only when opened (its onShow runs
  then), and the chapter waits for it: no completion, no next beat, no deck
  card, no next chapter until it is read. Story messages never auto-answer.
- **COMMS cards** (faction cards, ⚑ ultimatums, non-urgent system cards such as
  the Charter Review) wait as the pending card with a countdown ring and take
  their ‡ default after 20 sim days and the pace's `pendingMinSec`.

An opened message pauses while it is on screen and has **Later** (it goes back
to waiting; a COMMS card keeps its timer). One modal at a time, as before.

## Clarity surfaces

- **What's going on** (`Card.brief`, ≤ 220 chars): a labelled plain-language box
  under the card title, visually distinct from the in-voice body. The text block
  (sys, title, brief, body) scrolls with a "more below" cue; the choices and the
  footer never move, so all choices stay visible at 360 × 640 and 844 × 390.
- **Who is this?**: the speaker line on a faction's card is a button. The first
  card a faction speaks on opens it (saved in `story.met`): name, leader, tier and
  standing, what they call you, and `Faction.about`.
- **Choice summaries**: under every choice a plain line built from its hints,
  e.g. "Basalt ++ · Nacre − · Trace +3 · −1,200 CR" (signs repeat by strength).
  Holding a choice still shows its exact effects.
- **Chapter summary** (`Chapter.summary`): on the chapter title card ("What's
  happening", the card stays ~14 s or until tapped) and at the top of the goal
  drawer.
- **Story so far**: the goal drawer lists every finished chapter with its
  `Chapter.recap` and the key choice made ("You chose: …"), and the ending held.
- **Glossary**: the "?" in the goal drawer's header lists `GLOSSARY`
  (`src/game/story/content/glossary.ts`).
- The goal drawer also shows the waiting messages (with **Read**) and the
  current pace with a link to Settings.

## Saved state (all optional; v1 and older v2 saves load)

`story.sinceStartSec` (missing = long ago), `story.deckSec` (missing = 0: one
deck gap after loading an old save), `story.frontSec` (missing = long ago),
`story.waiting` (missing = none; dropped if its card no longer exists),
`story.met` (missing = none), `story.waiveFrom` (missing = null). Negative or
malformed clocks are clamped on load.

## Measuring

The scratch harness drives a headless game day by day at 0.5 s a day, opens
story messages 15 s after they arrive and answers half the COMMS cards, and adds
the reading-time model above. Headless tests in `tests/story/pace.test.ts`,
`pacing.test.ts` and `playthrough.test.ts` check the pace setting, the quiet
window, the gaps, which cards may open by themselves, that every pace reaches
every chapter and an ending, and save continuity.
