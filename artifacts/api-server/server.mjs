// Vercel's Node.js runtime auto-detects this file (server.{js,cjs,mjs,ts,cts,mts} at the
// project root) and captures its listen() call as a Vercel Function. Deliberately plain JS:
// dist/index.mjs is already fully bundled by esbuild (no TypeScript, no unresolved
// @workspace/* project references), so Vercel never needs to compile anything here.
import "./dist/index.mjs";
