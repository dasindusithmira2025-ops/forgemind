import { Metadata } from 'next';
import { products } from '@/data/products';
import { DownloadSelector } from '@/components/DownloadSelector';
import { FAQAccordion } from '@/components/FAQAccordion';
import { ProductStatusBadge } from '@/components/ProductStatusBadge';
import Link from 'next/link';
import { Terminal, ShieldCheck, Cpu, Code2, CheckCircle2, ArrowRight, Layers, Lock, Monitor } from 'lucide-react';

const product = products.find((p) => p.id === 'paralith')!;

export const metadata: Metadata = {
  title: `${product.name} — ${product.tagline}`,
  description: product.fullDescription,
};

export default function ParalithPage() {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Paralith',
    operatingSystem: 'Windows, macOS, Linux',
    applicationCategory: 'DeveloperApplication',
    description: product.fullDescription,
    softwareVersion: 'v0.9.4-preview',
  };

  return (
    <div className="space-y-20 pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      {/* HERO SECTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8 text-center hero-glow">
        <div className="inline-flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold">
            Flagship Developer Environment
          </span>
          <ProductStatusBadge status={product.status} />
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
            Development, coordinated.
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            {product.fullDescription}
          </p>
        </div>

        {/* Download Selector Component */}
        {product.downloads && (
          <div className="pt-6">
            <DownloadSelector productName={product.name} downloads={product.downloads} />
          </div>
        )}
      </section>

      {/* CORE WORKFLOWS & CAPABILITIES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            System Architecture
          </div>
          <h2 className="text-3xl font-bold text-white font-heading">
            Engineered for Serious Software Delivery
          </h2>
          <p className="text-gray-400 text-sm">
            Paralith bridges high-level agentic execution with strict low-level system controls.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {product.capabilities.map((cap, i) => (
            <div key={i} className="corelith-card p-6 space-y-3 text-left hover:border-indigo-500/40">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                  {cap.highlight || 'Core System'}
                </span>
                <span className="text-xs font-mono text-gray-400">0{i + 1}</span>
              </div>
              <h3 className="text-lg font-bold text-white font-heading">{cap.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TARGET AUDIENCE & OS SUPPORT */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <div className="corelith-card p-8 text-left space-y-4">
            <h3 className="text-xl font-bold text-white font-heading flex items-center gap-2">
              <Cpu className="w-5 h-5 text-indigo-400" />
              Target Engineering Teams
            </h3>
            <ul className="space-y-2 text-sm text-gray-300">
              {product.targetAudience.map((aud, idx) => (
                <li key={idx} className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{aud}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="corelith-card p-8 text-left space-y-4">
            <h3 className="text-xl font-bold text-white font-heading flex items-center gap-2">
              <Monitor className="w-5 h-5 text-indigo-400" />
              Supported Operating Systems
            </h3>
            <div className="space-y-3 text-xs font-mono text-gray-300">
              <div className="p-3 rounded bg-[#08090c] border border-white/10 flex items-center justify-between">
                <span>Windows 11 / Windows 10 (22H2+)</span>
                <span className="text-emerald-400">x64 Binary Ready</span>
              </div>
              <div className="p-3 rounded bg-[#08090c] border border-white/10 flex items-center justify-between">
                <span>macOS Ventura (13.0+)</span>
                <span className="text-emerald-400">Universal (M1/Intel)</span>
              </div>
              <div className="p-3 rounded bg-[#08090c] border border-white/10 flex items-center justify-between">
                <span>Linux (Ubuntu 22.04 LTS / Fedora)</span>
                <span className="text-emerald-400">.AppImage / .deb</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* RELEASE NOTES SECTION */}
      <section id="release-notes" className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-left">
        <div className="corelith-card p-8 space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h3 className="text-xl font-bold text-white font-heading">
                Release Notes — v0.9.4 Preview
              </h3>
              <p className="text-xs font-mono text-gray-400 mt-0.5">Released July 15, 2026</p>
            </div>
            <span className="text-xs font-mono px-3 py-1 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
              SHA-256 Verified
            </span>
          </div>

          <div className="space-y-3 text-xs text-gray-300 leading-relaxed font-mono">
            <p className="text-indigo-400 font-bold">[NEW FEATURES]</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-300">
              <li>Parallel agent task execution with real-time terminal stream output.</li>
              <li>Local AST project memory indexer supporting Rust, TypeScript, Python, and Go.</li>
              <li>Multi-window workspace detachment with persistent window state restoration.</li>
            </ul>

            <p className="text-emerald-400 font-bold pt-2">[VERIFICATION & SECURITY]</p>
            <ul className="list-disc pl-5 space-y-1 text-gray-300">
              <li>Strict PTY command sandbox with explicit approval dialogs for destructive shell calls.</li>
              <li>Cryptographic installer signing for Windows (.msi) and macOS (.dmg).</li>
            </ul>
          </div>
        </div>
      </section>

      {/* FREQUENTLY ASKED QUESTIONS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-3xl font-bold text-white font-heading">
            Frequently Asked Questions
          </h2>
          <p className="text-gray-400 text-sm">
            Everything you need to know about Paralith architecture and security.
          </p>
        </div>

        <FAQAccordion faqs={product.faqs} />
      </section>
    </div>
  );
}
