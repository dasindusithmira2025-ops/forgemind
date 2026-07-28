'use client';

import { useState } from 'react';
import { Terminal, ShieldCheck, Cpu, Code2, GitBranch, CheckCircle2, Play, Activity } from 'lucide-react';

export function ParalithHeroVisual() {
  const [activeTab, setActiveTab] = useState<'agent' | 'terminal' | 'verification'>('agent');

  return (
    <div className="w-full max-w-5xl mx-auto rounded-2xl bg-[#0e1017] border border-white/15 shadow-2xl shadow-indigo-950/40 overflow-hidden text-left relative group">
      {/* Top Window Bar */}
      <div className="bg-[#141722] border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500/80" />
          <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
          <div className="w-3 h-3 rounded-full bg-green-500/80" />
          <span className="ml-3 text-xs font-mono text-gray-400 flex items-center gap-1.5">
            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
            paralith-workspace // corelith_v0.9.4
          </span>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-1 bg-[#08090c] p-1 rounded-lg border border-white/5 text-xs font-mono">
          <button
            onClick={() => setActiveTab('agent')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'agent' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Agent Canvas</span>
          </button>
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'terminal' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Integrated Terminal</span>
          </button>
          <button
            onClick={() => setActiveTab('verification')}
            className={`px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 ${
              activeTab === 'verification' ? 'bg-indigo-600 text-white font-medium' : 'text-gray-400 hover:text-white'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Verification Pipeline</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Canvas Area */}
      <div className="grid grid-cols-1 md:grid-cols-12 min-h-[380px] bg-[#08090c]/90 text-xs font-mono">
        {/* Left Sidebar: AST Memory & Workspaces */}
        <div className="md:col-span-3 border-r border-white/10 p-3 space-y-4 bg-[#0e1017]/60">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2 flex items-center justify-between">
              <span>Project Memory Graph</span>
              <Activity className="w-3 h-3 text-emerald-400 animate-pulse" />
            </div>
            <div className="space-y-1.5">
              <div className="p-2 rounded bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 flex items-center justify-between">
                <span className="truncate">src/core/agent_engine.rs</span>
                <span className="text-[10px] text-emerald-400">Indexed</span>
              </div>
              <div className="p-2 rounded bg-white/5 border border-white/5 text-gray-400 flex items-center justify-between">
                <span className="truncate">src/pty/terminal.ts</span>
                <span className="text-[10px] text-emerald-400">Indexed</span>
              </div>
              <div className="p-2 rounded bg-white/5 border border-white/5 text-gray-400 flex items-center justify-between">
                <span className="truncate">tests/verification.rs</span>
                <span className="text-[10px] text-emerald-400">Indexed</span>
              </div>
            </div>
          </div>

          <div className="pt-2 border-t border-white/10">
            <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-2">Active Agents</div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between p-2 rounded bg-white/5 text-gray-300">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                  Agent-Alpha (Refactor)
                </span>
                <span className="text-gray-400">Busy</span>
              </div>
              <div className="flex items-center justify-between p-2 rounded bg-white/5 text-gray-400">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  Agent-Beta (Verifier)
                </span>
                <span className="text-emerald-400">Idle</span>
              </div>
            </div>
          </div>
        </div>

        {/* Center Panel: Content changes based on Active Tab */}
        <div className="md:col-span-9 p-4 flex flex-col justify-between">
          {activeTab === 'agent' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-indigo-400 font-semibold flex items-center gap-2">
                  <Code2 className="w-4 h-4" />
                  Agent Execution Stream // Target: src/core/agent_engine.rs
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  Strict Validation Mode
                </span>
              </div>

              <div className="bg-[#050608] p-3 rounded-lg border border-white/10 font-mono text-gray-300 space-y-1 text-[11.5px] overflow-x-auto">
                {/* Braced strings: these are lines of displayed sample code, not JSX comments. */}
                <p className="text-gray-400">{'// Paralith Agent generating atomic patch with memory context...'}</p>
                <p className="text-emerald-400">+ pub async fn execute_verified_task(task: &TaskSpec) -&gt; Result&lt;ExecutionReport&gt; &#123;</p>
                <p className="text-emerald-400">+     let memory_ctx = self.project_memory.query_ast(&task.symbols).await?;</p>
                <p className="text-emerald-400">+     let pty_session = self.terminal_pool.acquire_isolated_pty().await?;</p>
                <p className="text-gray-400">{'      // Continuous empirical verification check'}</p>
                <p className="text-emerald-400">+     let verification = self.verifier.run_test_suite(&pty_session).await?;</p>
                <p className="text-emerald-400">+     Ok(ExecutionReport::new(memory_ctx, verification))</p>
                <p className="text-emerald-400">+ &#125;</p>
              </div>

              <div className="flex items-center gap-3 pt-2 text-gray-400">
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> AST Context Validated
                </span>
                <span>•</span>
                <span className="flex items-center gap-1 text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Zero Lint Diagnostics
                </span>
              </div>
            </div>
          )}

          {activeTab === 'terminal' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-emerald-400 font-semibold flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  PTY Shell Session 1 (pwsh / bash)
                </span>
                <span className="text-[10px] text-gray-400">PID: 4892 • PAGER=cat</span>
              </div>

              <div className="bg-[#050608] p-3 rounded-lg border border-white/10 font-mono text-gray-300 space-y-1.5 text-[11.5px]">
                <p className="text-gray-400">$ paralith-cli verify --workspace ./ --strict</p>
                <p className="text-indigo-400">[INFO] Loading local project AST memory graph... done (1,420 nodes)</p>
                <p className="text-indigo-400">[INFO] Spawning background worker thread pool (8 threads)...</p>
                <p className="text-emerald-400">[PASS] cargo test --all (142 tests passed in 0.84s)</p>
                <p className="text-emerald-400">[PASS] binary SHA256 checksum generated & signed.</p>
                <div className="flex items-center gap-1 text-gray-400 pt-1">
                  <span>$</span>
                  <span className="w-2 h-4 bg-indigo-500 animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {activeTab === 'verification' && (
            <div className="space-y-3 animate-in fade-in duration-200">
              <div className="flex items-center justify-between pb-2 border-b border-white/10">
                <span className="text-cyan-400 font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Automated Verification Suite Results
                </span>
                <span className="text-emerald-400 font-bold">100% VERIFIED</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded bg-white/5 border border-white/10">
                  <div className="text-gray-400 text-[10px]">UNIT & INTEGRATION</div>
                  <div className="text-lg font-bold text-white mt-1">142 / 142</div>
                  <div className="text-emerald-400 text-[10px] flex items-center gap-1 mt-1">
                    <CheckCircle2 className="w-3 h-3" /> All Passing
                  </div>
                </div>
                <div className="p-3 rounded bg-white/5 border border-white/10">
                  <div className="text-gray-400 text-[10px]">MEMORY LATENCY</div>
                  <div className="text-lg font-bold text-white mt-1">1.2 ms</div>
                  <div className="text-cyan-400 text-[10px] flex items-center gap-1 mt-1">
                    <Activity className="w-3 h-3" /> Zero Leak
                  </div>
                </div>
                <div className="p-3 rounded bg-white/5 border border-white/10">
                  <div className="text-gray-400 text-[10px]">CODE COVERAGE</div>
                  <div className="text-lg font-bold text-white mt-1">94.8%</div>
                  <div className="text-indigo-400 text-[10px] flex items-center gap-1 mt-1">
                    <ShieldCheck className="w-3 h-3" /> Strict Threshold
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bottom Bar inside canvas */}
          <div className="pt-3 border-t border-white/10 flex items-center justify-between text-gray-400 text-[11px]">
            <span className="flex items-center gap-2">
              <Play className="w-3 h-3 text-indigo-400" />
              Paralith Agent Environment v0.9.4 Preview
            </span>
            <span className="text-gray-400">Local-First • Air-Gapped Mode Active</span>
          </div>
        </div>
      </div>
    </div>
  );
}
