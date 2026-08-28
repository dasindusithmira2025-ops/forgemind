import React from "react";
import { Composition } from "remotion";
import "./fonts/fonts.css";
import { Film } from "./Film";
import { FPS, TOTAL } from "./timeline";

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ParalithPromo"
    component={Film}
    durationInFrames={TOTAL}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
