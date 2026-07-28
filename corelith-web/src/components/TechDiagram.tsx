'use client';

import { useState } from 'react';
import { Database, Cpu, Terminal, ShieldCheck, ArrowRight, Lock, Server } from 'lucide-react';

export function TechDiagram() {
  const [activeStep, setActiveStep] = useState<number>(1);

  const steps = [
    {
      id: 1,
      title: 'Local AST & Memory Index',
      description: 'Code syntax trees and Git history graph are indexed locally in encrypted SQLite storage.',
      icon: Database,
      tag: 'Local Storage',
    },
    {
      id: 2,
      title: 'Agentic Execution Controller',
      description: 'Agents process prompt intents, reference local memory, and formulate atomic diff patches.',
      icon: Cpu,
      tag: 'Parallel Threads',
    },
    {
      id: 3,
      title: 'PTY Terminal & Process Sandbox',
      description: 'Commands execute inside isolated native PTY shells with strict user-configured permissions.',
      icon: Terminal,
      tag: 'Sandboxed PTY',
    },
    {
      id: 4,
      title: 'Empirical Verification Engine',
      description: 'Linter, build passes, and unit tests verify changes before committing to Git branch.',
      icon: ShieldCheck,
      tag: '100% Verifiable',
    },
  ];

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl bg-[#0e1017] border border-white/15 p-6 sm:p-8 space-y-8 text-left shadow-2xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h3 className="text-xl font-bold text-white font-heading">
            Corelith Agentic Execution Pipeline
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Click each phase to inspect technical security and data isolation boundaries.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-mono text-xs">
          <Lock className="w-3.5 h-3.5" />
          <span>Local-First Boundary Enforced</span>
        </div>
      </div>

      {/* Interactive Step Navigator */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {steps.map((step) => {
          const StepIcon = step.icon;
          const isActive = activeStep === step.id;
          return (
            <button
              key={step.id}
              onClick={() => setActiveStep(step.id)}
              className={`p-4 rounded-xl border text-left transition-all ${
                isActive
                  ? 'bg-indigo-600/15 border-indigo-500 text-white shadow-lg shadow-indigo-600/20'
                  : 'bg-[#08090c] border-white/10 text-gray-400 hover:border-white/20 hover:text-gray-200'
              }`}
            >
              <div className="flex items-center justify-between mb-3">
                <div
                  className={`p-2 rounded-lg ${
                    isActive ? 'bg-indigo-600 text-white' : 'bg-white/5 text-indigo-400'
                  }`}
                >
                  <StepIcon className="w-5 h-5" />
                </div>
                <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-white/5 border border-white/10">
                  Step 0{step.id}
                </span>
              </div>
              <div className="font-heading font-bold text-sm text-white">{step.title}</div>
              <div className="text-[11px] font-mono text-indigo-400 mt-1">{step.tag}</div>
            </button>
          );
        })}
      </div>

      {/* Detailed Inspection Box */}
      <div className="bg-[#08090c] p-6 rounded-xl border border-white/10 space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 font-mono text-xs">
          <span className="text-indigo-400 font-bold flex items-center gap-2">
            <Server className="w-4 h-4" />
            Phase 0{activeStep} Specification Details
          </span>
          <span className="text-gray-400">Zero Code Telemetry Leakage</span>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed font-body">
          {steps.find((s) => s.id === activeStep)?.description}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono text-xs text-gray-400 pt-2">
          <div className="p-3 rounded bg-[#141722] border border-white/5">
            <span className="text-gray-400 block text-[10px]">ENCRYPTION</span>
            <span className="text-white font-semibold mt-1 block">AES-256-GCM / Local</span>
          </div>
          <div className="p-3 rounded bg-[#141722] border border-white/5">
            <span className="text-gray-400 block text-[10px]">NETWORK BOUNDARY</span>
            <span className="text-white font-semibold mt-1 block">TLS 1.3 Strict Proxy</span>
          </div>
          <div className="p-3 rounded bg-[#141722] border border-white/5">
            <span className="text-gray-400 block text-[10px]">ROLLBACK GUARANTEE</span>
            <span className="text-emerald-400 font-semibold mt-1 block">100% Deterministic</span>
          </div>
        </div>
      </div>
    </div>
  );
}
