import { NavItem, NavLink } from '@/types';

/**
 * The primary navigation.
 *
 * Two of the three entries open a panel. The panel is not a floating card — it
 * is another band of the page that happens to be temporary, printed on the
 * second weight of stock and closed top and bottom by a hairline, so opening the
 * menu reads as the sheet extending rather than a widget appearing over it.
 *
 * The right-hand column of each panel shows the thing itself: a still of the
 * workspace for the product, the company mark for the company. A menu that
 * shows you the product is worth more than one that describes it, and the still
 * is the poster frame of a loop the site already ships.
 */
export const mainNav: NavItem[] = [
  {
    kind: 'menu',
    id: 'paralith',
    label: 'Paralith',
    href: '/products/paralith',
    items: [
      {
        label: 'Overview',
        href: '/products/paralith',
        description: 'What it is, and who it is built for',
      },
      {
        label: 'Capabilities',
        href: '/products/paralith#capabilities',
        description: 'Six things it takes off your hands',
      },
      {
        label: 'How a task runs',
        href: '/technology',
        description: 'From your sentence to an approved change',
      },
      {
        label: 'Downloads',
        href: '/products/paralith#download',
        description: 'Signed builds for Windows, macOS, and Linux',
      },
      {
        label: 'Release notes',
        href: '/products/paralith#release-notes',
        description: 'What changed in the current preview',
      },
      {
        label: 'Questions',
        href: '/products/paralith#faq',
        description: 'Privacy, model choice, platform support',
      },
    ],
    plate: {
      image: '/media/paralith-workspace-plate.jpg',
      imageAlt: 'The Paralith workspace: six agents working across terminal panes.',
      fit: 'cover',
      caption: 'v0.9.4 preview',
      statement: 'Six agents, one build, nothing landing unchecked.',
      cta: { label: 'Get the build', href: '/products/paralith#download' },
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
    items: [
      {
        label: 'About Corelith',
        href: '/company',
        description: 'Mission, scope, and the standards we build to',
      },
      {
        label: 'Security & trust',
        href: '/security',
        description: 'Data handling, signed releases, disclosure',
      },
      {
        label: 'Careers',
        href: '/careers',
        description: 'Engineering culture and open roles',
      },
      {
        label: 'Contact',
        href: '/contact',
        description: 'Reach the engineering team directly',
      },
    ],
    plate: {
      image: '/brand/corelith-mark.png',
      imageAlt: '',
      fit: 'contain',
      caption: 'Corelith Technologies',
      statement: 'Building powerful software for the people shaping what comes next.',
      cta: { label: 'Contact engineering', href: '/contact' },
    },
  },
];

/**
 * Flat list of every destination in the primary nav, in reading order. The
 * mobile drawer numbers nothing and nests nothing — screen-reader users get one
 * ordered set — so it builds from this rather than walking the panel tree.
 */
export const mainNavLinks: NavLink[] = mainNav.flatMap((entry) =>
  entry.kind === 'link'
    ? [{ label: entry.label, href: entry.href, description: entry.description }]
    : entry.items.map((item) => ({
        label: item.label,
        href: item.href,
        description: item.description,
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
