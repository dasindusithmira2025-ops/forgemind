/**
 * The product's own display vocabulary, transcribed.
 *
 * The stylesheet and the palette are generated from PARALITH's source (see
 * `scripts/sync-product-ui.mjs`), but these four functions are ordinary pure formatters that
 * would have dragged half the desktop module graph into the film's bundle to import directly.
 * They are short enough to carry verbatim, and they are the strings a viewer actually reads:
 * a wait rendered as "4 min" instead of the product's "4m" is a small lie in a film whose whole
 * claim is that it is showing the real thing.
 *
 * Sources, all under `Paralith-tauri/src`:
 *   waitLabel, waitPressure, fleetStateLabel, agentStateLabel  ->  features/fleet/fleetSelectors.ts
 *   providerLabel                                              ->  shared/layout.ts
 */

/** `Paralith-tauri/src/shared/layout.ts` — providerLabel. */
export function providerLabel(provider: string): string {
  return (
    {
      claude: 'Claude Code',
      codex: 'Codex CLI',
      opencode: 'OpenCode',
      powershell: 'PowerShell',
      command_prompt: 'Command Prompt',
      wsl: 'WSL',
      custom_shell: 'Custom shell',
    }[provider] ?? provider
  );
}

/** `fleetSelectors.ts` — waitLabel. Seconds, then minutes, then hours; never a unit in between. */
export function waitLabel(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${minutes % 60 > 0 ? `${minutes % 60}m` : ''}`;
}

/** `fleetSelectors.ts` — PRESSURE_STEPS. 0s / 30s / 2m / 10m. */
export const PRESSURE_STEPS = [0, 30_000, 2 * 60_000, 10 * 60_000] as const;

/**
 * `fleetSelectors.ts` — waitPressure. Four discrete steps, which is what makes the Fleet Bar's
 * height carry the signal without relying on hue at a 3px scale.
 */
export function waitPressure(ms: number): 1 | 2 | 3 | 4 {
  if (ms >= PRESSURE_STEPS[3]) return 4;
  if (ms >= PRESSURE_STEPS[2]) return 3;
  if (ms >= PRESSURE_STEPS[1]) return 2;
  return 1;
}

export type FleetCellState = 'waiting' | 'blocked' | 'working' | 'paused' | 'idle';

/** `fleetSelectors.ts` — fleetStateLabel. */
export function fleetStateLabel(state: FleetCellState): string {
  return state;
}

export type AgentActivityState =
  | 'working'
  | 'needs_input'
  | 'needs_permission'
  | 'idle'
  | 'finished'
  | 'failed';

/** `fleetSelectors.ts` — agentStateLabel. Two runtime states collapse onto one word, "waiting". */
export function agentStateLabel(state: AgentActivityState): string {
  if (state === 'needs_input' || state === 'needs_permission') return 'waiting';
  if (state === 'failed') return 'blocked';
  if (state === 'finished') return 'finished';
  return state;
}

/** The Fleet Bar's view of a runtime state, used to pick the cell's `state-` modifier. */
export function fleetStateOf(state: AgentActivityState): FleetCellState {
  if (state === 'needs_input' || state === 'needs_permission') return 'waiting';
  if (state === 'failed') return 'blocked';
  if (state === 'working') return 'working';
  return 'idle';
}
