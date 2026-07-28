import { NavLink } from '@/types';

export const mainNavLinks: NavLink[] = [
  {
    label: 'Products',
    href: '/products',
    description: 'Explore the Corelith software suite',
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
    { label: 'Paralith (Flagship)', href: '/products/paralith', badge: 'Preview' },
    { label: 'PulseBoost', href: '/products/pulseboost' },
    { label: 'TyoTrack', href: '/products/tyotrack', badge: 'Beta' },
    { label: 'LaunchForge AI', href: '/products/launchforge', badge: 'Dev' },
    { label: 'All Products', href: '/products' },
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
