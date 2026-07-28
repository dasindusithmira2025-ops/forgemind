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
        'Every optimization, recommendation, or code modification produced by our software must be empirically backed by benchmarks, test runs, and clear logs. We do not ship unverified claims.',
    },
    {
      title: 'Human control where decisions matter',
      subtitle: 'HIGH-LEVERAGE AGENCY',
      description:
        'Automate tedious execution, repetitive boilerplate, and workspace coordination—while giving developers explicit approval authority, transparent boundary controls, and instantaneous rollbacks.',
    },
    {
      title: 'Security by design',
      subtitle: 'LOCAL-FIRST TRUST',
      description:
        'Treat user privacy and code isolation as non-negotiable foundations. Local storage, air-gapped support, data minimization, and encrypted pipelines come standard across our product suite.',
    },
    {
      title: 'Performance as a primary feature',
      subtitle: 'ZERO WASTED CYCLES',
      description:
        'Software should feel immediate. We measure millisecond latency, memory footprint, binary sizes, and rendering frames with uncompromising rigor.',
    },
    {
      title: 'Interfaces built for mental clarity',
      subtitle: 'RESTRAINED CRAFTSMANSHIP',
      description:
        'We eliminate visual noise, flashy gimmicks, and superfluous decoration. Our interfaces prioritize information density, typographic rhythm, and deep focused work.',
    },
    {
      title: 'Systems designed to scale',
      subtitle: 'LONG-TERM DURABILITY',
      description:
        'We build software platforms using robust typed architectures, modular boundaries, and clean maintenance paths engineered for years of reliable operation.',
    },
  ] as CompanyPrinciple[],

  capabilities: [
    {
      category: 'Agentic Software Systems',
      description:
        'Multi-agent coordination, persistent codebase indexing, workspace context retrieval, and continuous automated verification pipelines.',
    },
    {
      category: 'Developer Infrastructure',
      description:
        'Native desktop tools, low-latency terminal integration, multi-window layout engines, and cross-platform native binaries.',
    },
    {
      category: 'System Performance Engineering',
      description:
        'Hardware-aware OS scheduling, I/O latency reduction, safe memory management, and baseline benchmark tracking.',
    },
    {
      category: 'Enterprise Operations Software',
      description:
        'Multi-tenant entity governance, immutable audit logging, role-based security access, and financial reporting workflows.',
    },
  ],
};
