/**
 * The six commercial capabilities.
 *
 * Every claim here describes work Corelith actually does or has done in
 * building its own products. Nothing describes a client engagement, because
 * none are public yet. The `core` key names the state the Corelith Core object
 * takes when the capability is selected — the object is the connective element
 * between these six, not a decoration beside them.
 */

export type CoreState = "lattice" | "assembly" | "paths" | "shell" | "frame" | "survey";

export type Capability = {
  slug: string;
  index: string;
  name: string;
  /** One line, used in lists and the homepage capability system. */
  brief: string;
  /** The page's opening argument. Two sentences at most. */
  proposition: string;
  core: CoreState;
  /** Concrete deliverables. Things a client receives, not adjectives. */
  builds: string[];
  /** Grouped technical surface. Heading -> items. */
  stack: { heading: string; items: string[] }[];
  /** Where this shows up commercially. */
  application: { heading: string; body: string }[];
  /** How the work is actually run, in order. */
  process: { step: string; body: string }[];
  /** The engineering position that distinguishes this capability. */
  position: { claim: string; body: string };
};

export const capabilities: Capability[] = [
  {
    slug: "product-engineering",
    index: "01",
    name: "Product Engineering",
    brief: "From an unproven idea to software in production, owned end to end.",
    proposition:
      "Most software fails somewhere between the decision and the deployment, not in the code itself. We take the whole distance: what to build, how it should be structured, and the version that ships and keeps running.",
    core: "assembly",
    builds: [
      "Greenfield products taken from concept to a released, supported build",
      "Rescue and re-architecture of systems that have outgrown their original shape",
      "Native desktop applications where the browser is the wrong container",
      "Multi-surface products sharing one authoritative backend",
      "Release, update and rollback pipelines the product ships through",
      "The technical documentation an internal team needs to take it over",
    ],
    stack: [
      {
        heading: "Application",
        items: ["TypeScript", "React", "Next.js", "Tauri", "Rust", "Python"],
      },
      {
        heading: "Persistence",
        items: ["SQLite", "PostgreSQL", "Schema migrations", "Event and audit models"],
      },
      {
        heading: "Delivery",
        items: ["GitHub Actions", "Signed builds", "Update manifests", "Staged rollout"],
      },
    ],
    application: [
      {
        heading: "A product that does not exist yet",
        body: "You have a thesis and a deadline. We do the architecture, build the thing, and hand back something you can operate — not a prototype that needs a second project to become real.",
      },
      {
        heading: "A product that has stopped moving",
        body: "Delivery has slowed and nobody can say precisely why. We read the system, find the structural cause rather than the symptom, and do the smallest re-architecture that restores pace.",
      },
      {
        heading: "A team that needs depth for one stretch",
        body: "Engagements sized to a specific piece of the roadmap, run against your conventions, with the handover written before the last commit.",
      },
    ],
    process: [
      {
        step: "Read the system",
        body: "Existing code, data, deployment and constraints, before any proposal. Assumptions get written down as assumptions.",
      },
      {
        step: "Fix the architecture",
        body: "Boundaries, ownership of state, and the failure modes we are choosing to accept. This is the document the build is judged against.",
      },
      {
        step: "Build in slices",
        body: "Each slice runs end to end and is demonstrable. Nothing waits on a big-bang integration at the end.",
      },
      {
        step: "Verify, then release",
        body: "Tests, typechecks and a real production build gate the release. A failing gate stops the release rather than being annotated.",
      },
    ],
    position: {
      claim: "Architecture before complexity.",
      body: "The expensive part of a product is rarely the first version. It is the fifth change to a structure that was never designed to take it. We spend the time up front on where state lives and who owns it, because that is the decision every later decision is priced against.",
    },
  },

  {
    slug: "ai-systems",
    index: "02",
    name: "AI Systems",
    brief: "Agents, retrieval and inference built as systems, with evaluation attached.",
    proposition:
      "A model call is not a system. The engineering is in what surrounds it: the state it reads, the tools it is allowed to use, the limits on what it can do unattended, and the evidence that it worked.",
    core: "paths",
    builds: [
      "Agentic workflows with typed state, bounded retries and real stop conditions",
      "Retrieval systems built on your own corpus, with provenance on every answer",
      "Local and self-hosted inference where data cannot leave the building",
      "Tool and function interfaces that expose your systems to a model safely",
      "Evaluation harnesses that score output against something checkable",
      "Human review points placed where a wrong answer would actually cost something",
    ],
    stack: [
      {
        heading: "Intelligence",
        items: ["Claude", "OpenAI", "Local model runtimes", "Embeddings", "Reranking", "Vision"],
      },
      {
        heading: "Retrieval",
        items: ["Vector and hybrid search", "Chunking strategy", "Provenance graphs", "Caching"],
      },
      {
        heading: "Control",
        items: ["Typed state machines", "Tool schemas", "Budget limits", "Evaluation suites"],
      },
    ],
    application: [
      {
        heading: "Work that is expensive because it is manual",
        body: "Review, triage, extraction, drafting, reconciliation. We automate the volume and route the genuinely ambiguous cases to a person, rather than automating the decision and hoping.",
      },
      {
        heading: "Knowledge nobody can find",
        body: "Retrieval over your own material, answering with citations into the source. If it cannot cite, it says so instead of inventing.",
      },
      {
        heading: "Data that cannot leave",
        body: "Local inference and self-hosted retrieval for regulated or contractually constrained material, designed so the boundary is enforced by architecture rather than policy.",
      },
    ],
    process: [
      {
        step: "Define the check first",
        body: "Before any model work: what does a correct output look like, and how would we know. If that cannot be answered, the problem is not ready for an agent.",
      },
      {
        step: "Bound the loop",
        body: "Generate, evaluate, revise, stop. Explicit budgets and an explicit stop condition. No open-ended self-reflection.",
      },
      {
        step: "Give it tools, not more prompting",
        body: "Where a compiler, a test, a query or an API can establish the answer, the system calls it instead of reasoning at it.",
      },
      {
        step: "Measure and hold the line",
        body: "The evaluation suite runs in CI. A regression in output quality fails the same way a broken test does.",
      },
    ],
    position: {
      claim: "Verification before claims.",
      body: "The hard problem in applied AI is not capability, it is knowing when the output is wrong. We build the evaluation before we build the agent, because a system that cannot be checked cannot be trusted with anything that matters.",
    },
  },

  {
    slug: "automation",
    index: "03",
    name: "Automation",
    brief: "Operational workflows that survive failure, restarts and the real world.",
    proposition:
      "Automation is easy to demonstrate and hard to depend on. The difference is whether the workflow holds durable state, and whether you can see what it did when it goes wrong at three in the morning.",
    core: "lattice",
    builds: [
      "Long-running workflows with persisted state and safe resumption",
      "Integrations between systems that were never designed to talk",
      "Document and data pipelines with validation at every boundary",
      "Scheduled and event-driven operations with real observability",
      "Approval gates for anything irreversible",
      "Operational dashboards that read live state rather than a cached summary",
    ],
    stack: [
      {
        heading: "Orchestration",
        items: ["Durable state machines", "Queues", "Event streams", "Idempotency keys"],
      },
      {
        heading: "Integration",
        items: ["REST and GraphQL", "Webhooks", "File and mail ingestion", "Legacy adapters"],
      },
      {
        heading: "Operations",
        items: ["Structured logging", "Tracing", "Alerting", "Replay and backfill"],
      },
    ],
    application: [
      {
        heading: "A process held together by people",
        body: "The steps are known, the exceptions are not. We automate the known path and make the exceptions visible instead of silently dropping them.",
      },
      {
        heading: "Systems that do not speak to each other",
        body: "Integration with explicit contracts and validation at the boundary, so a change on one side surfaces as an error rather than as corrupted data downstream.",
      },
      {
        heading: "Work that has to happen overnight",
        body: "Scheduled operations built to be restartable. A failure at step nine resumes at step nine, not step one.",
      },
    ],
    process: [
      {
        step: "Map the real process",
        body: "Including the exceptions people handle informally. Those are usually where the value and the risk both are.",
      },
      {
        step: "Make state durable",
        body: "Every step persists what it did. The workflow survives a restart because the state does not live in a process.",
      },
      {
        step: "Gate the irreversible",
        body: "Anything that deletes, sends, pays or publishes stops for approval unless it has been explicitly authorised to proceed.",
      },
      {
        step: "Instrument before scaling",
        body: "The workflow is observable before it is trusted with volume. You should be able to answer what happened without reading logs by hand.",
      },
    ],
    position: {
      claim: "Automation without opacity.",
      body: "An automated process you cannot inspect is a liability wearing an efficiency costume. Everything we automate records what it did, what changed, and what it refused to do — so the answer to what happened last night is a query, not an investigation.",
    },
  },

  {
    slug: "experience-engineering",
    index: "04",
    name: "Experience Engineering",
    brief: "Interfaces for people who will use them for eight hours, not eight seconds.",
    proposition:
      "Interface work is usually judged on the first impression and paid for on the thousandth. We build for the second one: density that stays readable, state that stays honest, and performance that holds under real data.",
    core: "shell",
    builds: [
      "Data-dense application interfaces that stay legible at scale",
      "Native desktop applications with multi-window and multi-monitor behaviour",
      "Design systems expressed as tokens, not as a component folder",
      "Real-time interfaces backed by streams rather than polling",
      "Accessibility to WCAG 2.2 AA as a build requirement, not an audit finding",
      "Marketing and product sites engineered to the same standard as the product",
    ],
    stack: [
      {
        heading: "Interface",
        items: ["React", "TypeScript", "Next.js", "Tauri", "WebGL", "Web Components"],
      },
      {
        heading: "System",
        items: ["Design tokens", "Theming", "Virtualisation", "Motion systems"],
      },
      {
        heading: "Quality",
        items: ["Keyboard paths", "Screen readers", "Contrast budgets", "Visual regression"],
      },
    ],
    application: [
      {
        heading: "An internal tool nobody wants to use",
        body: "Usually not a visual problem. We find the workflow the interface is fighting, restructure around it, and keep the parts that already work.",
      },
      {
        heading: "A product that has outgrown its UI",
        body: "Density, hierarchy and state handling rebuilt on a token system, so the next twenty screens are consistent by construction rather than by review.",
      },
      {
        heading: "Software that has to feel native",
        body: "Desktop applications where window management, offline behaviour and local performance are product features, not compromises.",
      },
    ],
    process: [
      {
        step: "Watch the work",
        body: "What the interface is actually used for, at what frequency, under what pressure. Rare tasks and constant tasks get different treatment.",
      },
      {
        step: "Build the token system",
        body: "Colour, type, spacing, motion and state as one documented system. Consistency comes from the system or it does not come at all.",
      },
      {
        step: "Compose, then critique",
        body: "Screens are rendered and reviewed against the real data, in both themes, at the sizes people actually use — not approved from a mockup.",
      },
      {
        step: "Hold the floor",
        body: "Keyboard access, focus, contrast and reduced motion are part of done. They are checked on the built page, not asserted.",
      },
    ],
    position: {
      claim: "Real state over visual fiction.",
      body: "An interface that shows optimistic progress, invented percentages or a success toast the backend never confirmed is lying to the person depending on it. If the system does not know something, the interface says so.",
    },
  },

  {
    slug: "infrastructure",
    index: "05",
    name: "Infrastructure",
    brief: "The backends, data models and pipelines everything above depends on.",
    proposition:
      "Infrastructure is where the cost of a bad early decision compounds fastest. We design the data model and the delivery path first, because they are the two things that are genuinely expensive to change later.",
    core: "frame",
    builds: [
      "Service and API architecture with typed, validated boundaries",
      "Relational data models designed for the queries that will actually run",
      "Migration strategies that move production data without a maintenance window",
      "CI pipelines that gate on real validation rather than a green checkmark",
      "Signed release and update channels with separated internal and stable paths",
      "Observability: structured logs, traces and the queries that make them useful",
    ],
    stack: [
      {
        heading: "Services",
        items: ["Rust", "TypeScript", "Python", "REST", "gRPC", "Background workers"],
      },
      {
        heading: "Data",
        items: ["PostgreSQL", "SQLite", "Migrations", "Indexing strategy", "Backups"],
      },
      {
        heading: "Delivery",
        items: ["GitHub Actions", "Containers", "Artifact signing", "Staged rollout", "Rollback"],
      },
    ],
    application: [
      {
        heading: "A schema that has become the bottleneck",
        body: "Forward migrations that preserve production data, with the query patterns and indexes designed against real usage rather than assumed usage.",
      },
      {
        heading: "A release process nobody trusts",
        body: "Pipelines where the gates are real: a failing test blocks the release, artifacts are signed, and internal builds cannot overwrite what customers receive.",
      },
      {
        heading: "A system that cannot be debugged",
        body: "Structured logging and tracing added deliberately, so an incident is answered from evidence instead of from a reconstruction.",
      },
    ],
    process: [
      {
        step: "Model the data",
        body: "Entities, relationships and the queries that will run against them. Ambiguous blobs get resolved into typed structure while it is still cheap.",
      },
      {
        step: "Define the boundaries",
        body: "Every service and IPC boundary is treated as an API: typed inputs, validated at the boundary, structured errors, stable semantics.",
      },
      {
        step: "Make delivery boring",
        body: "One pipeline, real gates, signed artifacts, monotonic versions, and a rollback that has been exercised rather than documented.",
      },
      {
        step: "Prove the migration",
        body: "Schema changes are run forward against a copy of production before they are run against production.",
      },
    ],
    position: {
      claim: "Systems built to evolve.",
      body: "Nothing we build assumes the requirements are final. The test of an architecture is not whether it is elegant today but whether the fourth unexpected requirement can be absorbed without a rewrite — which is a question about boundaries, not about frameworks.",
    },
  },

  {
    slug: "technology-strategy",
    index: "06",
    name: "Technology Strategy",
    brief: "Architecture, feasibility and direction, before the budget is committed.",
    proposition:
      "Some of the most valuable engineering work produces no code. Deciding what is buildable, what it will cost to own, and what should not be built at all is worth doing before a team is hired around the answer.",
    core: "survey",
    builds: [
      "Architecture reviews of existing systems, with the findings ranked by cost",
      "Feasibility studies on whether a proposed system can be built as specified",
      "Build, buy or integrate assessments grounded in total cost of ownership",
      "Technical due diligence on software you are acquiring or depending on",
      "AI adoption assessments that distinguish the tractable from the fashionable",
      "Roadmaps sequenced by dependency and risk rather than by wish",
    ],
    stack: [
      {
        heading: "Assessment",
        items: ["Code and data audit", "Dependency analysis", "Failure-mode review", "Cost modelling"],
      },
      {
        heading: "Design",
        items: ["Target architecture", "Migration sequencing", "Interface contracts", "Risk register"],
      },
      {
        heading: "Output",
        items: ["Written findings", "Ranked recommendations", "Reference implementation"],
      },
    ],
    application: [
      {
        heading: "A decision with a long shadow",
        body: "Platform, architecture or vendor choices that will be expensive to reverse. We model what each one costs to live with, not only to adopt.",
      },
      {
        heading: "An estimate nobody believes",
        body: "Independent feasibility assessment on a proposed system, including the parts of the specification that cannot be built as written.",
      },
      {
        heading: "AI, without the theatre",
        body: "An honest read on which parts of your operation an AI system can carry today, which need a person in the loop, and which are not worth automating at all.",
      },
    ],
    process: [
      {
        step: "Establish the ground truth",
        body: "The system as it is, from the code and the data — not from the architecture diagram, which is usually out of date.",
      },
      {
        step: "Find the real constraint",
        body: "Most stalled systems have one structural cause and several symptoms. The recommendation addresses the cause.",
      },
      {
        step: "Price the options",
        body: "Each path costed for build and for ownership, with the risks stated plainly, including the risks of the option we recommend.",
      },
      {
        step: "Prove it where it matters",
        body: "Where a recommendation carries real uncertainty, we build the smallest thing that settles the question before you commit to it.",
      },
    ],
    position: {
      claim: "The recommendation includes what we are not sure about.",
      body: "A strategy document that reads as uniformly confident is not a strategy document, it is a sales document. Ours separates what we established, what we inferred, and what remains genuinely open — because that is the part you need in order to decide.",
    },
  },
];

export const capabilityBySlug = (slug: string) => capabilities.find((c) => c.slug === slug);

/**
 * The four domains the homepage capability field is composed from.
 *
 * Named rather than sliced: these are the four with the most distinct
 * structure, and the composition places them by position rather than in a list,
 * so the order and the membership are a design decision rather than whatever
 * happens to be first in the file.
 */
export const primaryCapabilities = [
  "product-engineering",
  "ai-systems",
  "experience-engineering",
  "infrastructure",
].map((slug) => {
  const capability = capabilityBySlug(slug);
  if (!capability) throw new Error(`Unknown capability: ${slug}`);
  return capability;
});
