import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import {
  GetAuthStatusResponse,
  SetupOwnerBody,
  SetupOwnerResponse,
  LoginBody,
  LoginResponse,
  GetMeResponse,
  UpdateMeBody,
  UpdateMeResponse,
  ChangePinBody,
} from "@workspace/api-zod";
import {
  clearSessionCookie,
  hashPin,
  MAX_FAILED_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  requireAuth,
  setSessionCookie,
  verifyPin,
} from "../lib/auth";

const router: IRouter = Router();

function toOwnerResponse(row: {
  id: string;
  created_at: Date;
  name: string;
  phone: string | null;
}) {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    name: row.name,
    phone: row.phone,
  };
}

router.get("/auth/status", async (_req, res, next) => {
  try {
    const result = await pool.query("SELECT COUNT(*)::int AS count FROM owners");
    res.json(GetAuthStatusResponse.parse({ hasOwner: result.rows[0].count > 0 }));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/setup", async (req, res, next) => {
  try {
    const existing = await pool.query("SELECT COUNT(*)::int AS count FROM owners");
    if (existing.rows[0].count > 0) {
      res.status(409).json({ error: "An owner account already exists" });
      return;
    }

    const input = SetupOwnerBody.parse(req.body);
    const pinHash = await hashPin(input.pin);
    const result = await pool.query(
      "INSERT INTO owners (pin_hash, name) VALUES ($1, $2) RETURNING *",
      [pinHash, input.name],
    );

    const owner = result.rows[0];
    setSessionCookie(res, owner.id);
    res.status(201).json(SetupOwnerResponse.parse(toOwnerResponse(owner)));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/login", async (req, res, next) => {
  try {
    const input = LoginBody.parse(req.body);
    // Single-owner app: there is exactly one account, so login isn't keyed
    // by an identifier - just the PIN, checked against whichever row exists.
    const result = await pool.query("SELECT * FROM owners LIMIT 1");
    const owner = result.rows[0];

    if (!owner) {
      res.status(401).json({ error: "Invalid PIN" });
      return;
    }

    if (owner.locked_until && new Date(owner.locked_until).getTime() > Date.now()) {
      res.status(429).json({ error: "Too many attempts. Try again later." });
      return;
    }

    if (!(await verifyPin(input.pin, owner.pin_hash))) {
      const failedAttempts = owner.failed_pin_attempts + 1;
      const lockedOut = failedAttempts >= MAX_FAILED_PIN_ATTEMPTS;
      await pool.query(
        "UPDATE owners SET failed_pin_attempts = $1, locked_until = $2 WHERE id = $3",
        [
          lockedOut ? 0 : failedAttempts,
          lockedOut ? new Date(Date.now() + PIN_LOCKOUT_MS) : null,
          owner.id,
        ],
      );
      res
        .status(lockedOut ? 429 : 401)
        .json({ error: lockedOut ? "Too many attempts. Try again later." : "Invalid PIN" });
      return;
    }

    await pool.query(
      "UPDATE owners SET failed_pin_attempts = 0, locked_until = NULL WHERE id = $1",
      [owner.id],
    );

    setSessionCookie(res, owner.id);
    res.json(LoginResponse.parse(toOwnerResponse(owner)));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).send();
});

router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const result = await pool.query("SELECT * FROM owners WHERE id = $1", [req.ownerId]);
    const owner = result.rows[0];
    if (!owner) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    res.json(GetMeResponse.parse(toOwnerResponse(owner)));
  } catch (error) {
    next(error);
  }
});

router.patch("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const input = UpdateMeBody.parse(req.body);
    const result = await pool.query(
      `UPDATE owners SET name = COALESCE($1, name),
       phone = COALESCE($2, phone), updated_at = now() WHERE id = $3 RETURNING *`,
      [input.name ?? null, input.phone ?? null, req.ownerId],
    );
    res.json(UpdateMeResponse.parse(toOwnerResponse(result.rows[0])));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/change-pin", requireAuth, async (req, res, next) => {
  try {
    const input = ChangePinBody.parse(req.body);
    const result = await pool.query("SELECT * FROM owners WHERE id = $1", [req.ownerId]);
    const owner = result.rows[0];

    if (!owner || !(await verifyPin(input.currentPin, owner.pin_hash))) {
      res.status(401).json({ error: "Current PIN is incorrect" });
      return;
    }

    const newHash = await hashPin(input.newPin);
    await pool.query("UPDATE owners SET pin_hash = $1, updated_at = now() WHERE id = $2", [
      newHash,
      req.ownerId,
    ]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
