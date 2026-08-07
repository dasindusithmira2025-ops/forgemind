# PARALITH campaign film — voiceover script

The delivered film has **no narration**. It carries its copy as type over an original score, for the
reason set out in [`CAMPAIGN_FILM.md`](CAMPAIGN_FILM.md#why-there-is-no-narration): the only voice
this workstation can synthesise is the Windows `System.Speech` one, and a synthetic voice reading
marketing copy is the single loudest signal that nobody was in the room when a film was made.

This document exists so a narrated version can be produced without re-cutting anything. Every line
below is timed against the locked edit. Record it, drop it on the timeline at the stated in-points,
and render `ParalithCampaignClean`-style compositions with the type suppressed — the edit does not
move.

## Direction

Grounded, intelligent, understated. Close-mic, slightly intimate, as if explaining something to one
person who already knows the field.

Not: movie-trailer theatrical. Not: bright and upbeat. No inspirational pause after every clause. No
rising inflection on the statements — they are statements. The audience is technically literate and
the script does not explain what a terminal is; read it at the speed you would read it to a
colleague, not the speed you would read it to a stadium.

The two lines that carry the film are **"Completion is a claim. Evidence is not."** and
**"Build beyond the editor."** Everything before the first is setup; everything after it is
consequence. Neither needs to be pushed.

## Script

104 words. Timings are in the master's frames at 60fps and in `mm:ss`.

| In | Frame | Line | Sequence |
| --- | ---: | --- | --- |
| 0:02.5 | 150 | Software development gained intelligence. | `fragments` |
| 0:06.7 | 400 | The workflow it arrived into did not. | `fragments` |
| 0:15.0 | 900 | Paralith is one environment for the people and the agents building together. | `arrival` |
| 0:24.5 | 1470 | Describe the outcome you want. | `direct` |
| 0:29.0 | 1740 | Paralith structures the work — staffed, sequenced, and isolated. | `direct` |
| 0:38.0 | 2280 | Six agents run at once, each in its own worktree. | `parallel` |
| 0:44.0 | 2640 | And one place knows which of them is waiting on you, and for how long. | `parallel` |
| 0:53.8 | 3230 | Every change stays attached to its branch, its agent, and its purpose. | `repository` |
| 1:05.7 | 3940 | Because completion is a claim. | `proof` |
| 1:10.0 | 4200 | Evidence is something you can inspect, run, and prove. | `proof` |
| 1:17.2 | 4630 | The machine restarts. The session does not start over. | `continuity` |
| 1:29.0 | 5340 | Paralith. Build beyond the editor. | `close` |

## Notes for the session

- The line at 0:15 is the only place the product is named before the endcard. It sits under the
  wordmark and should land as the mark settles, not before it.
- "Six agents run at once" is timed to the canvas already holding six. Do not anticipate it.
- The pair at 1:05.7 and 1:10.0 want the gap between them. It is four seconds and it is the point.
- The last line has the whole endcard to itself. There is no music cue to beat.

## If a narrated cut is produced

Set `copy` to a mode that suppresses the type — the film's statements and the narration say the same
things, and a viewer should not be made to read and listen to the same sentence at once. The
existing `none` mode does exactly this, and the caption sidecars in `media/exports/` already carry
the on-screen statements for accessibility.

The score was mixed for a film with no voice in it. A narrated version needs the score ducked around
each line; `scripts/build-campaign-score.mjs` takes the cue table it would need — add the
narration in-points above as duck points rather than compressing against a live vocal.
