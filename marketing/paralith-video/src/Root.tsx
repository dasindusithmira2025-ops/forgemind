import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import { Film } from './compositions/Film';
import { Poster } from './compositions/Poster';
import {
  FPS,
  HERO_FRAMES,
  TEASER_FRAMES,
  TRAILER_FRAMES,
} from './data/timing';

const hero = { cut: 'hero', narration: true, captions: false } as const;
const social = { cut: 'hero', narration: true, captions: true } as const;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="ParalithHero4K"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={3840}
      height={2160}
      defaultProps={hero}
    />
    <Composition
      id="ParalithHero1080p"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={hero}
    />
    <Composition
      id="ParalithHeroVertical"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={social}
    />
    <Composition
      id="ParalithHeroSquare"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={1080}
      height={1080}
      defaultProps={social}
    />
    <Composition
      id="ParalithTrailer30"
      component={Film}
      durationInFrames={TRAILER_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'trailer', narration: false, captions: false }}
    />
    <Composition
      id="ParalithTeaser15"
      component={Film}
      durationInFrames={TEASER_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'teaser', narration: false, captions: false }}
    />
    <Composition
      id="ParalithHeroCaptioned"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'hero', narration: true, captions: true }}
    />
    <Composition
      id="ParalithHeroClean"
      component={Film}
      durationInFrames={HERO_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'hero', narration: false, captions: false }}
    />
    <Composition
      id="ParalithPoster"
      component={Poster}
      durationInFrames={1}
      fps={FPS}
      width={3840}
      height={2160}
    />
  </>
);
