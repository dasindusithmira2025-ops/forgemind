export const brand = {
  black: '#04060b',
  graphite: '#090b11',
  panel: '#0f1118',
  panelRaised: '#151821',
  panelHigh: '#1b1f2a',
  white: '#f7f8fb',
  text: '#e7e9ef',
  muted: '#949aa8',
  faint: '#5c6270',
  line: 'rgba(255,255,255,0.085)',
  lineStrong: 'rgba(255,255,255,0.17)',
  cyan: '#22d3ee',
  blue: '#4f6bff',
  violet: '#9b6cff',
  success: '#67d391',
  warning: '#efb64e',
  danger: '#f16b70',
} as const;

export const roles = {
  coordinator: '#648fff',
  scout: '#40b0a6',
  builder: '#785ef0',
  reviewer: '#ffb000',
  debugger: '#fe6100',
  integrator: '#dc267f',
} as const;

export const font = {
  ui: '"Geist", "Segoe UI Variable", "Segoe UI", sans-serif',
  mono: '"Geist", "Cascadia Code", Consolas, monospace',
} as const;

export const spectrum = `linear-gradient(90deg, ${brand.cyan}, ${brand.blue} 52%, ${brand.violet})`;
