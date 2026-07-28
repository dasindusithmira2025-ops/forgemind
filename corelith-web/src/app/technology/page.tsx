import { Metadata } from 'next';
import { TechDiagram } from '@/components/TechDiagram';
import { Cpu, Terminal, ShieldCheck, Database, Lock, Server } from 'lucide-react';

export const metadata: Metadata = {
  title: 'Technology & Architecture',
  description:
    'Deep-dive into Corelith Technologies engineering architecture: Agentic execution engines, persistent AST memory graphs, sandboxed PTY runtime, and zero-telemetry security.',
};

export default function TechnologyPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-20 pb-20">
      {/* HERO */}
      <div className="text-center max-w-4xl mx-auto space-y-4 pt-6">
        <div className="text-xs uppercase tracking-wider text-indigo-400 font-mono font-bold">
          Technology Foundation
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-white font-heading tracking-tight">
          Intelligent systems built on rigorous software architecture.
        </h1>
        <p className="text-lg text-gray-300 max-w-3xl mx-auto leading-relaxed">
          Corelith combines local-first AST indexing, parallel multi-agent orchestrators, native PTY terminal integration, and continuous empirical verification engines.
        </p>
      </div>

      {/* INTERACTIVE DIAGRAM */}
      <section className="space-y-4 text-center">
        <TechDiagram />
      </section>

      {/* DETAILED PILLARS */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="corelith-card p-6 text-left space-y-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Database className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white font-heading">
            Persistent AST Memory Graph
          </h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Our engines build an incremental abstract syntax tree (AST) graph locally on disk. Agents reference symbol relationships, import dependencies, and Git diffs without re-scanning files.
          </p>
        </div>

        <div className="corelith-card p-6 text-left space-y-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-600/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Terminal className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white font-heading">
            Native PTY Shell Sandbox
          </h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Embedded terminal sessions run inside asynchronous pseudo-terminal (PTY) boundaries. Command outputs are audited and filtered to prevent destructive file operations.
          </p>
        </div>

        <div className="corelith-card p-6 text-left space-y-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-600/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h3 className="text-lg font-bold text-white font-heading">
            Empirical Verification
          </h3>
          <p className="text-xs text-gray-400 leading-relaxed">
            Code changes must pass strict automated static analysis, linter checks, and unit test suites before landing in active workspaces.
          </p>
        </div>
      </section>
    </div>
  );
}
