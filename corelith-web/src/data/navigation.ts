import { NavItem, NavLink } from '@/types';

/**
 * The primary navigation.
 *
 * Structure and metrics follow BridgeMind's navbar: a 520px panel anchored to
 * the left edge of its trigger, split `1fr / 1px / 1fr` by a literal divider
 * column, destinations ruled down the left under a small tracked heading, and a
 * summary with an action on the right.
 *
 * The right column states things a reader can check. It is the one place the
 * reference does something we cannot follow — theirs prints follower counts,
 * and we have no such numbers to print.
 */
export const mainNav: NavItem[] = [
  {
    kind: 'menu',
    id: 'paralith',
    label: 'Paralith',
    href: '/products/paralith',
    heading: 'Product',
    items: [
      { label: 'Overview', href: '/products/paralith', description: 'What it is, and who for' },
      {
        label: 'Capabilities',
        href: '/products/paralith#capabilities',
        description: 'Six things it takes on',
      },
      { label: 'How a task runs', href: '/technology', description: 'Sentence to approved change' },
      {
        label: 'Downloads',
        href: '/products/paralith#download',
        description: 'Signed builds, all platforms',
        badge: 'v0.9.4',
      },
      {
        label: 'Release notes',
        href: '/products/paralith#release-notes',
        description: 'What changed this preview',
      },
      {
        label: 'Questions',
        href: '/products/paralith#faq',
        description: 'Privacy, models, platforms',
      },
    ],
    aside: {
      heading: 'Built to be checked',
      body: 'Several agents work in parallel on your own machine. Nothing they write reaches your project until its checks pass and you approve it.',
      facts: ['v0.9.4 preview', 'Windows · macOS · Linux', 'Telemetry off by default'],
      cta: { label: 'Get Paralith', href: '/products/paralith#download' },
    },
  },
  {
    kind: 'link',
    label: 'How it works',
    href: '/technology',
    description: 'What working with Paralith is actually like',
  },
  {
    kind: 'menu',
    id: 'company',
    label: 'Company',
    href: '/company',
    heading: 'Corelith',
    items: [
      { label: 'About Corelith', href: '/company', description: 'Mission, scope, standards' },
      { label: 'Security & trust', href: '/security', description: 'Data, releases, disclosure' },
      { label: 'Careers', href: '/careers', description: 'Culture and open roles' },
      { label: 'Contact', href: '/contact', description: 'Reach the engineering team' },
    ],
    aside: {
      heading: 'Corelith Technologies',
      body: 'An independent, product-led software company building tools for developers, systems engineers, and engineering teams.',
      facts: ['Independent & product-led', 'Global / distributed', 'Coordinated disclosure'],
      cta: { label: 'Contact engineering', href: '/contact' },
    },
  },
];

/**
 * Flat list of every destination in the primary nav, in reading order. The
 * mobile drawer nests nothing — screen-reader users get one ordered set — so it
 * builds from this rather than walking the panel tree.
 */
export const mainNavLinks: NavLink[] = mainNav.flatMap((entry) =>
  entry.kind === 'link'
    ? [{ label: entry.label, href: entry.href, description: entry.description }]
    : entry.items.map((item) => ({
        label: item.label,
        href: item.href,
        description: item.description,
        badge: item.badge,
      })),
);

export const footerLinks = {
  products: [
    { label: 'Paralith Overview', href: '/products/paralith', badge: 'Preview' },
    { label: 'Downloads', href: '/products/paralith#download' },
    { label: 'Release Notes', href: '/products/paralith#release-notes' },
    { label: 'How it works', href: '/technology' },
  ],
  company: [
    { label: 'About Corelith', href: '/company' },
    { label: 'Engineering Standards', href: '/company#philosophy' },
    { label: 'How Paralith works', href: '/technology' },
    { label: 'Careers', href: '/careers' },
    { label: 'Contact', href: '/contact' },
  ],
  trust: [
    { label: 'Security Center', href: '/security' },
    { label: 'Vulnerability Disclosure', href: '/security#disclosure' },
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Terms of Service', href: '/legal/terms' },
  ],
};
