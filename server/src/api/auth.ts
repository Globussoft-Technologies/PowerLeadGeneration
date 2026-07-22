import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import type { MailClient } from "../integrations/sendGrid.js";
import { AuditEventModel } from "../models/auditEvent.js";
import { AuthSessionModel } from "../models/authSession.js";
import { InvitationModel } from "../models/invitation.js";
import { PasswordResetModel } from "../models/passwordReset.js";
import { UserModel } from "../models/user.js";
import { authenticateRequest, requireCsrf } from "../security/auth.js";
import {
  clearSessionCookie,
  createOpaqueToken,
  createSession,
  hashOpaqueToken,
  hashPassword,
  publicUser,
  setSessionCookie,
  validatePassword,
  verifyPassword
} from "../services/auth.js";
import { textToHtml } from "../services/mailTemplate.js";

const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(128)
});
const passwordSchema = z.string().min(12).max(128).superRefine((password, context) => {
  const error = validatePassword(password);
  if (error) context.addIssue({ code: z.ZodIssueCode.custom, message: error });
});

export function authRouter(mailClient: MailClient) {
  const router = Router();

  router.post("/login", async (request, response, next) => {
    try {
      const input = credentialsSchema.parse(request.body);
      const user = await UserModel.findOne({ email: input.email }).select("+passwordHash");
      if (!user || user.status !== "active" || !(await verifyPassword(input.password, user.passwordHash))) {
        return response.status(401).json({ error: "Invalid email or password" });
      }
      const { token, csrfToken, expiresAt } = await createSession(user, request);
      user.lastLoginAt = new Date();
      await user.save();
      setSessionCookie(response, token, expiresAt);
      await authAudit(request, user.workspaceId, user.id, user.role, "auth.login", user.id);
      return response.json({ user: publicUser(user), csrfToken });
    } catch (error) { return next(error); }
  });

  router.get("/session", authenticateRequest, async (request, response, next) => {
    try {
      if (env.AUTH_MODE !== "password") {
        return response.json({ user: { id: request.actor.userId, workspaceId: request.actor.workspaceId, email: "", name: "Development user", role: request.actor.role, status: "active" }, csrfToken: "" });
      }
      const user = await UserModel.findOne({ _id: request.actor.userId, workspaceId: request.actor.workspaceId, status: "active" });
      if (!user) return response.status(401).json({ error: "Authentication required" });
      return response.json({ user: publicUser(user), csrfToken: request.authSession?.csrfToken ?? "" });
    } catch (error) { return next(error); }
  });

  router.post("/logout", authenticateRequest, requireCsrf, async (request, response, next) => {
    try {
      if (request.authSession) await AuthSessionModel.deleteOne({ _id: request.authSession.id, userId: request.actor.userId });
      clearSessionCookie(response);
      await authAudit(request, request.actor.workspaceId, request.actor.userId, request.actor.role, "auth.logout", request.actor.userId);
      return response.status(204).send();
    } catch (error) { return next(error); }
  });

  router.post("/logout-all", authenticateRequest, requireCsrf, async (request, response, next) => {
    try {
      await AuthSessionModel.deleteMany({ userId: request.actor.userId, workspaceId: request.actor.workspaceId });
      clearSessionCookie(response);
      await authAudit(request, request.actor.workspaceId, request.actor.userId, request.actor.role, "auth.logout_all", request.actor.userId);
      return response.status(204).send();
    } catch (error) { return next(error); }
  });

  router.post("/accept-invite", async (request, response, next) => {
    try {
      const input = z.object({ token: z.string().min(20).max(200), name: z.string().trim().min(1).max(100), password: passwordSchema }).parse(request.body);
      const invitation = await InvitationModel.findOne({ tokenHash: hashOpaqueToken(input.token), acceptedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
      if (!invitation) return response.status(400).json({ error: "Invitation is invalid or expired" });
      if (await UserModel.exists({ email: invitation.email })) return response.status(409).json({ error: "An account already exists for this email" });
      const user = await UserModel.create({
        workspaceId: invitation.workspaceId,
        email: invitation.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        role: invitation.role,
        status: "active"
      });
      invitation.acceptedAt = new Date();
      await invitation.save();
      const { token, csrfToken, expiresAt } = await createSession(user, request);
      setSessionCookie(response, token, expiresAt);
      await authAudit(request, user.workspaceId, user.id, user.role, "auth.invite_accepted", user.id);
      return response.status(201).json({ user: publicUser(user), csrfToken });
    } catch (error) { return next(error); }
  });

  router.post("/forgot-password", async (request, response, next) => {
    try {
      const { email } = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).parse(request.body);
      const user = await UserModel.findOne({ email, status: "active" });
      let debugResetUrl: string | undefined;
      if (user) {
        await PasswordResetModel.deleteMany({ userId: user._id, usedAt: { $exists: false } });
        const token = createOpaqueToken();
        await PasswordResetModel.create({ workspaceId: user.workspaceId, userId: user._id, tokenHash: hashOpaqueToken(token), expiresAt: tokenExpiry() });
        const resetUrl = `${env.APP_BASE_URL}/#reset-password?token=${encodeURIComponent(token)}`;
        await sendAuthMail(mailClient, user.email, user.name, "Reset your Power Leads password", `Use this link to reset your password:\n\n${resetUrl}\n\nThis link expires in ${env.AUTH_TOKEN_TTL_HOURS} hours.`);
        if (env.NODE_ENV !== "production") debugResetUrl = resetUrl;
      }
      return response.json({ message: "If the account exists, a reset link has been sent.", debugResetUrl });
    } catch (error) { return next(error); }
  });

  router.post("/reset-password", async (request, response, next) => {
    try {
      const input = z.object({ token: z.string().min(20).max(200), password: passwordSchema }).parse(request.body);
      const reset = await PasswordResetModel.findOne({ tokenHash: hashOpaqueToken(input.token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
      if (!reset) return response.status(400).json({ error: "Reset link is invalid or expired" });
      const user = await UserModel.findOne({ _id: reset.userId, workspaceId: reset.workspaceId, status: "active" }).select("+passwordHash");
      if (!user) return response.status(400).json({ error: "Reset link is invalid or expired" });
      user.passwordHash = await hashPassword(input.password);
      reset.usedAt = new Date();
      await Promise.all([user.save(), reset.save(), AuthSessionModel.deleteMany({ userId: user._id })]);
      await authAudit(request, user.workspaceId, user.id, user.role, "auth.password_reset", user.id);
      return response.json({ message: "Password reset. You can now log in." });
    } catch (error) { return next(error); }
  });

  router.post("/change-password", authenticateRequest, requireCsrf, async (request, response, next) => {
    try {
      const input = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).parse(request.body);
      const user = await UserModel.findOne({ _id: request.actor.userId, workspaceId: request.actor.workspaceId, status: "active" }).select("+passwordHash");
      if (!user || !(await verifyPassword(input.currentPassword, user.passwordHash))) return response.status(400).json({ error: "Current password is incorrect" });
      user.passwordHash = await hashPassword(input.newPassword);
      await Promise.all([user.save(), AuthSessionModel.deleteMany({ userId: user._id })]);
      const { token, csrfToken, expiresAt } = await createSession(user, request);
      setSessionCookie(response, token, expiresAt);
      await authAudit(request, user.workspaceId, user.id, user.role, "auth.password_changed", user.id);
      return response.json({ user: publicUser(user), csrfToken });
    } catch (error) { return next(error); }
  });

  return router;
}

function tokenExpiry() { return new Date(Date.now() + env.AUTH_TOKEN_TTL_HOURS * 60 * 60 * 1000); }

async function sendAuthMail(mailClient: MailClient, email: string, name: string, subject: string, text: string) {
  await mailClient.send({ to: email, toName: name, subject, text, html: textToHtml(text), customArgs: { source: "power_leads_auth" } });
}

async function authAudit(request: Parameters<typeof createSession>[1], workspaceId: string, actorId: string, actorRole: "admin" | "operator" | "reviewer", action: string, resourceId: string) {
  await AuditEventModel.create({ workspaceId, actorId, actorRole, action, resourceType: "user", resourceId, requestId: request.requestId, metadata: {} });
}

export { sendAuthMail, tokenExpiry };
