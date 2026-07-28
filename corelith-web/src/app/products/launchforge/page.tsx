import { Metadata } from 'next';
import { products } from '@/data/products';
import { ProductStatusBadge } from '@/components/ProductStatusBadge';
import { FAQAccordion } from '@/components/FAQAccordion';
import Link from 'next/link';
import { Sparkles, Layers, Workflow, ArrowRight } from 'lucide-react';

const product = products.find((p) => p.id === 'launchforge')!;

export const metadata: Metadata = {
  title: `${product.name} — ${product.tagline}`,
  description: product.fullDescription,
};

export default function LaunchForgePage() {
  return (
    <div className="space-y-20 pb-20">
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-8 text-center hero-glow">
        <div className="inline-flex items-center gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-indigo-400 font-semibold">
            Software Architecture Workspace
          </span>
          <ProductStatusBadge status={product.status} />
        </div>

        <div className="max-w-4xl mx-auto space-y-4">
          <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
            Visions into buildable software blueprints.
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed">
            {product.fullDescription}
          </p>
        </div>

        <div className="pt-4 flex items-center justify-center gap-4">
          <Link
            href="/contact"
            className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm shadow-xl shadow-amber-600/30"
          >
            <span>Join Architecture Waitlist</span>
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-3xl font-bold text-white font-heading">Architecture Engineering Features</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {product.capabilities.map((cap, i) => (
            <div key={i} className="corelith-card p-6 space-y-3 text-left hover:border-amber-500/40">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {cap.highlight}
              </span>
              <h3 className="text-lg font-bold text-white font-heading">{cap.title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed">{cap.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <FAQAccordion faqs={product.faqs} />
      </section>
    </div>
  );
}
