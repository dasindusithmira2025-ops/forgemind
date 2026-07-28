import { Metadata } from 'next';
import { careersData } from '@/data/careers';
import Link from 'next/link';
import { Briefcase, CheckCircle2, ArrowRight, Sparkles, Users } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Careers & Culture',
  description:
    'Engineering culture, standards, craftsmanship, and careers at Corelith Technologies.',
};

export default function CareersPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20 pb-20">
      {/* HERO */}
      <div className="text-center max-w-4xl mx-auto space-y-4 pt-6">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Careers & Engineering Culture
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
          {careersData.cultureTitle}
        </h1>
        <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
          {careersData.cultureDescription}
        </p>
      </div>

      {/* CORE VALUES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {careersData.values.map((val, idx) => (
          <div key={idx} className="corelith-card p-8 text-left space-y-3">
            <div className="text-xs font-mono text-indigo-400 font-bold">0{idx + 1}</div>
            <h3 className="text-xl font-bold text-white font-heading">{val.title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{val.description}</p>
          </div>
        ))}
      </div>

      {/* OPEN POSITIONS / HONEST EMPTY STATE */}
      <div className="corelith-card p-8 sm:p-12 text-center space-y-6 bg-[#0e1017]">
        <div className="w-12 h-12 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
          <Briefcase className="w-6 h-6" />
        </div>

        <div className="space-y-2 max-w-xl mx-auto">
          <h2 className="text-2xl font-bold text-white font-heading">
            Current Openings
          </h2>
          <p className="text-sm text-gray-400">
            We are not currently advertising open public positions. However, we are always eager to connect with exceptional systems engineers, product designers, and compiler leads.
          </p>
        </div>

        <div className="p-6 rounded-xl bg-[#08090c] border border-white/10 max-w-xl mx-auto text-left space-y-3">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            General Interest Submission
          </div>
          <p className="text-xs text-gray-300">
            If you are deeply passionate about agentic systems, desktop developer tools, low-latency performance engineering, or modern web interfaces, introduce yourself to our team.
          </p>
          <div className="pt-2">
            <Link
              href="/contact?category=careers"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30"
            >
              <span>Submit Engineering Inquiry</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
