import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { AuthSessionModel } from "../models/authSession.js";
import { UserModel } from "../models/user.js";
import { hashOpaqueToken, readSessionToken, safeTokenMatch } from "../services/auth.js";

export const ROLES = ["admin", "operator", "reviewer"] as const;
export type Role = (typeof ROLES)[number];

export type RequestActor = {
  userId: string;
  workspaceId: string;
  role: Role;
};

declare global {
  namespace Express {
    interface Request {
      actor: RequestActor;
      requestId: string;
      authSession?: { id: string; csrfToken: string };
    }
  }
}

const identitySchema = z.object({
  userId: z.string().trim().min(1).max(200),
  workspaceId: z.string().trim().min(1).max(200),
  role: z.enum(ROLES)
});

export function authenticateRequest(request: Request, response: Response, next: NextFunction) {
  void authenticate(request, response, next).catch(next);
}

async function authenticate(request: Request, response: Response, next: NextFunction) {
  if (env.AUTH_MODE === "development") {
    const parsed = identitySchema.safeParse({
      userId: header(request, "x-user-id") ?? env.DEV_AUTH_USER_ID,
      workspaceId: header(request, "x-workspace-id") ?? env.DEV_AUTH_WORKSPACE_ID,
      role: header(request, "x-user-role") ?? env.DEV_AUTH_ROLE
    });
    if (!parsed.success) return response.status(401).json({ error: "Invalid development identity" });
    request.actor = parsed.data;
    return next();
  }

  if (env.AUTH_MODE === "password") {
    const token = readSessionToken(request);
    if (!token) return response.status(401).json({ error: "Authentication required" });
    const session = await AuthSessionModel.findOne({ tokenHash: hashOpaqueToken(token), expiresAt: { $gt: new Date() } }).select("+csrfToken");
    if (!session) return response.status(401).json({ error: "Authentication required" });
    const user = await UserModel.findOne({ _id: session.userId, workspaceId: session.workspaceId, status: "active" });
    if (!user) {
      await AuthSessionModel.deleteOne({ _id: session._id });
      return response.status(401).json({ error: "Authentication required" });
    }
    request.actor = { userId: user.id, workspaceId: user.workspaceId, role: user.role };
    request.authSession = { id: session.id, csrfToken: session.csrfToken };
    if (Date.now() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
      void AuthSessionModel.updateOne({ _id: session._id }, { lastSeenAt: new Date() });
    }
    return next();
  }

  const suppliedSecret = header(request, "x-auth-proxy-secret");
  if (!suppliedSecret || !env.AUTH_PROXY_SHARED_SECRET || !secretsMatch(suppliedSecret, env.AUTH_PROXY_SHARED_SECRET)) {
    return response.status(401).json({ error: "Authentication required" });
  }

  const parsed = identitySchema.safeParse({
    userId: header(request, "x-auth-user-id"),
    workspaceId: header(request, "x-auth-workspace-id"),
    role: header(request, "x-auth-role")
  });
  if (!parsed.success) return response.status(401).json({ error: "Invalid authenticated identity" });
  request.actor = parsed.data;
  return next();
}

export function requireCsrf(request: Request, response: Response, next: NextFunction) {
  if (env.AUTH_MODE !== "password" || ["GET", "HEAD", "OPTIONS"].includes(request.method)) return next();
  if (!safeTokenMatch(request.header("x-csrf-token"), request.authSession?.csrfToken)) {
    return response.status(403).json({ error: "Invalid CSRF token" });
  }
  return next();
}

export function requireRole(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!roles.includes(request.actor.role)) return response.status(403).json({ error: "Insufficient permissions" });
    return next();
  };
}

function header(request: Request, name: string) {
  const value = request.header(name);
  return value?.trim() || undefined;
}

function secretsMatch(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
