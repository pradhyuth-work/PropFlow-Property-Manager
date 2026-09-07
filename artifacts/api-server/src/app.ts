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
app.use(express.static(publicDir));

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
  res.sendFile(path.join(publicDir, "index.html"));
});

export default app;
