# Update distribution

How an installed PARALITH finds and downloads a Stable update, and how to put a third-party host in
front of that without ever handing out a signing key.

## The two URLs that matter

Every installed build polls one manifest URL, compiled into the binary at release time, and
downloads the installer from a URL that was signed into that manifest.

| | Where it comes from | Can it change for an existing install? |
|---|---|---|
| Update endpoint (`latest.json`) | `PARALITH_BUILD_UPDATE_ENDPOINT`, baked in by `build.rs` | **No.** Only new builds get a new endpoint. |
| Installer URL | `platforms[*].url` inside the signed manifest | Only for releases published after the change. |

That asymmetry drives everything below: an endpoint you ship is an endpoint you must keep alive
essentially forever, so it is changed deliberately and never as a side effect.

## Canonical origin

The public repository `dasindusithmira2025-ops/paralith-updates` is the source of truth and always
receives every release first:

- `channels/stable/latest.json` — the Stable manifest, served over `raw.githubusercontent.com`
- Release assets under tag `stable-vX.Y.Z` — the signed `.msi`, `-setup.exe`, and their `.sig` files

It contains no application source, credentials, or diagnostics. It is the only repository that ever
needs to be shared with a hosting partner.

## Adding a mirror

A mirror is an optional layer in front of the canonical origin, declared with two environment
variables on the `stable-release` (or `preview-release`) GitHub environment:

| Variable | Example | Meaning |
|---|---|---|
| `PARALITH_UPDATE_MIRROR_BASE_URL` | `https://updates.example.com` | Mirror root. HTTPS, no credentials, no query string. |
| `PARALITH_UPDATE_MIRROR_MODE` | `manifest` (default) or `full` | How much the mirror serves. |

`PARALITH_STABLE_UPDATE_ENDPOINT` must then be set to exactly the URL the pipeline derives. It is
not free-form: `scripts/release/update-distribution.mjs` recomputes it and fails the release before
the expensive signed build if the two disagree.

### Modes

**`manifest`** — the mirror serves only `channels/<channel>/latest.json`. Installer downloads keep
their GitHub Release URLs. Start here. A mirror outage costs an update *check*, which the app
retries on its next poll; it cannot strand a download half-way or corrupt an install.

**`full`** — the mirror also serves the installers, from `releases/<tag>/<file>`. Move here only
once the mirror has proven itself in `manifest` mode, because these URLs are signed into the
manifest and can never be rewritten afterwards.

### Expected layout

The mirror reproduces the canonical paths verbatim, so a pull-through cache needs no URL rewriting:

```
<mirror>/channels/stable/latest.json   ← https://raw.githubusercontent.com/<repo>/main/channels/stable/latest.json
<mirror>/releases/<tag>/<file>         ← https://github.com/<repo>/releases/download/<tag>/<file>   (full mode only)
```

`node scripts/release/update-distribution.mjs stable <tag>` prints the exact origin URLs to
configure, and the release workflow runs it on every release.

## What the hosting partner needs

Only this, and nothing from the application repository:

1. Origin-pull (reverse proxy / CDN pull zone) from the two origins printed above.
2. `channels/**/latest.json` served as `application/json` with
   `Cache-Control: no-cache, no-store, must-revalidate`. **A cached manifest is a stuck update.**
3. Installer files served as ordinary static binaries — direct bytes, no HTML interstitial, no
   redirect to a download page. Range requests should work; `HEAD` is preferred but a ranged `GET`
   fallback is accepted by verification.
4. A valid TLS certificate. Plain HTTP is rejected at configuration time.

They never receive a signing key, a token, or write access to anything. The updater verifies every
payload against the public key compiled into the app, so a mirror that serves the wrong bytes
produces a failed signature check, not a bad install.

## Fail-closed verification

Two independent checks run on every release and fail it if either does not hold:

- `github-artifacts-publisher.mjs` verifies the **canonical** manifest anonymously through
  `raw.githubusercontent.com`, including downloading the advertised artifact.
- `verify-published-manifest.mjs` then verifies the **live endpoint installed apps will actually
  poll** — the mirror URL when one is configured — retrying while a cold mirror warms up.

A release is never reported as published until both pass.

## Rollback

Clear `PARALITH_UPDATE_MIRROR_BASE_URL` and reset `PARALITH_STABLE_UPDATE_ENDPOINT` to the canonical
URL. Builds released after that point return to GitHub. Builds already shipped with a mirror
endpoint keep polling the mirror, which is why the mirror hostname must outlive the decision to use
it — treat it as a permanent commitment, not a vendor you can swap.
