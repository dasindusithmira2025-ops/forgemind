'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ProductDownload, Platform } from '@/types';

interface DownloadSelectorProps {
  productName: string;
  downloads: ProductDownload[];
}

/**
 * The release plate: platform tabs, a colophon of build facts, the checksum,
 * and one action.
 */
export function DownloadSelector({ productName, downloads }: DownloadSelectorProps) {
  const [selectedPlatform, setSelectedPlatform] = useState<Platform>('Windows');
  const [copied, setCopied] = useState(false);

  // Simple user-agent detection to preselect current platform.
  // This has to happen in an effect rather than in the initial state: the server has no
  // navigator, so detecting during render would make the client's first paint disagree with
  // the prerendered HTML and produce a hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('mac')) {
      setSelectedPlatform('macOS');
    } else if (ua.includes('linux') && !ua.includes('android')) {
      setSelectedPlatform('Linux');
    } else {
      setSelectedPlatform('Windows');
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const current = downloads.find((d) => d.platform === selectedPlatform) ?? downloads[0];

  const copyChecksum = async (checksum: string) => {
    try {
      await navigator.clipboard.writeText(checksum);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied outright; the checksum stays selectable
      // on the page, so there is nothing to recover from and nothing to claim.
      setCopied(false);
    }
  };

  if (!current) return null;

  return (
    <div className="panel">
      <div className="flex flex-col gap-4 border-b border-[var(--hair)] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl">Download {productName}</h2>
          <p className="stamp text-ink-faint mt-2.5">Signed installers ◆ Checksums published</p>
        </div>

        <div
          role="tablist"
          aria-label="Platform"
          className="flex gap-1 self-start rounded-md border border-[var(--hair-strong)] bg-paper-2 p-1 sm:self-auto"
        >
          {downloads.map((d) => {
            const active = d.platform === current.platform;
            return (
              <button
                key={d.platform}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSelectedPlatform(d.platform)}
                className={`stamp rounded px-3.5 py-2.5 transition-colors ${
                  active ? 'text-ink bg-[rgba(245,237,224,0.09)]' : 'text-ink-faint hover:text-ink-soft'
                }`}
              >
                {d.platform}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Build facts */}
        <div className="col-span-1 border-b border-[var(--hair)] p-6 lg:col-span-7 lg:border-r lg:border-b-0">
          <dl className="grid grid-cols-1 sm:grid-cols-2">
            {[
              { k: 'Version', v: current.version },
              { k: 'Architecture', v: current.architecture },
              { k: 'File size', v: current.fileSize },
              { k: 'Released', v: current.releaseDate },
              { k: 'Requires', v: current.minOsVersion },
            ].map((row) => (
              <div key={row.k} className="border-b border-[var(--hair)] py-3 sm:pr-6">
                <dt className="stamp text-ink-faint">{row.k}</dt>
                <dd className="text-ink mt-2 font-mono text-sm">{row.v}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="stamp text-ink-faint">SHA-256</p>
              <button
                type="button"
                onClick={() => copyChecksum(current.checksumSha256)}
                className="stamp text-core-ink hover:text-ink transition-colors"
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
            <p className="well text-ink-soft mt-2.5 overflow-x-auto p-3 font-mono text-xs break-all">
              {current.checksumSha256}
            </p>
            <span aria-live="polite" className="sr-only">
              {copied ? 'Checksum copied to clipboard' : ''}
            </span>
          </div>
        </div>

        {/* Action */}
        <div className="col-span-1 flex flex-col justify-center gap-5 p-6 lg:col-span-5">
          {current.downloadUrl ? (
            <a href={current.downloadUrl} className="btn btn-primary btn-lg w-full">
              Download for {current.platform}
              <span aria-hidden="true">↓</span>
            </a>
          ) : (
            <>
              {/* No artifact is published for this platform yet. An enabled button
                  here would be a dead control, so it states the real situation and
                  routes to the only path that actually works. */}
              <button type="button" className="btn btn-primary btn-lg w-full" disabled>
                {current.platform} build — not yet public
              </button>
              <p className="text-ink-soft text-sm">
                Preview binaries are issued individually while Paralith is in early access. Request
                access and we will send the signed {current.platform} installer and its checksum.
              </p>
              <Link
                href="/contact?category=product-support"
                className="btn btn-secondary btn-lg w-full"
              >
                Request early access
                <span aria-hidden="true">→</span>
              </Link>
            </>
          )}

          {current.releaseNotesUrl && (
            <a
              href={current.releaseNotesUrl}
              className="stamp text-core-ink hover:text-ink self-start transition-colors"
            >
              Read release notes →
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
