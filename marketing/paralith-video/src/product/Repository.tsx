import React from 'react';
import { Bot, FileCode2, GitCommitHorizontal, Search, Upload, User } from 'lucide-react';

/**
 * The Repository view's Changes section: the working tree on the left, the selected file's diff
 * on the right, the commit box beneath it.
 *
 * The detail the film is really here for is `.repo-owner-agent` — the product tags every changed
 * file with the agent that touched it, or with "you". That tag is the reason the closing argument
 * works: six agents wrote to one repository and the working tree can still say which of them
 * wrote what, so approving their work is a decision rather than an act of faith.
 *
 * Source: features/repository/components/ChangesSection.tsx.
 */

export interface ChangeRow {
  path: string;
  /** Git's short status letter, drawn in `.repo-file-glyph`. */
  glyph: string;
  kind: 'staged' | 'changed' | 'untracked';
  statusWord: string;
  /** The agent that made the change, or undefined for a local edit ("you"). */
  agent?: string;
}

export const DiffRow: React.FC<{
  kind: 'add' | 'del' | 'hunk' | 'meta' | 'context';
  line?: number;
  sign?: string;
  text: string;
}> = ({ kind, line, sign, text }) => (
  <div className={`repo-diff-row kind-${kind}`}>
    <span className="repo-diff-gutter">{line ?? ''}</span>
    <span className="repo-diff-sign">{sign ?? ''}</span>
    <span className="repo-diff-text">{text}</span>
  </div>
);

export interface RepositoryChangesProps {
  files: readonly ChangeRow[];
  selectedPath: string;
  diff: readonly { kind: 'add' | 'del' | 'hunk' | 'meta' | 'context'; line?: number; text: string }[];
  /** How many diff rows have been revealed. Lets a scene walk the hunk on the timeline. */
  diffRevealed?: number;
  commitMessage?: string;
  /** Characters of the commit message typed so far. */
  commitTyped?: number;
  stagedCount: number;
}

export const RepositoryChanges: React.FC<RepositoryChangesProps> = ({
  files,
  selectedPath,
  diff,
  diffRevealed,
  commitMessage = '',
  commitTyped,
  stagedCount,
}) => {
  const rows = diffRevealed === undefined ? diff : diff.slice(0, diffRevealed);
  const message = commitTyped === undefined ? commitMessage : commitMessage.slice(0, commitTyped);
  const added = diff.filter((row) => row.kind === 'add').length;
  const removed = diff.filter((row) => row.kind === 'del').length;

  return (
    <div className="repo-changes" style={{ height: '100%' }}>
      <div className="repo-changes-list">
        <div className="repo-list-toolbar">
          <div className="repo-search">
            <Search size={13} />
            <span className="repo-muted">Filter files</span>
          </div>
        </div>

        <div className="repo-file-group group-changed">
          <div className="repo-file-group-head">
            <span className="repo-file-group-title">Changes</span>
            <span className="repo-count">{files.length}</span>
          </div>
          <ul>
            {files.map((file) => (
              <li key={file.path} className={file.path === selectedPath ? 'active' : ''}>
                <button className="repo-file-main">
                  <span className={`repo-file-glyph glyph-${file.kind}`}>{file.glyph}</span>
                  <span className="repo-file-path">{file.path}</span>
                  <span className="repo-file-tags">
                    {file.agent ? (
                      <span className="repo-owner repo-owner-agent">
                        <Bot size={11} />
                        {file.agent}
                      </span>
                    ) : (
                      <span className="repo-owner repo-owner-human">
                        <User size={11} />
                        you
                      </span>
                    )}
                    <span className="repo-status-word">{file.statusWord}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="repo-changes-detail">
        <div className="repo-detail-toolbar">
          <div className="repo-detail-file">
            <FileCode2 size={14} /> <code>{selectedPath}</code>
          </div>
          <div className="repo-segmented" role="tablist">
            <button className="active">Unified</button>
            <button>Split</button>
          </div>
        </div>

        <div className="repo-detail-body">
          <div className="repo-diff">
            <div className="repo-diff-toolbar">
              <span className="repo-diff-mode-label">Unified</span>
              <span className="repo-diff-stat">
                <span className="add">+{added}</span> <span className="del">−{removed}</span>
              </span>
            </div>
            <div className="repo-diff-scroll">
              <div className="repo-diff-canvas">
                {rows.map((row, index) => (
                  <DiffRow
                    key={index}
                    kind={row.kind}
                    line={row.line}
                    sign={row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ''}
                    text={row.text}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="repo-commit-box">
          <textarea readOnly rows={2} value={message} placeholder="Commit message" />
          <div className="repo-commit-actions">
            <span className="repo-muted">{stagedCount} staged · 6 changed</span>
            <div className="repo-commit-buttons">
              <button className="button button-secondary">
                <GitCommitHorizontal size={14} />
                Commit
              </button>
              <button className="button button-primary">
                <Upload size={14} />
                Push
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
