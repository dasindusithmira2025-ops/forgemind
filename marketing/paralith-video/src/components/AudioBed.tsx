import React from 'react';
import { Audio, Sequence, staticFile } from 'remotion';
import type { CutId, SceneId } from '../data/timing';
import { CUTS, NARRATION_OFFSETS, sceneStarts } from '../data/timing';

const VOICE_RANGES = [
  [60, 286],
  [456, 720],
  [1038, 1280],
  [1428, 1870],
  [2082, 2600],
  [2802, 3384],
  [3468, 3924],
  [4062, 4400],
  [4596, 4892],
] as const;

const scoreVolume = (frame: number, narration: boolean) => {
  if (!narration) return 0.82;
  let duck = 0;
  for (const [from, to] of VOICE_RANGES) {
    const attack = Math.max(0, Math.min(1, (frame - (from - 14)) / 14));
    const release = Math.max(0, Math.min(1, ((to + 18) - frame) / 18));
    duck = Math.max(duck, Math.min(attack, release));
  }
  return 0.82 - duck * 0.58;
};

export const AudioBed: React.FC<{ cut: CutId; narration: boolean }> = ({ cut, narration }) => {
  const score =
    cut === 'hero'
      ? 'audio/paralith-score.mp3'
      : cut === 'trailer'
        ? 'audio/paralith-trailer-score.mp3'
        : 'audio/paralith-teaser-score.mp3';

  return (
    <>
      <Audio
        src={staticFile(score)}
        volume={(frame) => scoreVolume(frame, narration && cut === 'hero')}
      />
      {narration && cut === 'hero'
        ? CUTS.hero.map((scene) => {
            const starts = sceneStarts('hero') as Record<SceneId, number>;
            return (
              <Sequence
                key={scene.id}
                from={starts[scene.id] + NARRATION_OFFSETS[scene.id]}
                name={`voice-${scene.id}`}
              >
                <Audio src={staticFile(`audio/voice/${scene.id}.mp3`)} volume={0.92} />
              </Sequence>
            );
          })
        : null}
    </>
  );
};
