import React from 'react';
import { Composition } from 'remotion';
import './fonts';
import './brand-fonts';
import { Film } from './compositions/Film';
import { Poster } from './compositions/Poster';
import { TwinProof } from './product/TwinProof';
import { CampaignFilm } from './campaign/CampaignFilm';
import { CampaignPoster } from './campaign/Poster';
import { CUT_FRAMES } from './campaign/script';
import {
  ResumeProof,
  SwarmCanvasProof,
  SwarmEvidenceProof,
  SwarmTasksProof,
} from './product/SurfaceProof';
import { BrandFilm } from './film/BrandFilm';
import { DURATION } from './film/script';
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

    {/*
      The brand film. `src/film` + `src/product`; see BrandFilm.tsx. The compositions above are
      the earlier narrated explainer cut and are left registered so its delivered masters stay
      reproducible from source.
    */}
    <Composition
      id="ParalithBrandFilm4K"
      component={BrandFilm}
      durationInFrames={DURATION}
      fps={FPS}
      width={3840}
      height={2160}
    />
    <Composition
      id="ParalithBrandFilm1080p"
      component={BrandFilm}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
    />
    <Composition
      id="ParalithBrandFilmSilent"
      component={BrandFilm}
      durationInFrames={DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ score: false }}
    />

    {/*
      The campaign cut — the master brand film. `src/campaign`; see CampaignFilm.tsx. The brand
      compositions above are the earlier eight-beat cut and the ones above those are the narrated
      explainer; both are left registered so their delivered masters stay reproducible from source.
    */}
    <Composition
      id="ParalithCampaign4K"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.master}
      fps={FPS}
      width={3840}
      height={2160}
      defaultProps={{ cut: 'master' as const, copy: 'cinematic' as const }}
    />
    <Composition
      id="ParalithCampaign1080p"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.master}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'master' as const, copy: 'cinematic' as const }}
    />
    <Composition
      id="ParalithCampaignCaptioned"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.master}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'master' as const, copy: 'captioned' as const }}
    />
    <Composition
      id="ParalithCampaign60"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.sixty}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'sixty' as const, copy: 'cinematic' as const }}
    />
    <Composition
      id="ParalithCampaign30"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.thirty}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'thirty' as const, copy: 'cinematic' as const }}
    />
    <Composition
      id="ParalithCampaign15"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.teaser}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'teaser' as const, copy: 'cinematic' as const }}
    />
    <Composition
      id="ParalithCampaignVertical30"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.thirty}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ cut: 'thirty' as const, copy: 'captioned' as const }}
    />
    {/*
      The full-length 9:16 adaptation. Registered so it renders without a code change, but not in
      the default delivery batch: a ninety-five second vertical is longer than any social surface
      will autoplay, and the thirty-second vertical above is the asset that actually gets used.
    */}
    <Composition
      id="ParalithCampaignVertical"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.master}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ cut: 'master' as const, copy: 'captioned' as const }}
    />
    {/* The website hero loop: silent, captionless, and cut to loop cleanly. */}
    <Composition
      id="ParalithCampaignLoop"
      component={CampaignFilm}
      durationInFrames={CUT_FRAMES.loop}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ cut: 'loop' as const, copy: 'none' as const, score: false }}
    />
    <Composition
      id="ParalithCampaignPoster"
      component={CampaignPoster}
      durationInFrames={1}
      fps={FPS}
      width={3840}
      height={2160}
    />

    {/* Calibration surfaces for the product twin — not part of any cut. See TwinProof.tsx. */}
    <Composition
      id="ParalithTwinProof"
      component={TwinProof}
      durationInFrames={600}
      fps={FPS}
      width={1440}
      height={900}
    />
    <Composition
      id="ParalithSwarmCanvasProof"
      component={SwarmCanvasProof}
      durationInFrames={1}
      fps={FPS}
      width={1440}
      height={900}
    />
    <Composition
      id="ParalithSwarmTasksProof"
      component={SwarmTasksProof}
      durationInFrames={1}
      fps={FPS}
      width={1440}
      height={900}
    />
    <Composition
      id="ParalithSwarmEvidenceProof"
      component={SwarmEvidenceProof}
      durationInFrames={1}
      fps={FPS}
      width={1440}
      height={900}
    />
    <Composition
      id="ParalithResumeProof"
      component={ResumeProof}
      durationInFrames={1}
      fps={FPS}
      width={1440}
      height={900}
    />
  </>
);
