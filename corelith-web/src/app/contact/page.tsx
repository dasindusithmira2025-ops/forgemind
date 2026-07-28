import { Metadata } from 'next';
import { ContactForm } from '@/components/ContactForm';
import { siteConfig } from '@/config/site';
import { Mail, ShieldCheck, Building2, HelpCircle } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Contact & Inquiries',
  description:
    'Contact Corelith Technologies for business inquiries, product support, security reports, partnerships, or general information.',
};

export default function ContactPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16 pb-20">
      {/* HERO */}
      <div className="text-center max-w-3xl mx-auto space-y-4 pt-6">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Contact Corelith Technologies
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white font-heading tracking-tight">
          Direct communication pathways.
        </h1>
        <p className="text-base text-gray-300">
          Reach out to our engineering, product, security, or enterprise team. All submissions are reviewed promptly.
        </p>
      </div>

      {/* DIRECT CONTACT TILES */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
        <div className="corelith-card p-6 text-left space-y-2">
          <div className="text-indigo-400 font-bold text-xs uppercase font-mono flex items-center gap-1.5">
            <Building2 className="w-4 h-4" /> Enterprise & Business
          </div>
          <p className="text-sm font-semibold text-white">{siteConfig.contactEmail}</p>
          <p className="text-[11px] text-gray-400">Custom licensing, agency accounts & enterprise contracts.</p>
        </div>

        <div className="corelith-card p-6 text-left space-y-2">
          <div className="text-amber-400 font-bold text-xs uppercase font-mono flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" /> Security & Trust
          </div>
          <p className="text-sm font-semibold text-white">{siteConfig.securityEmail}</p>
          <p className="text-[11px] text-gray-400">Coordinated disclosure & security vulnerability reports.</p>
        </div>

        <div className="corelith-card p-6 text-left space-y-2">
          <div className="text-cyan-400 font-bold text-xs uppercase font-mono flex items-center gap-1.5">
            <HelpCircle className="w-4 h-4" /> Press & Media
          </div>
          <p className="text-sm font-semibold text-white">{siteConfig.pressEmail}</p>
          <p className="text-[11px] text-gray-400">Product announcements & media inquiries.</p>
        </div>
      </div>

      {/* FORM COMPONENT */}
      <div className="pt-4">
        <ContactForm />
      </div>
    </div>
  );
}
