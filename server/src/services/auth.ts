import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { AuthSessionModel } from "../models/authSession.js";
import type { UserDocumentShape } from "../models/user.js";

const PASSWORD_ROUNDS = 12;

export function validatePassword(password: string) {
  if (password.length < 12) return "Password must contain at least 12 characters";
  if (password.length > 128) return "Password must contain at most 128 characters";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password)) {
    return "Password must include uppercase, lowercase, and numeric characters";
  }
  return null;
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, PASSWORD_ROUNDS);
}

export function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function createOpaqueToken() {
  return randomBytes(32).toString("base64url");
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(user: { _id: unknown; workspaceId: string }, request: Request) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);
  const session = await AuthSessionModel.create({
    workspaceId: user.workspaceId,
    userId: user._id,
    tokenHash: hashOpaqueToken(token),
    csrfToken,
    expiresAt,
    lastSeenAt: new Date(),
    userAgent: request.header("user-agent")?.slice(0, 500),
    ip: request.ip
  });
  return { session, token, csrfToken, expiresAt };
}

export function setSessionCookie(response: Response, token: string, expiresAt: Date) {
  response.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt
  });
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/"
  });
}

export function readSessionToken(request: Request) {
  const cookies = request.header("cookie")?.split(";") ?? [];
  for (const cookie of cookies) {
    const separator = cookie.indexOf("=");
    if (separator < 0) continue;
    const name = cookie.slice(0, separator).trim();
    if (name !== env.SESSION_COOKIE_NAME) continue;
    const value = cookie.slice(separator + 1).trim();
    try { return decodeURIComponent(value); } catch { return undefined; }
  }
  return undefined;
}

export function safeTokenMatch(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function publicUser(user: Pick<UserDocumentShape, "email" | "name" | "role" | "status" | "workspaceId"> & { _id: unknown }) {
  return {
    id: String(user._id),
    workspaceId: user.workspaceId,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status
  };
}
