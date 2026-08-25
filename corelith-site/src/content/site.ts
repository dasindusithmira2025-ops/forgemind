/**
 * Verified company facts only.
 *
 * Everything in this file is checkable against the repository, the shipped
 * product, or Corelith's own mail domain. Values the previous site carried that
 * could not be verified — social profiles, a legal jurisdiction, download
 * checksums, platform coverage, install counts — are deliberately absent rather
 * than restated. If a fact belongs on the site and is missing here, it needs an
 * owner to confirm it first.
 */

export const site = {
  name: "Corelith Technologies",
  short: "Corelith",
  domain: "https://www.corelithtechnologies.com",

  // The positioning line. Corelith engineers systems for clients and develops
  // its own products; neither half is subordinate to the other.
  statement: "We engineer what comes next.",
  descriptor:
    "Corelith Technologies is an engineering company. We design and build advanced software, AI systems, automation and infrastructure for the organisations that hire us — and we develop technology products of our own.",

  email: {
    general: "contact@corelithtechnologies.com",
    security: "security@corelithtechnologies.com",
    careers: "careers@corelithtechnologies.com",
    press: "press@corelithtechnologies.com",
  },

  // Distributed engineering is accurate and does not claim offices Corelith
  // does not have.
  presence: "Distributed engineering team",

  legal: {
    entity: "Corelith Technologies",
    updated: "August 2026",
  },
} as const;

export type NavItem = {
  label: string;
  href: string;
  summary?: string;
  children?: { label: string; href: string; summary: string }[];
};

export const nav: NavItem[] = [
  {
    label: "Capabilities",
    href: "/capabilities",
    summary: "What Corelith is hired to build.",
    children: [
      {
        label: "Product Engineering",
        href: "/capabilities/product-engineering",
        summary: "Strategy through production software.",
      },
      {
        label: "AI Systems",
        href: "/capabilities/ai-systems",
        summary: "Agents, retrieval, local inference, evaluation.",
      },
      {
        label: "Automation",
        href: "/capabilities/automation",
        summary: "Operational workflows that hold their own state.",
      },
      {
        label: "Experience Engineering",
        href: "/capabilities/experience-engineering",
        summary: "Web, desktop and interfaces built for long sessions.",
      },
      {
        label: "Infrastructure",
        href: "/capabilities/infrastructure",
        summary: "Backends, data, APIs, delivery pipelines.",
      },
      {
        label: "Technology Strategy",
        href: "/capabilities/technology-strategy",
        summary: "Architecture, feasibility, technical direction.",
      },
    ],
  },
  { label: "Work", href: "/work", summary: "Systems we have built and shipped." },
  { label: "Products", href: "/products", summary: "Technology Corelith develops for itself." },
  { label: "Research", href: "/research", summary: "The problems we are working on next." },
  { label: "Company", href: "/company", summary: "How Corelith is built and how it operates." },
];

export const footerNav = [
  {
    heading: "Capabilities",
    links: [
      { label: "Product Engineering", href: "/capabilities/product-engineering" },
      { label: "AI Systems", href: "/capabilities/ai-systems" },
      { label: "Automation", href: "/capabilities/automation" },
      { label: "Experience Engineering", href: "/capabilities/experience-engineering" },
      { label: "Infrastructure", href: "/capabilities/infrastructure" },
      { label: "Technology Strategy", href: "/capabilities/technology-strategy" },
    ],
  },
  {
    heading: "Work & Products",
    links: [
      { label: "Selected work", href: "/work" },
      { label: "Products", href: "/products" },
      { label: "Paralith", href: "/products/paralith" },
      { label: "Research", href: "/research" },
      { label: "Insights", href: "/insights" },
    ],
  },
  {
    heading: "Company",
    links: [
      { label: "About Corelith", href: "/company" },
      { label: "Careers", href: "/careers" },
      { label: "Contact", href: "/contact" },
      { label: "Start a project", href: "/start-a-project" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Security contact", href: "/contact#security" },
    ],
  },
] as const;
