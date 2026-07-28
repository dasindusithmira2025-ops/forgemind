import { companyData } from '@/data/company';
import { Cpu, Terminal, Shield, Workflow, Layers, Activity } from 'lucide-react';

export function CapabilitiesGrid() {
  const icons = [Cpu, Terminal, Activity, Layers];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
      {companyData.capabilities.map((cap, idx) => {
        const IconComponent = icons[idx % icons.length];
        return (
          <div
            key={cap.category}
            className="corelith-card p-6 flex flex-col justify-between space-y-4 hover:border-indigo-500/50"
          >
            <div className="space-y-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                <IconComponent className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white font-heading">
                {cap.category}
              </h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                {cap.description}
              </p>
            </div>
            <div className="pt-2 text-[11px] font-mono text-indigo-400 font-medium">
              Corelith Domain 0{idx + 1}
            </div>
          </div>
        );
      })}
    </div>
  );
}
