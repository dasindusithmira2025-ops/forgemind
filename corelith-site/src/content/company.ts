/**
 * Company, research, careers and the build lifecycle.
 *
 * The timeline carries only events that can be checked against Corelith's own
 * release record. There are no funding rounds, awards, headcounts, office
 * locations or customer counts here, because none of those are established.
 */

export const philosophy = {
  kicker: "Corelith / Technology",
  heading: "Technology should expand what is possible.",
  body: [
    "Corelith Technologies is an engineering company with two halves that feed each other. We are hired to design and build software, AI systems, automation and infrastructure for other organisations. We also develop technology of our own, and ship it.",
    "The second half is not a side project. Building and operating our own products is how we learn what actually survives contact with production — and it is why the engineering we bring to a client engagement has already been tested somewhere we could not blame anyone else.",
  ],
};

export const principles = [
  {
    index: "01",
    claim: "Architecture before complexity.",
    body: "The expensive decision is where state lives and who owns it. We settle that before writing the feature, because every later decision is priced against it.",
  },
  {
    index: "02",
    claim: "Verification before claims.",
    body: "A change is finished when evidence shows it works — a passing gate, a real build, an inspectable result. Not when the code exists.",
  },
  {
    index: "03",
    claim: "Real state over visual fiction.",
    body: "No invented progress, no optimistic success, no placeholder data in production. Where the system does not know something, it says so.",
  },
  {
    index: "04",
    claim: "Automation without opacity.",
    body: "Anything automated records what it did and what it refused to do. Efficiency that cannot be inspected is a liability.",
  },
  {
    index: "05",
    claim: "Performance by design.",
    body: "Speed is a structural property, not a tuning pass. It is measured and defended per release rather than optimised once.",
  },
  {
    index: "06",
    claim: "Systems built to evolve.",
    body: "The test of an architecture is whether the fourth unexpected requirement can be absorbed without a rewrite.",
  },
];

/** The delivery lifecycle. One evolving object, six named states. */
export const lifecycle = [
  {
    step: "Discover",
    body: "The system as it is, from the code and the data. Constraints, obligations and the failure modes already present.",
    state: "field",
  },
  {
    step: "Architect",
    body: "Boundaries, state ownership and interface contracts. The document the build is judged against.",
    state: "order",
  },
  {
    step: "Design",
    body: "The token system, the interaction model, and the screens that carry the real work — reviewed against real data.",
    state: "surface",
  },
  {
    step: "Engineer",
    body: "Built in slices that each run end to end. Tests written where behaviour matters, not where coverage is easy.",
    state: "assembly",
  },
  {
    step: "Verify",
    body: "Lint, types, tests and a production build. A failing gate stops the release rather than being annotated.",
    state: "scan",
  },
  {
    step: "Ship",
    body: "Signed artifacts, monotonic versions, separated channels and a rollback path that has been exercised.",
    state: "release",
  },
] as const;

export const technology = [
  {
    heading: "Intelligence",
    items: ["Models", "Agents", "Retrieval", "Local inference", "Vision", "Evaluation"],
  },
  {
    heading: "Applications",
    items: ["Web", "Desktop", "Real-time", "WebGL", "Design systems"],
  },
  {
    heading: "Systems",
    items: ["Rust", "TypeScript", "Python", "Services", "Process runtimes"],
  },
  {
    heading: "Infrastructure",
    items: ["SQLite", "PostgreSQL", "Containers", "CI/CD", "Signed delivery"],
  },
];

/**
 * Corelith's actual history, restricted to events with a record behind them.
 * Additional milestones belong here once an owner can point at evidence.
 */
export const timeline = [
  {
    period: "2026",
    title: "Paralith enters development",
    body: "Work begins on a native multi-agent development environment for Corelith's own engineering: durable terminal sessions, isolated worktrees, and typed agent runtime state.",
  },
  {
    period: "2026",
    title: "Signed Stable release channel",
    body: "A confirmed release workflow ships signed Windows updater artifacts and verifies published checksums against the live endpoint before reporting success. Internal and Stable channels are kept structurally separate.",
  },
  {
    period: "2026",
    title: "Context Fabric",
    body: "Project knowledge moves from transcript history to a typed graph of claims, evidence, relations and sources, with provenance linking each one back to the run that produced it.",
  },
  {
    period: "2026",
    title: "Paralith 0.4.14",
    body: "The current Stable release, carrying the memory workspace, the generated project-intelligence vault, and a local database at schema v36 reached entirely through forward migrations.",
  },
];

