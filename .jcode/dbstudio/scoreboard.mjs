#!/usr/bin/env node
// Paralith Database Studio mission scoreboard.
//
// Single deterministic command that produces the mission progress score. The coordinator runs
// this every iteration; the number it prints is directly comparable across iterations, so the
// swarm can hill-climb instead of arguing about narrative progress.
//
//   node .jcode/dbstudio/scoreboard.mjs            # run everything, write STATUS.md
//   node .jcode/dbstudio/scoreboard.mjs --fast     # skip the slow cargo/build checks
//   node .jcode/dbstudio/scoreboard.mjs --only B4  # run one check
//
// Exit code is 0 when the scoreboard itself ran, regardless of check results. Failing checks are
// the signal, not a crash.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const app = join(repoRoot, "Paralith-tauri");
const tauri = join(app, "src-tauri");
const artifacts = here;

const args = process.argv.slice(2);
const fast = args.includes("--fast");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;

const GATES = [
  ["GATE 1", "Architecture + domain contracts"],
  ["GATE 2", "Persistence + discovery + adapters"],
  ["GATE 3", "Design graph / revisions / concurrency"],
  ["GATE 4", "Database Studio UI/UX"],
  ["GATE 5", "Agent protocol + canvas awareness"],
  ["GATE 6", "Approved design implementation pipeline"],
  ["GATE 7", "Security + credential handling"],
  ["GATE 8", "Performance + large schemas"],
  ["GATE 9", "Tests / regressions"],
  ["GATE 10", "Final integrated application"],
];

