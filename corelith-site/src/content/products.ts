/**
 * Corelith's own products.
 *
 * Paralith's facts are taken from the shipping application: version and channel
 * from its release metadata, the stack from its own README, the platform from
 * what its release pipeline actually builds and signs. The previous site listed
 * macOS and Linux downloads with invented file sizes and checksums; none of
 * those builds exist, so none of them appear here.
 */

export type Product = {
  slug: string;
  name: string;
  wordmark: string;
  category: string;
  status: "Shipping" | "In development" | "Research";
  brief: string;
  full: string;
  /** Facts a reader can check against the product itself. */
  facts: { label: string; value: string }[];
  pillars: { title: string; body: string }[];
  platforms: { name: string; state: "Available" | "Not yet released" }[];
  stack: string[];
};

export const paralith: Product = {
  slug: "paralith",
  name: "Paralith",
  wordmark: "PARALITH",
  category: "Agentic Development Environment",
  status: "Shipping",
  brief:
    "A development environment where several coding agents work on a real project at once — inside durable sessions, against isolated worktrees, with the evidence of what they did kept as structured records rather than chat history.",
  full:
    "Paralith is the product Corelith built for its own engineering, and now ships. It runs Claude and Codex inside development sessions that outlive the panel they were opened in, coordinates several agents across isolated Git worktrees, and keeps what it learns about a project as typed, provenance-backed knowledge instead of a transcript archive. It is a native desktop application, and everything it knows stays on the machine it runs on.",
  facts: [
    { label: "Current release", value: "0.4.14" },
    { label: "Channel", value: "Stable" },
    { label: "Runtime", value: "Native desktop, Tauri 2" },
    { label: "Persistence", value: "Local SQLite, schema v36" },
    { label: "Updates", value: "Signed, verified before install" },
  ],
  pillars: [
    {
      title: "Sessions that outlive the panel",
      body: "Terminals and agent sessions are backend processes with their own lifetime. Rearranging the workspace, detaching a panel into its own window, or moving it to another monitor does not restart the work happening inside it.",
    },
    {
      title: "Parallel work, isolated properly",
      body: "Concurrent agent work runs in separate Git worktrees, so two agents editing the same repository cannot overwrite each other. Coordination is explicit rather than hoped for.",
    },
    {
      title: "Typed state, not scraped output",
      body: "Agent runs carry real runtime state — queued, working, needs input, needs permission, failed — as structured records. The interface reads that state rather than guessing from terminal text.",
    },
    {
      title: "Knowledge with provenance",
      body: "What Paralith knows about a project is stored as claims, evidence, relations and sources, each linked back to the run and artifact it came from. Contradictions surface instead of quietly overwriting.",
    },
    {
      title: "Evidence you can inspect",
      body: "Commands, exit status, files changed, diffs, commits and validation results are recorded against the run that produced them. What happened is answerable without trusting a summary.",
    },
    {
      title: "Local by construction",
      body: "Project data lives in a local database on your machine. Filesystem access is scoped to the project root by a guard in the Rust runtime, not by a check in the interface.",
    },
  ],
  platforms: [
    { name: "Windows", state: "Available" },
    { name: "macOS", state: "Not yet released" },
    { name: "Linux", state: "Not yet released" },
  ],
  stack: ["Tauri 2", "Rust", "React", "TypeScript", "SQLite", "portable-pty", "xterm.js"],
};

export const products: Product[] = [paralith];
