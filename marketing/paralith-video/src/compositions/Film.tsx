import React from 'react';
import { AbsoluteFill, Sequence } from 'remotion';
import { AudioBed } from '../components/AudioBed';
import { CaptionTrack } from '../components/CaptionTrack';
import { CUTS, type CutId, type SceneId } from '../data/timing';
import { Alignment } from '../scenes/Alignment';
import { Decision } from '../scenes/Decision';
import { Direction } from '../scenes/Direction';
import { Fragmentation } from '../scenes/Fragmentation';
import { Parallel } from '../scenes/Parallel';
import { Pressure } from '../scenes/Pressure';
import { Record } from '../scenes/Record';
import { Repository } from '../scenes/Repository';
import { Workspace } from '../scenes/Workspace';
import { brand } from '../styles/tokens';

export type FilmProps = {
  cut: CutId;
  narration: boolean;
  captions: boolean;
};

const SCENES: Record<SceneId, React.FC<{ duration: number; cut: CutId }>> = {
  fragmentation: Fragmentation,
  pressure: Pressure,
  alignment: Alignment,
  workspace: Workspace,
  parallel: Parallel,
  repository: Repository,
  record: Record,
  decision: Decision,
  direction: Direction,
};

export const Film: React.FC<FilmProps> = ({ cut, narration, captions }) => {
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: brand.black }}>
      {CUTS[cut].map((scene) => {
        const from = cursor;
        cursor += scene.duration;
        const Component = SCENES[scene.id];
        return (
          <Sequence
            key={`${cut}-${scene.id}`}
            from={from}
            durationInFrames={scene.duration}
            name={scene.id}
          >
            <Component duration={scene.duration} cut={cut} />
          </Sequence>
        );
      })}
      <AudioBed cut={cut} narration={narration} />
      {captions && cut === 'hero' ? <CaptionTrack /> : null}
    </AbsoluteFill>
  );
};
