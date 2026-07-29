import { NavLink } from '@/types';

export const mainNavLinks: NavLink[] = [
  {
    label: 'Paralith',
    href: '/products/paralith',
    description: 'Our agentic development environment',
  },
  {
    label: 'How it works',
    href: '/technology',
    description: 'What working with Paralith is actually like',
  },
  {
    label: 'Company',
    href: '/company',
    description: 'Our mission, standards & philosophy',
  },
  {
    label: 'Security',
    href: '/security',
    description: 'Trust, data privacy & security standards',
  },
  {
    label: 'Careers',
    href: '/careers',
    description: 'Engineering culture & opportunities',
  },
];

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
