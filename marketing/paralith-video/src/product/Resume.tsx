import React from 'react';
import { Clipboard, ExternalLink, Play, RotateCcw, Trash2, X } from 'lucide-react';
import { RESUME_RECORDS, type ResumeRecordData } from './swarmScenario';

/**
 * The Agent Resume Center: `features/agent-resume/AgentResumeCenter.tsx`, inside the product's own
 * `Modal`.
 *
 * This is the continuity sequence's whole argument, and it is the product's argument rather than
 * the film's — the intro line under the count is the component's own string, not a marketing
 * rewrite of it. A session here is not a summary of what an agent did; it is the agent's actual
 * provider session id, resumable in the worktree it was started in.
 *
 * The film shows it in the state the product is designed around: PARALITH has just restarted to
 * install an update, and the sessions that were interrupted are waiting to be resumed. That is the
 * documented path in `services/agent_resume.rs`, not a hypothetical.
 */

export interface ResumeCenterProps {
  records?: readonly ResumeRecordData[];
  /** Rows that have appeared so far. The list populates on camera as the recheck completes. */
  revealed?: number;
  /** The row the pointer is resting on, which draws the product's own hover treatment. */
  hoveredId?: string;
  /** Marks a row as resumed — its status flips to `running` and its edge turns green. */
  resumedIds?: readonly string[];
}

export const ResumeCenter: React.FC<ResumeCenterProps> = ({
  records = RESUME_RECORDS,
  revealed = RESUME_RECORDS.length,
  hoveredId,
  resumedIds = [],
}) => {
  const visible = records.slice(0, revealed);
  const resumed = new Set(resumedIds);
  const resumableCount = visible.filter((record) => !resumed.has(record.id)).length;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal" role="dialog" aria-modal="true">
        <header>
          <h2>Agent Resume Center</h2>
          <button type="button" className="button button-ghost" aria-label="Close dialog">
            <X size={16} />
          </button>
        </header>

        <div className="agent-resume-center">
          <div className="agent-resume-intro">
            <div>
              <strong>
                {visible.length} saved session{visible.length === 1 ? '' : 's'}
              </strong>
              <span>Exact Claude and Codex sessions tied to their original worktrees.</span>
            </div>
            <button type="button" className="button button-ghost">
              <RotateCcw size={14} /> Recheck
            </button>
          </div>

          <div className="agent-resume-list">
            {visible.map((record) => {
              const running = resumed.has(record.id);
              const status = running ? 'running' : record.status;
              return (
                <article
                  className={`agent-resume-row is-${status}`}
                  key={record.id}
                  style={hoveredId === record.id ? { background: 'var(--surface-hover)' } : undefined}
                >
                  <div
                    className={`agent-resume-provider is-${record.provider === 'Claude Code' ? 'claude' : 'codex'}`}
                    aria-label={record.provider}
                  >
                    {record.provider === 'Claude Code' ? 'CL' : 'CX'}
                  </div>
                  <div className="agent-resume-main">
                    <div className="agent-resume-heading">
                      <strong>{record.title}</strong>
                      <span className={`agent-resume-status is-${status}`}>{status}</span>
                      <time>{record.lastActive}</time>
                    </div>
                    <div className="agent-resume-location">
                      <span>{record.project}</span>
                      <span>checkout-rewrite</span>
                      <span>
                        {record.branch} · {record.worktreePath}
                      </span>
                    </div>
                    <code className="agent-resume-command">{record.command}</code>
                    <div className="agent-resume-actions">
                      <button type="button" className="button button-primary" disabled={running}>
                        <Play size={13} /> Resume
                      </button>
                      <button type="button" disabled={running}>
                        Resume in new terminal
                      </button>
                      <button type="button">
                        <ExternalLink size={13} />
                        Open project
                      </button>
                      <button type="button">
                        <Clipboard size={13} />
                        Copy command
                      </button>
                      <button type="button">
                        <X size={13} />
                        Dismiss
                      </button>
                      <button type="button" className="danger-item" disabled={running}>
                        <Trash2 size={13} />
                        Remove
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          <footer className="agent-resume-footer">
            <button type="button" className="button button-ghost">
              Dismiss all
            </button>
            <button type="button" className="button button-primary" disabled={resumableCount === 0}>
              <Play size={14} /> Resume all ({resumableCount})
            </button>
          </footer>
        </div>
      </section>
    </div>
  );
};