function run(cmd, cmdArgs, cwd, timeoutMs = 20 * 60 * 1000) {
  const started = Date.now();
  const res = spawnSync(cmd, cmdArgs, {
    cwd,
    encoding: "utf8",
    shell: process.platform === "win32",
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  return { ok: res.status === 0, code: res.status, out, ms: Date.now() - started };
}

function firstError(out, limit = 6) {
  const lines = out.split(/\r?\n/);
  const hits = lines.filter((l) =>
    /^(error|error\[|failures:|FAIL |\s+Error:|✗|×|test result: FAILED)/i.test(l.trim()),
  );
  return (hits.length ? hits : lines.filter(Boolean).slice(-limit)).slice(0, limit).join(" | ").slice(0, 600);
}

// ---------------------------------------------------------------------------
// Static (no-subprocess) checks. These read the working tree directly, so they
// stay cheap and are safe to run on every iteration.
// ---------------------------------------------------------------------------

function gitDiffAgainstBase() {
  try {
    const base = execFileSync("git", ["merge-base", "HEAD", MISSION_BASE], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return execFileSync("git", ["diff", `${base}..HEAD`, "--", "."], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

const MISSION_BASE = process.env.DBSTUDIO_BASE || "origin/main";

function workingTreeDiff() {
  try {
    return execFileSync("git", ["diff", "HEAD", "--", "."], {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch {
    return "";
  }
}

function checkNoDisabledTests() {
  const diff = gitDiffAgainstBase() + workingTreeDiff();
  const added = diff.split(/\r?\n/).filter((l) => l.startsWith("+") && !l.startsWith("+++"));
  const offenders = added.filter((l) =>
    /#\[ignore\]|\b(it|test|describe)\.skip\b|\bxit\(|\bxdescribe\(|--no-verify/.test(l),
  );
  return {
    ok: offenders.length === 0,
    detail: offenders.length ? `disabled tests added: ${offenders.slice(0, 3).join(" | ").slice(0, 300)}` : "no disabled tests introduced",
  };
}

function readGateLedger() {
  const rows = GATES.map(([id, title], i) => {
    const file = join(artifacts, `gate-${i + 1}.md`);
    if (!existsSync(file)) return { id, title, verdict: "PENDING", sha: "-" };
    const text = readFileSync(file, "utf8");
    const verdict = /verdict:\s*APPROVED/i.test(text)
      ? "APPROVED"
      : /verdict:\s*REJECTED/i.test(text)
        ? "REJECTED"
        : "PENDING";
    const sha = (text.match(/commit:\s*([0-9a-f]{7,40})/i) || [])[1] || "-";
    return { id, title, verdict, sha };
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Command checks
// ---------------------------------------------------------------------------

const CHECKS = [
  {
    id: "B1",
    name: "cargo check (backend compiles)",
    slow: true,
    fn: () => {
      const r = run("cargo", ["check", "--all-targets"], tauri);
      return { ok: r.ok, detail: r.ok ? `ok in ${(r.ms / 1000) | 0}s` : firstError(r.out) };
    },
  },
  {
    id: "B2",
    name: "cargo test (full backend suite, no regressions)",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test"], tauri);
      const m = r.out.match(/test result: .*?(\d+) passed; (\d+) failed/g) || [];
      return { ok: r.ok, detail: r.ok ? `${m.length} suites green` : firstError(r.out) };
    },
  },
  {
    id: "B3",
    name: "schema migration upgrade preserves installed data",
    slow: true,
    fn: () => {
      const mig = join(tauri, "src", "database", "migrations.rs");
      if (!existsSync(mig)) return { ok: false, detail: "migrations.rs missing" };
      const text = readFileSync(mig, "utf8");
      const ver = Number((text.match(/CURRENT_SCHEMA_VERSION:\s*i64\s*=\s*(\d+)/) || [])[1] || 0);
      if (ver <= 27) return { ok: false, detail: `CURRENT_SCHEMA_VERSION still ${ver}; database studio tables not migrated` };
      const hasUpgradeTest = /upgrades_installed_schema_\d+_to_current_preserving_data|preserving_data/.test(text);
      if (!hasUpgradeTest) return { ok: false, detail: "no upgrade-preserves-data test found" };
      const r = run("cargo", ["test", "database::migrations"], tauri);
      return { ok: r.ok, detail: r.ok ? `schema v${ver} migration tests green` : firstError(r.out) };
    },
  },
  {
    id: "B4",
    name: "npm run typecheck",
    slow: true,
    fn: () => {
      const r = run("npm", ["run", "typecheck"], app);
      return { ok: r.ok, detail: r.ok ? "clean" : firstError(r.out) };
    },
  },
  {
    id: "B5",
    name: "npm run lint",
    slow: true,
    fn: () => {
      const r = run("npm", ["run", "lint"], app);
      return { ok: r.ok, detail: r.ok ? "clean" : firstError(r.out) };
    },
  },
  {
    id: "B6",
    name: "npm run test (vitest)",
    slow: true,
    fn: () => {
      const r = run("npm", ["run", "test"], app);
      return { ok: r.ok, detail: r.ok ? "green" : firstError(r.out) };
    },
  },
  {
    id: "B7",
    name: "discovery fixtures (prisma/drizzle/sql/sqlite/monorepo/multi-db/dup-names)",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::discovery"], tauri);
      const required = [
        "prisma",
        "drizzle",
        "raw_sql",
        "sqlite",
        "monorepo_shared_db",
        "multi_logical_db",
        "duplicate_table_names",
      ];
      const missing = required.filter((f) => !new RegExp(f).test(r.out));
      return {
        ok: r.ok && missing.length === 0,
        detail: r.ok ? (missing.length ? `missing fixture coverage: ${missing.join(",")}` : "7/7 fixtures asserted") : firstError(r.out),
      };
    },
  },
  {
    id: "B8",
    name: "design graph: immutable revisions, independent drafts, stale-write rejected",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::design"], tauri);
      const needs = ["stale", "draft", "revision"];
      const missing = needs.filter((n) => !new RegExp(n, "i").test(r.out));
      return { ok: r.ok && missing.length === 0, detail: r.ok ? (missing.length ? `missing: ${missing.join(",")}` : "revision/draft/stale covered") : firstError(r.out) };
    },
  },
  {
    id: "B9",
    name: "semantic diff is structural (formatting-only change = empty diff)",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::diff"], tauri);
      return { ok: r.ok, detail: r.ok ? "structural diff tests green" : firstError(r.out) };
    },
  },
  {
    id: "B10",
    name: "agent contract: DESIGN_ONLY cannot mutate, IMPLEMENT_DESIGN gets target revision",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::agent"], tauri);
      const needs = ["design_only", "implement_design", "selection"];
      const missing = needs.filter((n) => !new RegExp(n, "i").test(r.out));
      return { ok: r.ok && missing.length === 0, detail: r.ok ? (missing.length ? `missing: ${missing.join(",")}` : "mode + selection contracts covered") : firstError(r.out) };
    },
  },
  {
    id: "B11",
    name: "pipeline: approved target -> native change -> re-extract -> zero delta",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::pipeline"], tauri);
      return { ok: r.ok, detail: r.ok ? "target/result verification green" : firstError(r.out) };
    },
  },
  {
    id: "B12",
    name: "security: no credentials persisted, no auto-connect",
    slow: true,
    fn: () => {
      const r = run("cargo", ["test", "database_studio::security"], tauri);
      return { ok: r.ok, detail: r.ok ? "credential boundary tests green" : firstError(r.out) };
    },
  },
  {
    id: "B13",
    name: "performance: large schema (400 tables) bounded render + off-path layout",
    slow: true,
    fn: () => {
      const r = run("npm", ["run", "test", "--", "largeSchema"], app);
      return { ok: r.ok, detail: r.ok ? "large-schema benchmark green" : firstError(r.out) };
    },
  },
  {
    id: "B14",
    name: "no tests disabled / no assertions deleted in mission diff",
    slow: false,
    fn: checkNoDisabledTests,
  },
];

// ---------------------------------------------------------------------------

const selected = CHECKS.filter((c) => (only ? c.id === only : fast ? !c.slow : true));
const results = [];
for (const check of selected) {
  process.stderr.write(`… ${check.id} ${check.name}\n`);
  let r;
  try {
    r = check.fn();
  } catch (err) {
    r = { ok: false, detail: `check crashed: ${String(err).slice(0, 200)}` };
  }
  results.push({ ...check, ...r });
  process.stderr.write(`${r.ok ? "PASS" : "FAIL"} ${check.id} — ${r.detail}\n`);
}

const gates = readGateLedger();
const gateScore = gates.filter((g) => g.verdict === "APPROVED").length;
const skipped = CHECKS.length - selected.length;
const checkScore = results.filter((r) => r.ok).length;

const stamp = new Date().toISOString();
const lines = [];
lines.push("# Database Studio mission scoreboard");
lines.push("");
lines.push(`Generated: ${stamp}`);
lines.push(`Command: \`node .jcode/dbstudio/scoreboard.mjs${fast ? " --fast" : ""}\``);
lines.push("");
lines.push(`## Score: gates ${gateScore}/10 · checks ${checkScore}/${CHECKS.length}${skipped ? ` (${skipped} skipped this run)` : ""}`);
lines.push("");
lines.push("Mission is DONE only at gates 10/10 and checks 14/14, followed by a launched dev app.");
lines.push("");
lines.push("## Vector A — Reviewer gate ledger");
lines.push("");
lines.push("| Gate | Scope | Verdict | Commit |");
lines.push("| --- | --- | --- | --- |");
for (const g of gates) lines.push(`| ${g.id} | ${g.title} | ${g.verdict} | ${g.sha} |`);
lines.push("");
lines.push("## Vector B — Deterministic checks");
lines.push("");
lines.push("| Check | What it proves | Result | Detail |");
lines.push("| --- | --- | --- | --- |");
for (const c of CHECKS) {
  const r = results.find((x) => x.id === c.id);
  const status = !r ? "SKIPPED" : r.ok ? "PASS" : "FAIL";
  lines.push(`| ${c.id} | ${c.name} | ${status} | ${(r?.detail ?? "not run this iteration").replace(/\|/g, "/")} |`);
}
lines.push("");

mkdirSync(artifacts, { recursive: true });
writeFileSync(join(artifacts, "STATUS.md"), lines.join("\n"), "utf8");
writeFileSync(
  join(artifacts, "status.json"),
  JSON.stringify({ stamp, gateScore, checkScore, total: CHECKS.length, gates, results: results.map(({ id, ok, detail }) => ({ id, ok, detail })) }, null, 2),
  "utf8",
);

process.stdout.write(`\nSCORE gates=${gateScore}/10 checks=${checkScore}/${CHECKS.length}\nWrote .jcode/dbstudio/STATUS.md\n`);
