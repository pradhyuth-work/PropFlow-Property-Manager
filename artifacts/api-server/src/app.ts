import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "node:path";
import { pinoHttp } from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const cookieSecret = process.env.COOKIE_SECRET;

if (!cookieSecret) {
  throw new Error(
    "COOKIE_SECRET environment variable is required but was not provided.",
  );
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(cookieParser(cookieSecret));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

const publicDir = path.join(__dirname, "public");

// Vite content-hashes every file under /assets, so a given filename's
// content never changes - safe (and desirable) to cache aggressively.
app.use(
  "/assets",
  express.static(path.join(publicDir, "assets"), {
    immutable: true,
    maxAge: "1y",
  }),
);

// Everything else (index.html, favicon, robots.txt) must never be served
// from a conditional-GET cache. Vercel's function-bundle packaging
// normalizes file mtimes, so index.html reports the *same*
// Last-Modified/ETag on every deploy regardless of its actual (changed)
// content - a browser that already cached it keeps getting 304 Not
// Modified forever and reuses its stale copy, which then references
// content-hashed asset filenames from an old deploy that no longer exist
// (a real 404, not the earlier MIME-mismatch bug). Disabling conditional
// caching here forces a fresh fetch on every load instead.
app.use(
  express.static(publicDir, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "no-store");
    },
  }),
);

// SPA fallback: any non-API GET that didn't match a static file goes to
// index.html so client-side routing (wouter) can take over. Requests under
// /assets are always a specific built file (JS/CSS chunk) referenced by a
// content hash - if one 404s (e.g. a stale client still holding an old
// index.html after a redeploy replaced the hashes) it must stay a real 404,
// not silently become an HTML response: browsers enforce strict MIME
// checking on <script type="module">, so serving index.html there fails
// with a confusing "Expected a JavaScript... module script" error instead
// of a clear "failed to load, please refresh" signal.
app.use((req, res, next) => {
  if (req.method !== "GET" || req.path.startsWith("/api") || req.path.startsWith("/assets")) {
    return next();
  }
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
