import { CompanyPrinciple } from '@/types';

export const companyData = {
  mission: 'Building powerful software for the people shaping what comes next.',
  tagline:
    'Corelith Technologies creates intelligent products, developer platforms, and digital systems designed to turn complex work into focused, high-leverage execution.',
  about:
    'Corelith Technologies is an independent, product-led software company creating tools for developers, systems engineers, businesses, and digital teams. We combine software engineering discipline, intelligent automation, and human-centered interface design to build systems that remain useful long after the novelty fades.',

  principles: [
    {
      title: 'Evidence over assumptions',
      subtitle: 'VERIFIABLE OUTCOMES',
      description:
        'Anything our software recommends or changes has to be backed by something we can point at. We do not ship claims we have not checked.',
    },
    {
      title: 'Human control where decisions matter',
      subtitle: 'HIGH-LEVERAGE AGENCY',
      description:
        'Automate the tedious parts and leave the judgement to people. You keep approval over what changes, and a way back if you change your mind.',
    },
    {
      title: 'Security by design',
      subtitle: 'LOCAL-FIRST TRUST',
      description:
        'Your work stays yours. Keeping data on your machine, collecting as little as possible, and defaulting to private are starting conditions, not settings.',
    },
    {
      title: 'Performance as a primary feature',
      subtitle: 'ZERO WASTED CYCLES',
      description:
        'Software should feel immediate. We treat speed as something to be measured and defended in every release, not tuned once and forgotten.',
    },
    {
      title: 'Interfaces built for mental clarity',
      subtitle: 'RESTRAINED CRAFTSMANSHIP',
      description:
        'We cut visual noise, gimmicks, and decoration that carries no meaning. Our interfaces are built for long, focused stretches of work.',
    },
    {
      title: 'Systems designed to scale',
      subtitle: 'LONG-TERM DURABILITY',
      description:
        'We build products meant to be maintained for years, not demoed once. That shapes what we take on and what we deliberately leave out.',
    },
  ] as CompanyPrinciple[],

  capabilities: [
    {
      category: 'Agentic Software Systems',
      description:
        'Products where several AI agents work on real tasks together, with a person deciding what actually lands.',
    },
    {
      category: 'Developer Infrastructure',
      description:
        'Fast native desktop software that behaves like a tool you own rather than a page you visit.',
    },
    {
      category: 'Verification & Code Integrity',
      description:
        'Automatic checking, so that what our software produces can be trusted before anyone depends on it.',
    },
    {
      category: 'Local-First Security Engineering',
      description:
        'Products that keep your work on your machine by default, and releases you can verify before you install them.',
    },
  ],
};
