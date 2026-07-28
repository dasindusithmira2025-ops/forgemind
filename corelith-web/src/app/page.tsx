import Link from 'next/link';
import { products } from '@/data/products';
import { companyData } from '@/data/company';
import { ParalithHeroVisual } from '@/components/ParalithHeroVisual';
import { ProductCard } from '@/components/ProductCard';
import { CapabilitiesGrid } from '@/components/CapabilitiesGrid';
import { PrinciplesGrid } from '@/components/PrinciplesGrid';
import { ArrowRight, ShieldCheck, Cpu, Terminal, Sparkles, CheckCircle2 } from 'lucide-react';

export default function HomePage() {
  const paralith = products.find((p) => p.id === 'paralith')!;
  const otherProducts = products.filter((p) => p.id !== 'paralith');

  return (
    <div className="space-y-24 pb-20">
      {/* SECTION 1: HERO */}
      <section className="relative pt-8 pb-12 overflow-hidden text-center hero-glow">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 relative z-10">
          {/* Top Pill Announcement */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#141722] border border-white/10 text-xs font-mono text-indigo-300">
            <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse" />
            <span>Announcing Paralith Preview v0.9.4</span>
            <span className="text-gray-400">•</span>
            <Link href="/products/paralith" className="underline hover:text-white flex items-center gap-1">
              Read Specification <ArrowRight className="w-3 h-3" />
            </Link>
          </div>

          {/* Hero Headlines */}
          <div className="max-w-4xl mx-auto space-y-4">
            <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white font-heading leading-[1.08]">
              Software for people building{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-cyan-400 to-indigo-200">
                what comes next.
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-gray-300 max-w-2xl mx-auto font-normal leading-relaxed">
              Corelith Technologies creates intelligent developer platforms, productivity systems, and software products designed to turn complex work into focused execution.
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/products"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.02]"
            >
              <span>Explore All Products</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/products/paralith"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#141722] hover:bg-white/10 border border-white/10 text-gray-200 font-semibold text-sm transition-all"
            >
              <Terminal className="w-4 h-4 text-indigo-400" />
              <span>Discover Paralith</span>
            </Link>
          </div>

          {/* Interactive Hero Visual Canvas */}
          <div className="pt-8">
            <ParalithHeroVisual />
          </div>
        </div>
      </section>

      {/* SECTION 2: FLAGSHIP PRODUCT SHOWCASE */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            Flagship Software Platform
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-white font-heading">
            Development, coordinated.
          </h2>
          <p className="text-gray-300 text-base">
            Paralith brings projects, workspaces, terminals, intelligent agents, project memory, review, and continuous verification into one focused environment built for serious software delivery.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center bg-gradient-to-b from-[#141722] to-[#0e1017] p-8 sm:p-10 rounded-2xl border border-indigo-500/30 shadow-2xl">
          <div className="lg:col-span-6 space-y-6 text-left">
            <div className="space-y-2">
              <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                Paralith v0.9.4 Preview
              </span>
              <h3 className="text-2xl font-bold text-white font-heading">
                Multi-Agent Workspace Orchestration
              </h3>
              <p className="text-sm text-gray-300 leading-relaxed">
                Spawn specialized AI agents that research codebases, propose structural edits, run test suites, and execute terminal commands in parallel without blocking your workspace.
              </p>
            </div>

            <div className="space-y-3 text-sm text-gray-300">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>Persistent AST Memory:</strong> Full code graph context across commits.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>Integrated PTY Terminal:</strong> Native shell control with permission auditing.</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                <span><strong>Empirical Verification:</strong> Mandatory lint and build testing before merge.</span>
              </div>
            </div>

            <div className="pt-2 flex items-center gap-4">
              <Link
                href="/products/paralith"
                className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-lg shadow-indigo-600/30"
              >
                <span>Download Paralith Preview</span>
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>

          <div className="lg:col-span-6 bg-[#08090c] p-6 rounded-xl border border-white/10 font-mono text-xs text-left space-y-3">
            <div className="flex items-center justify-between text-gray-400 border-b border-white/10 pb-2">
              <span className="text-indigo-400 font-bold">$ paralith --status</span>
              <span className="text-emerald-400">STATUS: ACTIVE</span>
            </div>
            <p className="text-gray-300">[1/3] Indexing workspace AST... 1,420 AST nodes mapped.</p>
            <p className="text-gray-300">[2/3] Spawning Agent-Refactor & Agent-Test in parallel PTY...</p>
            <p className="text-emerald-400">[3/3] Verification pipeline complete. 142/142 tests passed.</p>
            <div className="p-3 rounded bg-indigo-950/40 border border-indigo-500/30 text-indigo-300 mt-2">
              Ready for workstation deployment on Windows, macOS, and Linux.
            </div>
          </div>
        </div>
      </section>

      {/* SECTION 3: PRODUCT ECOSYSTEM */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
              Software Ecosystem
            </div>
            <h2 className="text-3xl font-bold text-white font-heading mt-1">
              Corelith Software Portfolio
            </h2>
          </div>
          <Link href="/products" className="text-xs font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
            View All Products &rarr;
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {otherProducts.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      {/* SECTION 4: CAPABILITIES */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            Engineering Scope
          </div>
          <h2 className="text-3xl font-bold text-white font-heading">
            What Corelith Builds
          </h2>
          <p className="text-gray-400 text-sm">
            Corelith operates across critical software domains demanding technical depth and UI precision.
          </p>
        </div>

        <CapabilitiesGrid />
      </section>

      {/* SECTION 5: HOW CORELITH BUILDS (PRINCIPLES) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-10">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
            Product Philosophy
          </div>
          <h2 className="text-3xl font-bold text-white font-heading">
            How Corelith Builds Software
          </h2>
          <p className="text-gray-400 text-sm">
            We follow strict engineering principles to create software tools people depend on long-term.
          </p>
        </div>

        <PrinciplesGrid />
      </section>

      {/* SECTION 6: EDITORIAL COMPANY STATEMENT */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="corelith-card p-8 sm:p-12 text-center space-y-6 bg-gradient-to-b from-[#141722] to-[#08090c] border-indigo-500/30">
          <div className="w-12 h-12 rounded-full bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center mx-auto text-indigo-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <blockquote className="text-xl sm:text-2xl font-semibold text-white font-heading max-w-3xl mx-auto leading-relaxed">
            &ldquo;Corelith exists to turn ambitious software ideas into products people can depend on. We combine engineering discipline, intelligent automation, and careful product design to build systems that remain useful after the novelty disappears.&rdquo;
          </blockquote>
          <div className="text-xs font-mono text-indigo-400 tracking-widest uppercase">
            — Corelith Technologies Leadership Directive
          </div>
        </div>
      </section>

      {/* SECTION 7: FINAL CALL TO ACTION */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-2xl bg-indigo-600/15 border border-indigo-500/40 p-8 sm:p-12 text-center space-y-6">
          <h2 className="text-3xl font-bold text-white font-heading">
            Explore what Corelith is building.
          </h2>
          <p className="text-gray-300 text-sm max-w-xl mx-auto">
            Discover our flagship developer platform, explore our software portfolio, or connect directly with our engineering team.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
            <Link
              href="/products"
              className="px-6 py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-xl shadow-indigo-600/30"
            >
              View Products Portfolio
            </Link>
            <Link
              href="/contact"
              className="px-6 py-3.5 rounded-xl bg-[#141722] border border-white/10 text-gray-200 font-semibold text-sm hover:bg-white/5"
            >
              Contact Engineering Team
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
