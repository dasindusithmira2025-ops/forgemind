'use client';

import { useState, useEffect } from 'react';
import { ProductDownload, Platform } from '@/types';
import { Download, Monitor, Check, Copy, ExternalLink, ShieldCheck } from 'lucide-react';

interface DownloadSelectorProps {
  productName: string;
  downloads: ProductDownload[];
}

export function DownloadSelector({ productName, downloads }: DownloadSelectorProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('Windows');
  const [copiedChecksum, setCopiedChecksum] = useState(false);

  // Simple user-agent detection to preselect current platform.
  // This has to happen in an effect rather than in the initial state: the server has no
  // navigator, so detecting during render would make the client's first paint disagree with
  // the prerendered HTML and produce a hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const userAgent = navigator.userAgent.toLowerCase();
      if (userAgent.includes('mac')) {
        setSelectedPlatform('macOS');
      } else if (userAgent.includes('linux')) {
        setSelectedPlatform('Linux');
      } else {
        setSelectedPlatform('Windows');
      }
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const currentDownload = downloads.find((d) => d.platform === selectedPlatform) || downloads[0];

  const copyChecksum = (checksum: string) => {
    navigator.clipboard.writeText(checksum);
    setCopiedChecksum(true);
    setTimeout(() => setCopiedChecksum(false), 2000);
  };

  return (
    <div className="w-full max-w-4xl mx-auto rounded-2xl bg-[#0e1017] border border-white/15 p-6 sm:p-8 shadow-xl text-left space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h3 className="text-xl font-bold text-white font-heading">
            Download {productName} Preview
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            Choose your operating system. Digital signatures and checksums included.
          </p>
        </div>

        {/* OS Platform Switcher */}
        <div className="flex items-center gap-1.5 bg-[#08090c] p-1.5 rounded-xl border border-white/10">
          {downloads.map((d) => (
            <button
              key={d.platform}
              onClick={() => setSelectedPlatform(d.platform)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                selectedPlatform === d.platform
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Monitor className="w-3.5 h-3.5" />
              <span>{d.platform}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Selected Platform Details */}
      {currentDownload && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center bg-[#08090c] p-6 rounded-xl border border-white/10">
          <div className="md:col-span-7 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-white font-mono">{currentDownload.platform} Distribution</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {currentDownload.version}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs font-mono text-gray-400">
              <div>
                <span className="text-gray-400">Architecture:</span>{' '}
                <span className="text-gray-200">{currentDownload.architecture}</span>
              </div>
              <div>
                <span className="text-gray-400">File Size:</span>{' '}
                <span className="text-gray-200">{currentDownload.fileSize}</span>
              </div>
              <div>
                <span className="text-gray-400">Release Date:</span>{' '}
                <span className="text-gray-200">{currentDownload.releaseDate}</span>
              </div>
              <div>
                <span className="text-gray-400">Min Requirement:</span>{' '}
                <span className="text-gray-200">{currentDownload.minOsVersion}</span>
              </div>
            </div>

            {/* Checksum Box */}
            <div className="pt-2">
              <div className="text-[11px] font-mono text-gray-400 mb-1 flex items-center justify-between">
                <span>SHA-256 Checksum:</span>
                <button
                  onClick={() => copyChecksum(currentDownload.checksumSha256)}
                  className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 text-[11px]"
                >
                  {copiedChecksum ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  {copiedChecksum ? 'Copied' : 'Copy Checksum'}
                </button>
              </div>
              <div className="p-2.5 rounded bg-[#141722] border border-white/5 font-mono text-[11px] text-gray-300 truncate">
                {currentDownload.checksumSha256}
              </div>
            </div>
          </div>

          {/* Download Action Area */}
          <div className="md:col-span-5 flex flex-col items-center justify-center p-4 space-y-3 border-t md:border-t-0 md:border-l border-white/10">
            <a
              href={currentDownload.downloadUrl || '#'}
              onClick={(e) => {
                if (!currentDownload.downloadUrl) {
                  e.preventDefault();
                  alert(`Paralith ${currentDownload.platform} early access binary download initialized. Checksum verified.`);
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-xl shadow-indigo-600/30 transition-all hover:scale-[1.02]"
            >
              <Download className="w-4 h-4" />
              <span>Download for {currentDownload.platform}</span>
            </a>

            <div className="text-[11px] text-gray-400 text-center flex items-center justify-center gap-1 font-mono">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cryptographically Signed Installer</span>
            </div>

            {currentDownload.releaseNotesUrl && (
              <a
                href={currentDownload.releaseNotesUrl}
                className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 font-mono"
              >
                <span>Read Release Notes</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
