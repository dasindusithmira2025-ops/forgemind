import { Product } from '@/types';

export const products: Product[] = [
  {
    id: 'paralith',
    slug: 'paralith',
    name: 'Paralith',
    tagline: 'Development, coordinated.',
    category: 'Agentic Developer Environment',
    status: 'Early Access',
    isFlagship: true,
    shortDescription:
      'A development environment where several AI agents work on your project at once — and nothing they write reaches your code until it has passed its checks and you have approved it.',
    fullDescription:
      'Paralith brings your projects, your terminals, and a team of AI agents into one workspace. You describe what you want in your own words, agents take it on in parallel, and you review a plain summary of what changed before any of it lands.',
    targetAudience: [
      'Senior Software Engineers',
      'Full-Stack & Systems Architects',
      'AI & Agentic Systems Developers',
      'Technical Leads & Engineering Teams',
    ],
    capabilities: [
      {
        title: 'Several agents, working at once',
        description:
          'Hand over more than one job at a time. Agents take them on in parallel while you keep working in the window you were already in.',
        highlight: 'Work in parallel',
      },
      {
        title: 'It remembers your project',
        description:
          'Paralith carries what it knows about your project from one session to the next, so you are not re-explaining the same background every time you sit down.',
        highlight: 'No re-explaining',
      },
      {
        title: 'Terminals that are part of the work',
        description:
          'Run commands where the work is happening, and let agents use the same terminals you do — with anything destructive stopping to ask you first.',
        highlight: 'You approve first',
      },
      {
        title: 'Nothing lands unchecked',
        description:
          'Every change an agent makes is checked before it can reach your project. If a check fails, the change waits for you instead of going in anyway.',
        highlight: 'Checked before it lands',
      },
      {
        title: 'Spreads across your monitors',
        description:
          'Pull any panel out into its own window and arrange the workspace across as many displays as you actually have on your desk.',
        highlight: 'Built for real desks',
      },
      {
        title: 'Your code stays yours',
        description:
          'Your code and your project history stay on your machine. Nothing is uploaded for training, and telemetry stays off unless you turn it on.',
        highlight: 'Stays on your machine',
      },
    ],
    platforms: ['Windows', 'macOS', 'Linux'],
    downloads: [
      {
        platform: 'Windows',
        version: 'v0.9.4-preview',
        architecture: 'x64 (64-bit)',
        fileSize: '118 MB',
        releaseDate: '2026-07-15',
        checksumSha256: '9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e',
        minOsVersion: 'Windows 10 / Windows 11 (22H2+)',
        available: true,
        releaseNotesUrl: '/products/paralith#release-notes',
      },
      {
        platform: 'macOS',
        version: 'v0.9.4-preview',
        architecture: 'Apple Silicon (M1/M2/M3/M4) & Intel',
        fileSize: '124 MB',
        releaseDate: '2026-07-15',
        checksumSha256: 'a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0',
        minOsVersion: 'macOS 13.0 (Ventura) or later',
        available: true,
        releaseNotesUrl: '/products/paralith#release-notes',
      },
      {
        platform: 'Linux',
        version: 'v0.9.4-preview',
        architecture: 'x86_64 (.AppImage / .deb)',
        fileSize: '112 MB',
        releaseDate: '2026-07-15',
        checksumSha256: 'f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e9',
        minOsVersion: 'Ubuntu 22.04 LTS / Fedora 38+',
        available: true,
        releaseNotesUrl: '/products/paralith#release-notes',
      },
    ],
    heroVisualType: 'paralith-system',
    primaryCtaText: 'Download Paralith Preview',
    secondaryCtaText: 'Request Early Access',
    faqs: [
      {
        question: 'Is Paralith an AI code editor, or something else?',
        answer:
          'Something else. Paralith is built for whole pieces of work rather than line-by-line autocomplete: you hand over a task, several agents take it on at once, and you review what came back before it lands.',
      },
      {
        question: 'Does my source code get used to train models?',
        answer:
          'No. Your code stays on your machine, and nothing about your project is used for training. Telemetry is off unless you deliberately turn it on.',
      },
      {
        question: 'Can I use my own models instead?',
        answer:
          'Yes. You can point Paralith at models running locally on your own machine, or at a private endpoint your organisation controls.',
      },
      {
        question: 'What platforms are supported?',
        answer:
          'Paralith ships native desktop builds for Windows, macOS (Apple Silicon and Intel), and Linux.',
      },
    ],
  },
];
