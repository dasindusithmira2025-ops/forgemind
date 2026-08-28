import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { C, MONO } from "../lib/theme";
import { EASE_IN_OUT, EASE_OUT, clamp01, ramp } from "../lib/anim";
import { Headline, Label, Sub } from "../lib/type";
import { Dot } from "../lib/ui";

const LANES = [
  { y: 486, role: "architect", tree: "wt/api-contract", delay: 0 },
  { y: 606, role: "implement", tree: "wt/runtime-split", delay: 22 },
  { y: 726, role: "review", tree: "wt/pty-lifecycle", delay: 44 },
  { y: 846, role: "verify", tree: "wt/migration-0f2", delay: 66 },
];

const HUB_Y = 666;
const FAN_X = 392;
const LANE_X0 = 486;
const LANE_X1 = 1318;
const JOIN_X = 1452;

const lanePath = (y: number) =>
  "M " +
  FAN_X +
  " " +
  HUB_Y +
  " C " +
  (FAN_X + 52) +
  " " +
  HUB_Y +
  ", " +
  (LANE_X0 - 52) +
  " " +
  y +
  ", " +
  LANE_X0 +
  " " +
  y +
  " L " +
  LANE_X1 +
  " " +
  y +
  " C " +
  (LANE_X1 + 60) +
  " " +
  y +
  ", " +
  (JOIN_X - 60) +
  " " +
  HUB_Y +
  ", " +
  JOIN_X +
  " " +
  HUB_Y;

export const Swarms: React.FC = () => {
  const f = useCurrentFrame();
  const hub = ramp(f, 54, 34, EASE_OUT);
  const build = ramp(f, 348, 44, EASE_OUT);

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 132, top: 170 }}>
        <Label start={6}>Swarms</Label>
        <div style={{ height: 30 }} />
        <Headline
          start={18}
          size={58}
          lines={["Many agents. Isolated worktrees.", "One coordinated build."]}
        />
      </div>

      <div style={{ position: "absolute", left: 1180, top: 196, width: 620 }}>
        <Sub start={120} maxWidth={600} size={23}>
          Roles run in parallel on their own checkouts, so concurrent work never
          collides in a shared tree. Dependencies, state and evidence stay
          coordinated by the environment.
        </Sub>
      </div>

      <svg width={1920} height={1080} viewBox="0 0 1920 1080" style={{ position: "absolute" }}>
        <defs>
          <linearGradient id="swarm-trail" gradientUnits="userSpaceOnUse" x1={LANE_X0} y1="0" x2={LANE_X1} y2="0">
            <stop offset="0" stopColor={C.cyan} stopOpacity="0.15" />
            <stop offset="1" stopColor={C.violet} stopOpacity="0.95" />
          </linearGradient>
        </defs>

        {/* mission hub */}
        <g opacity={hub}>
          <line x1={218} y1={HUB_Y} x2={FAN_X} y2={HUB_Y} stroke={C.lineStrong} strokeWidth={1.6} />
          <circle cx={210} cy={HUB_Y} r={9} fill={C.deep} stroke={C.accent} strokeWidth={2} />
          <circle cx={210} cy={HUB_Y} r={3.4} fill={C.accent} />
          <text
            x={210}
            y={HUB_Y - 30}
            fill={C.muted}
            fontFamily={MONO}
            fontSize={15}
            letterSpacing="0.2em"
            textAnchor="middle"
          >
            MISSION
          </text>
        </g>

        {LANES.map((lane, i) => {
          const draw = ramp(f, 78 + lane.delay * 0.5, 56, EASE_OUT);
          const travel = ramp(f, 150 + lane.delay, 150, EASE_IN_OUT);
          const done = clamp01((travel - 0.97) / 0.03);
          const nodeX = interpolate(travel, [0, 1], [LANE_X0, LANE_X1]);
          return (
            <g key={i}>
              <path
                d={lanePath(lane.y)}
                fill="none"
                stroke="rgba(255,255,255,0.14)"
                strokeWidth={1.8}
                pathLength={1}
                strokeDasharray={1}
                strokeDashoffset={1 - draw}
              />
              <line
                x1={LANE_X0}
                y1={lane.y}
                x2={nodeX}
                y2={lane.y}
                stroke="url(#swarm-trail)"
                strokeWidth={3}
                opacity={0.95}
                style={{ filter: "drop-shadow(0 0 7px " + C.violet + "80)" }}
              />
              <text
                x={LANE_X0}
                y={lane.y + 34}
                fill={C.faint}
                fontFamily={MONO}
                fontSize={15}
                opacity={draw * 0.9}
              >
                {lane.tree}
              </text>
            </g>
          );
        })}

        {/* convergence */}
        <g opacity={build}>
          <circle cx={JOIN_X} cy={HUB_Y} r={10} fill={C.deep} stroke={C.violet} strokeWidth={2} />
          <line
            x1={JOIN_X + 10}
            y1={HUB_Y}
            x2={JOIN_X + 10 + 66 * build}
            y2={HUB_Y}
            stroke={C.violet}
            strokeWidth={2}
          />
        </g>
      </svg>

      {/* travelling agent nodes */}
      {LANES.map((lane, i) => {
        const travel = ramp(f, 150 + lane.delay, 150, EASE_IN_OUT);
        const appear = ramp(f, 142 + lane.delay, 30, EASE_OUT);
        const done = clamp01((travel - 0.94) / 0.06);
        const nodeX = interpolate(travel, [0, 1], [LANE_X0, LANE_X1]);
        const pulse = 0.5 + 0.5 * Math.sin(f * 0.14 + i);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: nodeX - 88,
              top: lane.y - 22,
              width: 176,
              height: 44,
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "0 14px",
              borderRadius: 7,
              background: "linear-gradient(180deg, " + C.s3 + ", " + C.s2 + ")",
              border: "1px solid " + (done ? C.success + "66" : C.agent + "66"),
              boxShadow: done
                ? "0 0 22px -6px " + C.success + "80"
                : "0 0 " + (18 + pulse * 16) + "px -6px " + C.agent + "aa",
              fontFamily: MONO,
              fontSize: 15,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
              color: done ? C.text2 : C.text,
              opacity: appear,
              transform: "scale(" + (0.9 + appear * 0.1) + ")",
            }}
          >
            <Dot color={done ? C.success : C.agent} pulse={done ? 0 : pulse} />
            {lane.role}
          </div>
        );
      })}

      {/* the build */}
      <div
        style={{
          position: "absolute",
          left: JOIN_X + 84,
          top: HUB_Y - 38,
          padding: "18px 26px",
          borderRadius: 9,
          border: "1px solid " + C.violet + "55",
          background: "linear-gradient(180deg, " + C.s3 + ", " + C.s1 + ")",
          boxShadow: "0 0 60px -18px " + C.violet + "cc",
          fontFamily: MONO,
          fontSize: 19,
          letterSpacing: "0.26em",
          textTransform: "uppercase",
          color: C.text,
          opacity: build,
          transform: "scale(" + (0.92 + build * 0.08) + ")",
        }}
      >
        one build
      </div>

      <div
        style={{
          position: "absolute",
          left: 132,
          top: 966,
          fontFamily: MONO,
          fontSize: 16,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: C.muted,
          opacity: ramp(f, 366, 40),
          display: "flex",
          gap: 30,
        }}
      >
        <span>no shared working tree</span>
        <span style={{ color: C.faint }}>·</span>
        <span>no agent overwrites another</span>
      </div>
    </AbsoluteFill>
  );
};
