import { NavLink } from '@/types';

export const mainNavLinks: NavLink[] = [
  {
    label: 'Paralith',
    href: '/products/paralith',
    description: 'Our agentic development environment',
  },
  {
    label: 'Technology',
    href: '/technology',
    description: 'Agentic engines & system architecture',
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
    { label: 'Technology', href: '/technology' },
  ],
  company: [
    { label: 'About Corelith', href: '/company' },
    { label: 'Engineering Standards', href: '/company#philosophy' },
    { label: 'Technology Deep-Dive', href: '/technology' },
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
