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
  ChangePasswordBody,
} from "@workspace/api-zod";
import {
  clearSessionCookie,
  hashPassword,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from "../lib/auth";

const router: IRouter = Router();

function toOwnerResponse(row: {
  id: string;
  created_at: Date;
  email: string;
  name: string;
  phone: string | null;
}) {
  return {
    id: row.id,
    createdAt: row.created_at.toISOString(),
    email: row.email,
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
    const passwordHash = await hashPassword(input.password);
    const result = await pool.query(
      "INSERT INTO owners (email, password_hash, name) VALUES ($1, $2, $3) RETURNING *",
      [input.email.toLowerCase(), passwordHash, input.name],
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
    const result = await pool.query("SELECT * FROM owners WHERE email = $1", [
      input.email.toLowerCase(),
    ]);
    const owner = result.rows[0];

    if (!owner || !(await verifyPassword(input.password, owner.password_hash))) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

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
      `UPDATE owners SET name = COALESCE($1, name), email = COALESCE($2, email),
       phone = COALESCE($3, phone), updated_at = now() WHERE id = $4 RETURNING *`,
      [input.name ?? null, input.email?.toLowerCase() ?? null, input.phone ?? null, req.ownerId],
    );
    res.json(UpdateMeResponse.parse(toOwnerResponse(result.rows[0])));
  } catch (error) {
    next(error);
  }
});

router.post("/auth/change-password", requireAuth, async (req, res, next) => {
  try {
    const input = ChangePasswordBody.parse(req.body);
    const result = await pool.query("SELECT * FROM owners WHERE id = $1", [req.ownerId]);
    const owner = result.rows[0];

    if (!owner || !(await verifyPassword(input.currentPassword, owner.password_hash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }

    const newHash = await hashPassword(input.newPassword);
    await pool.query("UPDATE owners SET password_hash = $1, updated_at = now() WHERE id = $2", [
      newHash,
      req.ownerId,
    ]);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export default router;
