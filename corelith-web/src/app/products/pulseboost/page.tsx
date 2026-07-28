import { Metadata } from 'next';
import { products } from '@/data/products';
import { DownloadSelector } from '@/components/DownloadSelector';
import { FAQAccordion } from '@/components/FAQAccordion';
import { ProductStatusBadge } from '@/components/ProductStatusBadge';
import { Gauge, ShieldCheck, RefreshCw, Zap, CheckCircle2, Monitor } from 'lucide-react';

const product = products.find((p) => p.id === 'pulseboost')!;

export const metadata: Metadata = {
  title: `${product.name} — ${product.tagline}`,
  description: product.fullDescription,
};

export default function PulseBoostPage() {
  return (
    <div className="space-y-20 pb-20">
      {/* HERO */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8 text-center hero-glow">
        <div className="inline-flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold">
            System Performance Platform
          </span>
          <ProductStatusBadge status={product.status} />
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
            Transparent, evidence-based performance.
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            {product.fullDescription}
          </p>
        </div>

        {/* Download selector */}
        {product.downloads && (
          <div className="pt-6">
            <DownloadSelector productName={product.name} downloads={product.downloads} />
          </div>
        )}
      </section>

      {/* CORE PRINCIPLES & CAPABILITIES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            Engineering Principles
          </div>
          <h2 className="text-3xl font-bold text-white font-heading">
            Optimization Without Compromise
          </h2>
          <p className="text-gray-400 text-sm">
            PulseBoost guarantees before-and-after transparency, hardware safety, and instantaneous rollback.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {product.capabilities.map((cap, i) => (
            <div key={i} className="corelith-card p-6 space-y-3 text-left hover:border-indigo-500/40">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {cap.highlight}
              </span>
              <h3 className="text-lg font-bold text-white font-heading">{cap.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* BEFORE & AFTER METRICS TRANSPARENCY DEMO */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-left">
        <div className="corelith-card p-8 space-y-6 bg-gradient-to-b from-[#141722] to-[#0e1017]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
            <div>
              <h3 className="text-xl font-bold text-white font-heading flex items-center gap-2">
                <Gauge className="w-5 h-5 text-indigo-400" />
                Empirical Performance Benchmark Comparison
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Tested on Windows 11 Workstation (Intel i9-14900K / 64GB RAM)</p>
            </div>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-500/10 px-3 py-1 rounded border border-emerald-500/20">
              100% Deterministic Delta
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-mono text-xs">
            <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
              <span className="text-gray-400 text-[10px]">CPU SCHEDULER LATENCY</span>
              <div className="flex items-baseline justify-between">
                <span className="text-gray-400 line-through">4.8 ms</span>
                <span className="text-emerald-400 font-bold text-base">1.2 ms (-75%)</span>
              </div>
              <p className="text-[10px] text-gray-400">DPC latency reduced during build tasks.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
              <span className="text-gray-400 text-[10px]">MEMORY COMPRESSION CACHE</span>
              <div className="flex items-baseline justify-between">
                <span className="text-gray-400 line-through">2.4 GB</span>
                <span className="text-cyan-400 font-bold text-base">650 MB (-72%)</span>
              </div>
              <p className="text-[10px] text-gray-400">Unused background buffers flushed.</p>
            </div>

            <div className="p-4 rounded-xl bg-[#08090c] border border-white/10 space-y-2">
              <span className="text-gray-400 text-[10px]">COMPILER BUILD TIME (C++)</span>
              <div className="flex items-baseline justify-between">
                <span className="text-gray-400 line-through">42.4s</span>
                <span className="text-indigo-400 font-bold text-base">34.8s (-18%)</span>
              </div>
              <p className="text-[10px] text-gray-400">Optimized I/O cache allocation.</p>
            </div>
          </div>
        </div>
      </section>

      {/* FAQS */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-3xl font-bold text-white font-heading">Frequently Asked Questions</h2>
        </div>
        <FAQAccordion faqs={product.faqs} />
      </section>
    </div>
  );
}
