# Corelith monorepo

This repository contains independent Corelith products. Each package owns its dependencies,
build output, tests, and release tooling; the repository root contains only shared governance and
automation.

| Path | Package | Purpose |
| --- | --- | --- |
| [`Paralith-tauri/`](Paralith-tauri/README.md) | `paralith` | PARALITH desktop application (Tauri 2, Rust, React, TypeScript, and SQLite). |
| [`corelith-web/`](corelith-web/README.md) | `corelith_web` | Corelith Technologies website (Next.js and Tailwind CSS). |

The packages intentionally do not share an npm workspace or lockfile. Install and run commands
from the package being changed:

```powershell
Set-Location Paralith-tauri
npm ci
npm run tauri dev
```

```powershell
Set-Location corelith-web
npm ci
npm run dev
```

Repository-wide agent policy is defined in [`AGENTS.md`](AGENTS.md). GitHub workflows remain at
the root because they coordinate package-scoped validation and releases.
