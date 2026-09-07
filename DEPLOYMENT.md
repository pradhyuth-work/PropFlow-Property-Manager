# Deployment

## The one canonical deployment

- **Vercel project:** `prop-flow-property-manager-api-server` (team `blaze-27f8`)
- **Production URL:** https://property-varasidhi.vercel.app
- **Root Directory (Vercel project setting):** `.` (the repo root) — **not** a subfolder.
- **Framework Preset (Vercel project setting):** `Node`

This is the **only** Vercel project for this repository. There is exactly one deployable unit:
a single Express server (`artifacts/api-server`) that serves the built React/Vite frontend
(`artifacts/propflow`) as static files *and* the `/api/*` routes, all from one process on one
domain. There is no separate frontend-only or backend-only Vercel project, and there should
never be one.

## How the build works

1. Vercel installs with `pnpm install` and runs the build command from the root `vercel.json`:
   `pnpm --filter @workspace/api-server... --if-present run build`
   This builds `@workspace/api-server` plus its workspace dependencies (`lib/db`, `lib/api-zod`)
   — it deliberately does **not** build unrelated workspace packages like
   `artifacts/mockup-sandbox`.
2. `artifacts/api-server`'s own `build` script (`tsc --build ../../lib/db ../../lib/api-zod && node ./build.mjs`)
   does the real work:
   - `build.mjs` first builds `artifacts/propflow` (Vite) with `PORT`/`BASE_PATH=/` forced for
     Vite's build-time env requirements, producing `artifacts/propflow/dist/public`.
   - It then esbuild-bundles the Express server itself to
     `artifacts/api-server/dist/index.mjs` (single file, no TypeScript, no unresolved
     `@workspace/*` imports left — this matters, see below).
   - Finally it copies `artifacts/propflow/dist/public` into
     `artifacts/api-server/dist/public`, so the bundled server can `express.static()` it.
3. The root-level `server.mjs` (`import "./artifacts/api-server/dist/index.mjs";`) is what
   Vercel's `Node` framework preset auto-detects at the project root and turns into a Vercel
   Function. It's deliberately plain JS with no TypeScript and no workspace imports, because
   Vercel's Node runtime does not support TypeScript project references — if this file (or
   anything it imports at the top level) needed compiling, the deploy breaks with an
   "Emit skipped" error.
4. Root `vercel.json`'s `functions.server.mjs.includeFiles` tells Vercel's file tracer to bundle
   `artifacts/api-server/dist/public/**` into the deployed Function — `express.static` reads
   those files dynamically at runtime, so static analysis alone would otherwise miss them and
   they'd 404 in production despite working locally.

Routing is intentionally simple: **all** requests go to the one Express server (there's no
separate `rewrites`/static routing in `vercel.json`), and Express itself decides internally
whether a request is `/api/*`, a real static asset, or falls back to `index.html` for
client-side routing.

## What NOT to do

- **Don't import this repository into Vercel a second time.** If you connect the GitHub repo
  to Vercel again (e.g. via "Add New Project"), it creates a brand-new, independently-configured
  project that will drift from this one. Always deploy through the existing
  `prop-flow-property-manager-api-server` project.
- **Don't add a `vercel.json` inside `artifacts/api-server/` or `artifacts/propflow/`.** Only
  the root-level `vercel.json` should exist. A subfolder `vercel.json` combined with a Root
  Directory that ever gets pointed at that subfolder again is exactly how this repo ended up
  with a broken split deployment before.
- **Don't change the Vercel project's Root Directory away from `.` (repo root)** in the
  dashboard. If it gets set to `artifacts/api-server` or `artifacts/propflow` again, the root
  `vercel.json` / `server.mjs` stop being picked up correctly.
- **Don't let Vercel's Framework Preset silently revert to "Express."** Auto-detection can flag
  `artifacts/api-server/src/app.ts` + `src/index.ts` as an Express app and try to compile the
  TypeScript source directly — which fails because the Node.js runtime doesn't support this
  repo's TypeScript project references. The preset must stay `Node` (it reads `server.mjs` at
  the project root, which already imports a fully bundled, plain-JS server).
- **Don't remove the root-level `server.mjs` or rename it away from the `server.{js,cjs,mjs,ts,cts,mts}`
  convention** — that's the file Vercel's `Node` framework preset looks for.
- **Don't bypass `build.mjs`'s frontend build step.** The frontend is not built as a separate
  Vercel deployment step; it's built *by* the backend's own build script and copied in. If you
  change how/where the frontend builds, update `build.mjs`'s `buildFrontend()` and the
  `includeFiles` glob in `vercel.json` together.
- **`varasidhi-dsr`** is a separate, unrelated Vercel project (different repo/app). Don't confuse
  it with this one.
