import Link from 'next/link';
import { BrandLogo } from './BrandLogo';
import { footerLinks } from '@/data/navigation';
import { siteConfig } from '@/config/site';
import { Github, Twitter, Linkedin, ShieldCheck } from 'lucide-react';

export function Footer() {
  return (
    <footer className="bg-[#08090c] border-t border-white/10 pt-16 pb-12 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-3/4 h-32 bg-indigo-600/5 blur-3xl rounded-full pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-10 pb-12 border-b border-white/10">
          {/* Brand & Mission column */}
          <div className="md:col-span-5 space-y-4">
            <BrandLogo size="lg" showTagline />
            <p className="text-gray-400 text-sm max-w-sm leading-relaxed">
              {siteConfig.description}
            </p>
            
            {/* System Status Pill */}
            <div className="pt-2">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#141722] border border-white/10 text-xs font-mono text-gray-300">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>All Corelith Systems Operational</span>
              </div>
            </div>
          </div>

          {/* Products Column */}
          <div className="md:col-span-3 space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-white font-mono font-semibold">
              Software Products
            </h3>
            <ul className="space-y-2">
              {footerLinks.products.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-white transition-colors inline-flex items-center gap-2"
                  >
                    <span>{link.label}</span>
                    {link.badge && (
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                        {link.badge}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company Column */}
          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-white font-mono font-semibold">
              Company
            </h3>
            <ul className="space-y-2">
              {footerLinks.company.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Security & Trust Column */}
          <div className="md:col-span-2 space-y-3">
            <h3 className="text-xs uppercase tracking-wider text-white font-mono font-semibold">
              Security & Trust
            </h3>
            <ul className="space-y-2">
              {footerLinks.trust.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-gray-400 hover:text-white transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400 font-mono">
          <div className="flex flex-wrap items-center gap-4">
            <span>&copy; {new Date().getFullYear()} {siteConfig.name}. All rights reserved.</span>
            <span className="hidden sm:inline text-gray-400">•</span>
            <span className="flex items-center gap-1 text-gray-400">
              <ShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
              Verified Domain: {siteConfig.domain.replace('https://www.', '')}
            </span>
          </div>

          {/* Social Links */}
          <div className="flex items-center gap-4 text-gray-400">
            <a
              href={siteConfig.social.github}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors p-1"
              aria-label="Corelith Technologies GitHub"
            >
              <Github className="w-4 h-4" />
            </a>
            <a
              href={siteConfig.social.twitter}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors p-1"
              aria-label="Corelith Technologies Twitter"
            >
              <Twitter className="w-4 h-4" />
            </a>
            <a
              href={siteConfig.social.linkedin}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors p-1"
              aria-label="Corelith Technologies LinkedIn"
            >
              <Linkedin className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
