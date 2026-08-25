# corelith_site

The rebuilt Corelith Technologies website. It runs alongside [`corelith-web`](../corelith-web/README.md),
which is still the deployed site — nothing here has been cut over.

## Commands

```powershell
npm ci
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck
npm run build      # production build; also gates types and route generation
npm start          # serve the production build
```

## Architecture

- **Next.js App Router**, exported as static HTML for the existing Firebase Hosting site.
- **Design tokens** live in `src/app/globals.css`; the primitives built on them are in
  `src/app/system.css`. Components read role tokens (`--ink`, `--ground`, `--hair`) and
  never hardcode a colour, which is what lets one component stay correct on the page
  ground, on a recessed band, and inside an inverted block.
- **Content** is typed data in `src/content/`. It carries only facts that can be checked
  against the shipping product, the release record, or Corelith's own mail domain.
- **The Corelith Core** (`src/components/core/`) is the brand object: a machined block with
  a quarter section removed, exposing an internal lattice. It renders through
  three.js + React Three Fiber, is lazy-loaded as its own chunk, pauses when off screen,
  and falls back to a server-rendered orthographic drawing of the same geometry when
  WebGL is unavailable or motion is reduced.

## Deployment

The existing production website is Firebase Hosting project/site `corelithwebsite`.

```powershell
npm run lint
npm run typecheck
npm run build
firebase.cmd deploy --only hosting --project corelithwebsite
```

Firebase Hosting is static here. The project-intake form validates in the browser and opens a
prefilled email to `contact@corelithtechnologies.com`; it does not claim server-side delivery.
