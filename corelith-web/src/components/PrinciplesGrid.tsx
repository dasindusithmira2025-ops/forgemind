import { companyData } from '@/data/company';
import { ShieldCheck, Cpu, Activity, Lock, Layers, Eye } from 'lucide-react';

export function PrinciplesGrid() {
  const icons = [Activity, Eye, Lock, Cpu, Layers, ShieldCheck];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {companyData.principles.map((item, idx) => {
        const IconComponent = icons[idx % icons.length];
        return (
          <div
            key={item.title}
            className="corelith-card p-6 space-y-4 hover:border-indigo-500/40 relative overflow-hidden group"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                {item.subtitle}
              </span>
              <span className="text-xs font-mono text-gray-400">0{idx + 1}</span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <IconComponent className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" />
                <h3 className="text-lg font-bold text-white font-heading">
                  {item.title}
                </h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                {item.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
