import Link from 'next/link';
import { Product } from '@/types';
import { ProductStatusBadge } from './ProductStatusBadge';
import { ArrowRight, Monitor, Cpu, ShieldCheck, Zap } from 'lucide-react';

interface ProductCardProps {
  product: Product;
  featured?: boolean;
}

export function ProductCard({ product, featured = false }: ProductCardProps) {
  return (
    <div
      className={`corelith-card relative flex flex-col justify-between p-6 sm:p-8 ${
        featured
          ? 'bg-gradient-to-b from-[#141722] to-[#0e1017] border-indigo-500/40 md:col-span-2'
          : 'bg-[#0e1017]'
      }`}
    >
      <div className="space-y-4">
        {/* Top Header Row */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-medium">
            {product.category}
          </span>
          <ProductStatusBadge status={product.status} size="sm" />
        </div>

        {/* Product Name & Tagline */}
        <div>
          <h3 className="text-2xl font-bold text-white font-heading tracking-tight group-hover:text-indigo-300 transition-colors">
            {product.name}
          </h3>
          <p className="text-sm font-semibold text-gray-300 mt-1">
            {product.tagline}
          </p>
        </div>

        {/* Short Description */}
        <p className="text-sm text-gray-400 leading-relaxed">
          {product.shortDescription}
        </p>

        {/* Key Feature Highlights */}
        <div className="space-y-2 pt-2">
          {product.capabilities.slice(0, featured ? 3 : 2).map((cap, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-gray-300">
              <span className="text-indigo-400 mt-0.5">•</span>
              <span>
                <strong className="text-white font-medium">{cap.title}:</strong>{' '}
                <span className="text-gray-400">{cap.description}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Footer Area: Platforms & CTA */}
      <div className="pt-6 mt-6 border-t border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Platforms */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-mono text-gray-400">Platforms:</span>
          <div className="flex flex-wrap gap-1">
            {product.platforms.map((p) => (
              <span
                key={p}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-white/5 text-gray-300 border border-white/10"
              >
                {p}
              </span>
            ))}
          </div>
        </div>

        {/* Product Page Link */}
        <Link
          href={`/products/${product.slug}`}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-300 hover:text-white text-xs font-semibold transition-all hover:scale-[1.02]"
        >
          <span>{product.isFlagship ? 'Explore Flagship' : 'Product Details'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
