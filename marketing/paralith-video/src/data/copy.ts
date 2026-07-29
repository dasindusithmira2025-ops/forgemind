import type { SceneId } from './timing';

export const COPY = {
  fragmentation: {
    primary: 'Development changed.',
    secondary: 'The environment didn’t.',
  },
  pressure: {
    primary: 'Tools everywhere.',
    secondary: 'Control nowhere.',
  },
  alignment: {
    primary: 'Meet PARALITH.',
    secondary: 'The agentic development environment.',
  },
  workspace: {
    primary: 'One environment.',
    secondary: 'Complete control.',
  },
  parallel: {
    primary: 'Parallel execution.',
    secondary: 'Human control.',
  },
  repository: {
    primary: 'Repository intelligence.',
    secondary: 'Inside the workspace.',
  },
  record: {
    primary: 'Context stays attached.',
    secondary: '',
  },
  decision: {
    primary: 'Intelligence, with accountability.',
    secondary: '',
  },
  direction: {
    primary: 'Don’t just code with agents.',
    secondary: 'Direct them.',
  },
} satisfies Record<SceneId, { primary: string; secondary: string }>;

export const NARRATION: Record<SceneId, string> = {
  fragmentation: 'Development changed. The environment didn’t.',
  pressure: 'Development moves faster. Control is scattered everywhere.',
  alignment: 'Meet PARALITH. The agentic development environment.',
  workspace:
    'PARALITH brings projects, agents, terminals, repositories, and development workflows into one operational workspace.',
  parallel:
    'Run specialized agents in parallel. Isolate their work. Track their state. Focus where human judgment is needed.',
  repository:
    'Review every change. Branches, diffs, pull requests, workflows, releases, and risks, without leaving the workspace.',
  record:
    'Tasks, attempts, sources, tests, and evidence stay attached to the work, so context survives every handoff.',
  decision: 'Automate the work. Preserve the evidence. Keep the final decision human.',
  direction: 'Don’t just code with agents. Direct them. PARALITH.',
};

export type CaptionCue = {
  from: number;
  to: number;
  text: string;
};

export const CAPTIONS: readonly CaptionCue[] = [
  { from: 60, to: 186, text: 'Development changed.' },
  { from: 205, to: 360, text: 'The environment didn’t.' },
  { from: 456, to: 665, text: 'Development moves faster.' },
  { from: 670, to: 920, text: 'Control is scattered everywhere.' },
  { from: 1038, to: 1164, text: 'Meet PARALITH.' },
  { from: 1168, to: 1340, text: 'The agentic development environment.' },
  { from: 1428, to: 1674, text: 'PARALITH brings projects, agents, terminals, repositories,' },
  { from: 1677, to: 1972, text: 'and development workflows into one operational workspace.' },
  { from: 2082, to: 2240, text: 'Run specialized agents in parallel.' },
  { from: 2244, to: 2394, text: 'Isolate their work. Track their state.' },
  { from: 2398, to: 2690, text: 'Focus where human judgment is needed.' },
  { from: 2802, to: 2936, text: 'Review every change.' },
  { from: 2940, to: 3140, text: 'Branches, diffs, pull requests, workflows,' },
  { from: 3144, to: 3380, text: 'releases, and risks—without leaving the workspace.' },
  { from: 3468, to: 3678, text: 'Tasks, attempts, sources, tests, and evidence stay attached to the work,' },
  { from: 3682, to: 3972, text: 'so context survives every handoff.' },
  { from: 4062, to: 4200, text: 'Automate the work.' },
  { from: 4204, to: 4340, text: 'Preserve the evidence.' },
  { from: 4344, to: 4518, text: 'Keep the final decision human.' },
  { from: 4596, to: 4700, text: 'Don’t just code with agents.' },
  { from: 4704, to: 4770, text: 'Direct them.' },
  { from: 4774, to: 4860, text: 'PARALITH.' },
];

export const TRAILER_COPY = {
  opening: 'Development changed.',
  reveal: 'Meet PARALITH.',
  parallel: 'Parallel execution. Human control.',
  repository: 'Understand every change.',
  close: 'Direct them.',
} as const;

export const TEASER_COPY = {
  opening: 'The environment didn’t.',
  reveal: 'Until now.',
  close: 'Direct them.',
} as const;