export const research = [
  {
    slug: "agentic-software-engineering",
    index: "01",
    title: "Agentic software engineering",
    question: "What has to be true for a coding agent's output to be trusted without reading every line?",
    body: "We build with agents daily, which means we run directly into the limits. The work here is on bounded improvement loops with real stop conditions, on giving agents deterministic tools instead of asking them to reason harder, and on the evidence a run has to produce before its result can be accepted.",
    grounding: "Grounded in Paralith's agent runtime, which is in production use.",
  },
  {
    slug: "persistent-project-intelligence",
    index: "02",
    title: "Persistent project intelligence",
    question: "How should a system remember a codebase across months and hundreds of sessions?",
    body: "Transcript archives do not answer questions. We are working on knowledge represented as typed entities — claims, evidence, relations, sources, revisions — with provenance attached, deduplication, contradiction detection and confidence that decays as the code moves underneath it.",
    grounding: "Shipping as Paralith's Context Fabric and memory workspace.",
  },
  {
    slug: "autonomous-development-systems",
    index: "03",
    title: "Autonomous development systems",
    question: "Where does coordinating several agents beat running one well?",
    body: "Parallelism has a coordination cost that is frequently higher than the benefit. We are mapping where isolated concurrent execution genuinely wins, how roles and dependencies should be typed, and where a human intervention point has to sit for the result to be worth having.",
    grounding: "Grounded in Paralith's swarm execution and worktree isolation.",
  },
  {
    slug: "local-intelligence",
    index: "04",
    title: "Local intelligence",
    question: "How much capability can stay on the machine that owns the data?",
    body: "For regulated and contractually constrained work the interesting question is not which model is strongest but how much can run locally without the result becoming useless. We are interested in the architecture that makes the boundary structural rather than a policy setting.",
    grounding: "Applied in Paralith's local-first persistence and filesystem boundary.",
  },
  {
    slug: "human-ai-collaboration",
    index: "05",
    title: "Human–AI collaboration",
    question: "What does an interface owe someone supervising work they did not do?",
    body: "Supervising an agent is a different activity from writing code, and it is badly served by chat. The work here is on representing runtime state honestly, placing approval where a wrong answer would actually cost something, and making a completed run inspectable rather than summarised.",
    grounding: "Grounded in Paralith's runtime state model and evidence records.",
  },
];

export const careers = {
  heading: "Build things that have not existed before.",
  body: "Corelith is small and deliberately so. That means the person who designs a system is usually the person who builds it, ships it, and answers for it — which is either exactly what you want or exactly what you do not.",
  operating: [
    {
      title: "You own the whole distance",
      body: "Architecture through production and the long tail after it. Not a ticket queue and not a hand-off at the interesting part.",
    },
    {
      title: "Written before spoken",
      body: "Decisions live in written specs and in the code. Few meetings, few status reports, long uninterrupted stretches.",
    },
    {
      title: "AI-native, not AI-credulous",
      body: "We build with agents every day and we are unusually specific about where they help. Enthusiasm and scepticism are both required.",
    },
    {
      title: "Evidence settles arguments",
      body: "Benchmarks, tests, traces and real builds. Seniority does not win a technical disagreement here; a reproduction does.",
    },
  ],
  /** Empty until roles are genuinely open. The page states this plainly. */
  roles: [] as {
    slug: string;
    title: string;
    discipline: string;
    location: string;
    type: string;
    summary: string;
    responsibilities: string[];
    requirements: string[];
  }[],
  openApplication: {
    heading: "No open roles right now.",
    body: "We are not hiring against a defined role at the moment. If you build the kind of systems described across this site, write to us anyway — send something you have built and what you were responsible for in it. We keep those and come back to them when a role opens.",
  },
};

/** Insights has no published articles yet. The route exists; it says so. */
export const insights: {
  slug: string;
  title: string;
  category: string;
  date: string;
  readingTime: string;
  standfirst: string;
}[] = [];
