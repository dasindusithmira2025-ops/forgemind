import { Metadata } from 'next';
import { companyData } from '@/data/company';
import { PrinciplesGrid } from '@/components/PrinciplesGrid';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, Cpu, Sparkles, CheckCircle2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Company & Mission',
  description:
    'Learn about Corelith Technologies: Our mission, engineering standards, product principles, and long-term software vision.',
};

export default function CompanyPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20 pb-20">
      {/* HERO */}
      <div className="text-center max-w-4xl mx-auto space-y-4 pt-6">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Company & Purpose
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
          Building powerful software for the people shaping what comes next.
        </h1>
        <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
          {companyData.about}
        </p>
      </div>

      {/* MISSION & STATEMENT BOX */}
      <div className="corelith-card p-8 sm:p-12 bg-gradient-to-b from-[#141722] to-[#0e1017] border-indigo-500/30 text-left space-y-6">
        <div className="text-xs font-mono uppercase text-indigo-400 font-bold tracking-wider">
          Core Operating Mission
        </div>
        <p className="text-xl sm:text-2xl font-bold text-white font-heading leading-relaxed max-w-4xl">
          &ldquo;Corelith Technologies creates intelligent products, developer platforms, and digital systems designed to turn complex work into focused, high-leverage execution.&rdquo;
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-white/10 text-xs font-mono text-gray-300">
          <div className="p-3 rounded bg-[#08090c] border border-white/10">
            <span className="text-gray-400 block text-[10px]">CRAFTSMANSHIP</span>
            <span className="text-white font-semibold mt-1 block">Zero Template Clutches</span>
          </div>
          <div className="p-3 rounded bg-[#08090c] border border-white/10">
            <span className="text-gray-400 block text-[10px]">VERIFICATION</span>
            <span className="text-emerald-400 font-semibold mt-1 block">Empirical Metrics</span>
          </div>
          <div className="p-3 rounded bg-[#08090c] border border-white/10">
            <span className="text-gray-400 block text-[10px]">DATA GOVERNANCE</span>
            <span className="text-indigo-400 font-semibold mt-1 block">Local-First Defaults</span>
          </div>
        </div>
      </div>

      {/* PRINCIPLES */}
      <div id="philosophy" className="space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            Foundational Standards
          </div>
          <h2 className="text-3xl font-bold text-white font-heading">
            Engineering & Product Philosophy
          </h2>
          <p className="text-gray-400 text-sm">
            The principles governing every piece of software built by Corelith.
          </p>
        </div>

        <PrinciplesGrid />
      </div>

      {/* CAREERS CTA */}
      <div className="rounded-2xl bg-[#141722] border border-white/10 p-8 text-center space-y-4">
        <h3 className="text-2xl font-bold text-white font-heading">
          Interested in our engineering standards?
        </h3>
        <p className="text-sm text-gray-300 max-w-xl mx-auto">
          We favor small, high-agency teams built around software discipline and craftsmanship.
        </p>
        <Link
          href="/careers"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30"
        >
          <span>Explore Careers & Culture</span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
