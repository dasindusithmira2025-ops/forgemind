import { NavItem, NavLink } from '@/types';

/**
 * The primary navigation.
 *
 * Two of the three entries open a panel rather than navigating: a ruled list of
 * destinations on the left, and on the right a facts panel stating the current
 * state of whatever the panel covers. The right-hand column is deliberately not
 * a promotional slot — it prints values the reader can check (release, targets,
 * telemetry) so the menu carries the same evidential register as the pages it
 * leads to.
 */
export const mainNav: NavItem[] = [
  {
    kind: 'menu',
    id: 'paralith',
    label: 'Paralith',
    href: '/products/paralith',
    columnKicker: 'Product',
    items: [
      {
        label: 'Overview',
        href: '/products/paralith',
        description: 'What Paralith is, and who it is built for.',
      },
      {
        label: 'Capabilities',
        href: '/products/paralith#capabilities',
        description: 'Six things it takes off your hands, and one it never takes.',
      },
      {
        label: 'How a task runs',
        href: '/technology',
        description: 'From your sentence to an approved change, step by step.',
      },
      {
        label: 'Downloads',
        href: '/products/paralith#download',
        description: 'Signed builds for Windows, macOS, and Linux.',
        badge: 'v0.9.4',
      },
      {
        label: 'Release notes',
        href: '/products/paralith#release-notes',
        description: 'What changed in the current preview.',
      },
      {
        label: 'Questions',
        href: '/products/paralith#faq',
        description: 'Privacy, model choice, and platform support.',
      },
    ],
    aside: {
      kicker: 'Current build',
      title: 'Paralith v0.9.4 preview',
      body: 'Preview binaries are issued individually while Paralith is in early access. Every artifact is signed and published with its checksum.',
      facts: [
        { key: 'Release', value: 'v0.9.4 preview', accent: true },
        { key: 'Runs on', value: 'Windows · macOS · Linux' },
        { key: 'Your code', value: 'Stays on your machine' },
        { key: 'Telemetry', value: 'Off by default' },
      ],
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
    columnKicker: 'Corelith',
    items: [
      {
        label: 'About Corelith',
        href: '/company',
        description: 'Mission, engineering scope, and the standards we build to.',
      },
      {
        label: 'Security & trust',
        href: '/security',
        description: 'Data handling, signed releases, and disclosure.',
      },
      {
        label: 'Careers',
        href: '/careers',
        description: 'Engineering culture and the roles we are hiring for.',
      },
      {
        label: 'Contact',
        href: '/contact',
        description: 'Reach the engineering team directly.',
      },
    ],
    aside: {
      kicker: 'Directive',
      title: 'Building powerful software for the people shaping what comes next.',
      body: 'Four domains where technical depth and interface precision both have to hold. We do not staff a fifth.',
      facts: [
        { key: 'Company', value: 'Independent, product-led' },
        { key: 'Engineering', value: 'Global / distributed' },
        { key: 'Flagship', value: 'Paralith', accent: true },
        { key: 'Disclosure', value: 'Coordinated' },
      ],
      cta: { label: 'Contact engineering', href: '/contact' },
    },
  },
];

/**
 * Flat list of every destination in the primary nav, in reading order. The
 * mobile drawer numbers its entries, and screen-reader users get one ordered
 * set rather than a nest — so the drawer builds from this rather than walking
 * the panel tree.
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
