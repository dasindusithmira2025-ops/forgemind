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
variables on the `stable-release` GitHub environment:

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

The mirror reproduces the canonical paths verbatim:

```
<mirror>/channels/stable/latest.json   ← https://raw.githubusercontent.com/<repo>/main/channels/stable/latest.json
<mirror>/releases/<tag>/<file>         ← https://github.com/<repo>/releases/download/<tag>/<file>   (full mode only)
```

`node scripts/release/update-distribution.mjs stable <tag>` prints the exact URLs, and the release
workflow runs it on every release.

## Push mirrors (SFTP)

A mirror that pulls from GitHub needs nothing from us but a URL. A mirror we upload into is a push
target, and the release pipeline uploads to it over SFTP after the canonical publication succeeds —
never before, so the origin is never left behind the mirror.

| Setting | Kind | Notes |
|---|---|---|
| `PARALITH_MIRROR_SSH_HOST` | variable | hostname or IP |
| `PARALITH_MIRROR_SSH_PORT` | variable | defaults to 22 |
| `PARALITH_MIRROR_SSH_USER` | variable | should own only the served directory |
| `PARALITH_MIRROR_REMOTE_ROOT` | variable | absolute path, e.g. `/srv/paralith` |
| `PARALITH_MIRROR_SSH_KEY` | **secret** | private key; write access to the mirror |
| `PARALITH_MIRROR_SSH_HOST_KEY` | **secret** | pinned `known_hosts` line from `ssh-keyscan -p <port> <host>` |

Push publication is only as safe as its ordering, so the generated `sftp` batch guarantees it:

1. installers and signatures upload first, under `releases/<tag>/`
2. the manifest uploads to `.latest.json.incoming`
3. it is **renamed** into `latest.json`, which is atomic on the server

A client polling mid-upload therefore sees either the old release or the new one, never a partial
manifest and never a manifest naming files that have not arrived. `sftp -b` aborts on the first
failed command, so a broken upload stops before the rename that would activate it.

The host key is pinned rather than accepted on first use. This step decides what every installed
client downloads; trusting whatever answers the address is not good enough for that.

## What the hosting partner needs

1. **TLS. This is not optional** — see below.
2. `channels/**/latest.json` served as `application/json` with
   `Cache-Control: no-cache, no-store, must-revalidate`. **A cached manifest is a stuck update.**
3. Installer files served as ordinary static binaries — direct bytes, no HTML interstitial, no
   redirect to a download page. Range requests should work; `HEAD` is preferred but a ranged `GET`
   fallback is accepted by verification.
4. For a push mirror: an SSH account restricted to the served directory, and its host key.

They never receive a signing key. The updater verifies every payload against the public key compiled
into the app, so a mirror serving wrong bytes produces a failed signature check, not a bad install.

### Why plain HTTP is refused

`render-tauri-config.mjs` rejects a non-HTTPS endpoint for a release build, and mirror configuration
rejects one too. That is deliberate and must not be relaxed.

Signature verification alone does not make HTTP safe. It proves a payload was signed by us; it does
not prove it is the *current* one. Anyone on the network path — an ISP, a public wifi access point,
a compromised router — can answer with a genuinely signed **older** manifest and installer, and the
updater will accept and install it, because every signature checks out. That is a working downgrade
attack against a version whose bugs are already published in the release notes. HTTP also lets any
observer see exactly which build each user is running.

Because the endpoint is compiled into the binary, shipping `http://` is permanent for every install
that receives it. It cannot be corrected by a later release.

TLS is free. Caddy provisions and renews Let's Encrypt certificates automatically, and produces the
correct cache headers in the same file:

```caddyfile
updates.example.com {
    root * /srv/paralith
    file_server

    @manifest path /channels/*/latest.json
    header @manifest Cache-Control "no-cache, no-store, must-revalidate"
    header @manifest Content-Type "application/json; charset=utf-8"

    @installers path /releases/*
    header @installers Cache-Control "public, max-age=31536000, immutable"
}
```

Requirements: a DNS name pointing at the host, and ports 80 and 443 reachable. If the container
cannot terminate TLS itself, putting Cloudflare's free tier in front of it also works.

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
