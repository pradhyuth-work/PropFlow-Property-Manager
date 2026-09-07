import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { NextFunction, Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ownerId?: string;
    }
  }
}

const scrypt = promisify(scryptCallback);
const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A 4-digit PIN only has 10,000 possible values, so failed attempts are
// locked out well before that's brute-forceable over the network.
export const MAX_FAILED_PIN_ATTEMPTS = 5;
export const PIN_LOCKOUT_MS = 15 * 60 * 1000;

export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(pin, salt, 64)) as Buffer;
  return `${salt.toString("hex")}:${derivedKey.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const salt = Buffer.from(saltHex, "hex");
  const storedKey = Buffer.from(keyHex, "hex");
  const derivedKey = (await scrypt(pin, salt, 64)) as Buffer;

  return storedKey.length === derivedKey.length && timingSafeEqual(derivedKey, storedKey);
}

export function setSessionCookie(res: Response, ownerId: string): void {
  res.cookie(SESSION_COOKIE, ownerId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    signed: true,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE);
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const ownerId = req.signedCookies?.[SESSION_COOKIE];
  if (typeof ownerId !== "string" || !ownerId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.ownerId = ownerId;
  next();
}
