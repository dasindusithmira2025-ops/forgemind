/**
 * Selected work.
 *
 * `kind` is load-bearing and is rendered on every card and case study. Corelith
 * has no public client engagements yet, so every entry here is internal product
 * work and is labelled as such. When a client project becomes publishable it is
 * added with kind: "client" — nothing here is presented ambiguously in the
 * meantime.
 */

export type WorkKind = "internal" | "client";

export type CaseStudy = {
  slug: string;
  index: string;
  name: string;
  kind: WorkKind;
  /** Rendered next to the name. States plainly whose project this is. */
  kindLabel: string;
  year: string;
  descriptor: string;
  disciplines: string[];
  /** The one-line summary used on the work index. */
  brief: string;
  context: string;
  problem: { heading: string; body: string }[];
  decisions: { title: string; body: string }[];
  architecture: { layer: string; body: string }[];
  outcome: { label: string; value: string; note: string }[];
  lessons: string[];
};

export const caseStudies: CaseStudy[] = [
  {
    slug: "paralith",
    index: "01",
    name: "Paralith",
    kind: "internal",
    kindLabel: "Corelith product",
    year: "2026",
    descriptor: "An agentic development environment, built and shipped by Corelith",
    disciplines: ["Product Engineering", "AI Systems", "Experience Engineering", "Infrastructure"],
    brief:
      "A native desktop environment for running several coding agents against one real repository, with durable sessions, isolated worktrees and provenance-backed project knowledge.",
    context:
      "Corelith builds software with coding agents as a matter of routine. The available tooling assumed a single agent, a single conversation, and a single working tree — and lost everything the moment a window closed. Paralith started as the internal answer to that and became a product.",
    problem: [
      {
        heading: "Agent work had no durable identity",
        body: "A long-running agent session lived inside a UI component. Rearranging a panel, opening a second window, or a stray rerender could end an hour of work. Process lifetime and component lifetime were the same thing, and they should never have been.",
      },
      {
        heading: "Parallel agents corrupted each other",
        body: "Two agents editing one working tree produce a mess that is expensive to untangle and easy to miss. Any real parallelism needed isolation that was enforced rather than agreed.",
      },
      {
        heading: "State was inferred from terminal text",
        body: "Whether an agent was waiting for input, blocked on a permission, or finished was being read out of scrollback. That is a guess, and it was wrong often enough to matter.",
      },
      {
        heading: "Project knowledge was a transcript",
        body: "Everything the system knew was buried in conversation history, with no way to ask what it believed, why, or whether two sessions had reached contradictory conclusions.",
      },
    ],
    decisions: [
      {
        title: "Process lifetime belongs to the backend",
        body: "PTY handles, child processes, resize, termination and restoration all moved into the Rust runtime. The React renderer attaches to and detaches from sessions through typed commands. Closing a panel is a UI event, not a lifecycle event.",
      },
      {
        title: "Isolation through Git worktrees",
        body: "Concurrent agents get their own worktree rather than a convention about who edits what. Two agents cannot conflict in the same tree because they are not in the same tree.",
      },
      {
        title: "Runtime state is typed, not scraped",
        body: "Agent runs move through explicit states — queued, starting, working, needs input, needs permission, idle, finished, failed, cancelled. Transitions are testable, and the interface renders the state rather than interpreting output.",
      },
      {
        title: "Knowledge as a graph, kept apart from Git",
        body: "Claims, evidence, relations, sources and runs are persisted with provenance. The Git DAG records what code history exists; the knowledge graph records what the system believes and why. They are linked, not merged.",
      },
      {
        title: "Security enforced at the boundary",
        body: "Project filesystem access goes through one guard in the Rust runtime covering traversal, absolute paths, drive-prefix and UNC escape, NUL bytes, symlinks and canonicalisation. There is no renderer-side path check to be trusted.",
      },
    ],
    architecture: [
      {
        layer: "Runtime",
        body: "Rust owns terminals, processes, bounded output pipelines, Git operations, agent execution, restoration scheduling and persistence. Every frontend call crosses a typed, validated IPC boundary that returns structured errors.",
      },
      {
        layer: "Persistence",
        body: "Local SQLite carrying projects, workspaces, terminals, agent runs, swarm coordination, the knowledge graph and updater state — currently at schema v36, reached entirely through forward migrations that preserve existing user data.",
      },
      {
        layer: "Interface",
        body: "React and TypeScript, owning presentation and composition only. Multi-window and multi-monitor layouts with explicit workspace ownership, so two windows cannot both claim an exclusive resource.",
      },
      {
        layer: "Delivery",
        body: "A single confirmed Stable workflow validates tagged source, builds signed Windows updater artifacts, activates the manifest atomically, and verifies the published checksums and live endpoint before it reports success.",
      },
    ],
    outcome: [
      {
        label: "Released version",
        value: "0.4.14",
        note: "Shipping on the Stable channel to Windows.",
      },
      {
        label: "Schema version",
        value: "v36",
        note: "Reached through forward migrations with no destructive rewrite of user data.",
      },
      {
        label: "Update integrity",
        value: "Signed + verified",
        note: "Artifacts are signed and checksums confirmed against the live endpoint before a release is reported successful.",
      },
    ],
    lessons: [
      "Lifecycle ownership is the decision that determines whether long-running work is possible at all. Everything else was downstream of moving it out of the component tree.",
      "Isolation that depends on agents cooperating is not isolation. Separate worktrees cost more to set up and removed an entire category of failure.",
      "Typed state is worth the schema churn. Every state we left implicit came back as a bug that could not be reproduced.",
      "A knowledge system that stores transcripts is an archive. Storing claims with their evidence is what makes it answerable.",
    ],
  },
];

export const caseStudyBySlug = (slug: string) => caseStudies.find((c) => c.slug === slug);

/**
 * Client work is not published yet. The work index states this rather than
 * padding itself with internal projects presented as engagements.
 */
export const clientWorkNote = {
  heading: "Client engagements are not published yet.",
  body: "Corelith's commercial work is under agreement and has not been cleared for publication. What is shown here is technology Corelith designed, built and ships itself — which is the same engineering, done without a client's name on it. We are happy to walk through the relevant parts of it directly.",
};
