import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Queries the database so Vercel's daily cron hit (see vercel.json) counts
// as real activity against it, keeping a usage-based free-tier database
// (e.g. Supabase's 7-day-inactivity auto-pause) from pausing itself.
router.get("/healthz/db", async (_req, res) => {
  await pool.query("SELECT 1");
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export default router;
