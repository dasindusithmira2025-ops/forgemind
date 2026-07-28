import { Metadata } from 'next';
import { securityData } from '@/data/security';
import { siteConfig } from '@/config/site';
import Link from 'next/link';
import { ShieldCheck, Lock, FileCheck, AlertTriangle, Mail, CheckCircle2 } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Security & Trust Center',
  description:
    'Corelith Technologies security architecture, secure-by-default design, least privilege, data handling transparency, and responsible vulnerability disclosure policy.',
};

export default function SecurityPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20 pb-20">
      {/* HERO */}
      <div className="text-center max-w-4xl mx-auto space-y-4 pt-6">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Security & Trust Center
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
          Security by design. Privacy by default.
        </h1>
        <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
          {securityData.description}
        </p>
      </div>

      {/* CORE SECURITY PRINCIPLES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {securityData.principles.map((p, idx) => (
          <div key={idx} className="corelith-card p-8 text-left space-y-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-white font-heading">{p.title}</h3>
            <p className="text-sm text-gray-400 leading-relaxed">{p.description}</p>
          </div>
        ))}
      </div>

      {/* DATA TRANSPARENCY MATRIX */}
      <div className="corelith-card p-8 bg-[#0e1017] text-left space-y-6">
        <div className="border-b border-white/10 pb-4">
          <h2 className="text-2xl font-bold text-white font-heading">
            Data Handling & Privacy Boundaries
          </h2>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            How Corelith Technologies handles project code, telemetry, and system metadata.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 font-mono text-xs">
          <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
            <span className="text-indigo-400 font-bold block">SOURCE CODE & AST</span>
            <span className="text-emerald-400 font-semibold block">100% Local Storage</span>
            <p className="text-gray-400 text-[11px] font-sans">
              Source files and AST indices remain strictly on your local machine. Never uploaded to public training models.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
            <span className="text-indigo-400 font-bold block">TELEMETRY & CRASH LOGS</span>
            <span className="text-emerald-400 font-semibold block">Opt-In / Anonymized</span>
            <p className="text-gray-400 text-[11px] font-sans">
              Crash logs require explicit user consent and sanitize all local paths, secrets, and environment tokens.
            </p>
          </div>

          <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
            <span className="text-indigo-400 font-bold block">RELEASE INTEGRITY</span>
            <span className="text-emerald-400 font-semibold block">Signed & Checksummed</span>
            <p className="text-gray-400 text-[11px] font-sans">
              Binaries are signed with official certificate authorities and published with SHA-256 hashes.
            </p>
          </div>
        </div>
      </div>

      {/* RESPONSIBLE DISCLOSURE SECTION */}
      <div id="disclosure" className="corelith-card p-8 sm:p-10 text-left space-y-6 border-indigo-500/30">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-bold text-white font-heading">
              Vulnerability Disclosure Framework
            </h3>
            <p className="text-xs text-gray-400 font-mono">
              Coordinated security reporting policy for independent researchers.
            </p>
          </div>
        </div>

        <div className="space-y-3 text-sm text-gray-300">
          <p>
            If you believe you have discovered a potential security vulnerability in any Corelith product or infrastructure, please notify us immediately.
          </p>
          <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2 font-mono text-xs">
            <div className="text-indigo-400 font-bold">Reporting Procedure:</div>
            <ul className="space-y-1 text-gray-300">
              {securityData.reportingProcess.map((step, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-indigo-400 font-bold">{i + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="pt-2 flex flex-wrap items-center gap-4">
          <a
            href={`mailto:${siteConfig.securityEmail}`}
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30"
          >
            <Mail className="w-4 h-4" />
            <span>Contact Security Team ({siteConfig.securityEmail})</span>
          </a>
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-[#141722] border border-white/10 text-gray-300 hover:text-white text-xs font-semibold"
          >
            <span>General Inquiry Form</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
