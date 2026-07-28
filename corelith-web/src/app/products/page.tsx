import { Metadata } from 'next';
import { products } from '@/data/products';
import { ProductCard } from '@/components/ProductCard';
import { ProductStatusBadge } from '@/components/ProductStatusBadge';
import Link from 'next/link';
import { ArrowRight, Terminal } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Software Products Portfolio',
  description:
    'Explore Corelith Technologies software suite: Paralith (Agentic Developer Platform), PulseBoost, TyoTrack, and LaunchForge AI.',
};

export default function ProductsPage() {
  const flagship = products.find((p) => p.isFlagship);
  const otherProducts = products.filter((p) => !p.isFlagship);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16 pb-20">
      {/* Header */}
      <div className="space-y-4 text-center max-w-3xl mx-auto">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Corelith Software Suite
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold text-white font-heading tracking-tight">
          Tools for developers, teams, and high-leverage workflows.
        </h1>
        <p className="text-base text-gray-300">
          Corelith builds software across agentic development environments, system performance optimization, enterprise operational governance, and software architecture.
        </p>
      </div>

      {/* Flagship Product Showcase Section */}
      {flagship && (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs font-mono text-gray-400 border-b border-white/10 pb-2">
            <span className="text-indigo-400 font-bold uppercase tracking-wider">
              Flagship Platform
            </span>
            <ProductStatusBadge status={flagship.status} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-gradient-to-b from-[#141722] to-[#0e1017] p-8 sm:p-10 rounded-2xl border border-indigo-500/40 shadow-2xl">
            <div className="lg:col-span-7 space-y-4 text-left">
              <span className="text-xs uppercase font-mono text-indigo-400 font-semibold">
                {flagship.category}
              </span>
              <h2 className="text-3xl font-extrabold text-white font-heading">
                {flagship.name} — {flagship.tagline}
              </h2>
              <p className="text-gray-300 text-sm leading-relaxed">
                {flagship.fullDescription}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                {flagship.capabilities.slice(0, 4).map((cap, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-black/40 border border-white/5 space-y-1">
                    <span className="text-xs font-bold text-white block font-heading">{cap.title}</span>
                    <span className="text-[11px] text-gray-400 block">{cap.description}</span>
                  </div>
                ))}
              </div>

              <div className="pt-4 flex items-center gap-4">
                <Link
                  href={`/products/${flagship.slug}`}
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30"
                >
                  <span>Explore Paralith Flagship</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5 bg-[#08090c] p-6 rounded-xl border border-white/10 space-y-3 font-mono text-xs text-left">
              <div className="text-indigo-400 font-bold flex items-center gap-2 border-b border-white/10 pb-2">
                <Terminal className="w-4 h-4" />
                Paralith Architecture Summary
              </div>
              <div className="space-y-2 text-gray-300 text-[11px]">
                <div>• <strong className="text-white">Workspace Engine:</strong> Multi-Agent AST Graph Indexing</div>
                <div>• <strong className="text-white">Terminal Runtime:</strong> Integrated PTY with command audit logs</div>
                <div>• <strong className="text-white">Verification:</strong> Automated continuous test suite execution</div>
                <div>• <strong className="text-white">Platforms:</strong> Native builds for Windows, macOS, Linux</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Production Products & Initiatives Grid */}
      <div className="space-y-6">
        <div className="border-b border-white/10 pb-3">
          <h2 className="text-2xl font-bold text-white font-heading">
            All Products & Initiatives
          </h2>
          <p className="text-xs text-gray-400 mt-1 font-mono">
            Every product status represents honest public availability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {otherProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>
    </div>
  );
}
