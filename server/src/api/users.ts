import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import type { MailClient } from "../integrations/sendGrid.js";
import { AuthSessionModel } from "../models/authSession.js";
import { InvitationModel } from "../models/invitation.js";
import { UserModel } from "../models/user.js";
import { objectId } from "../pipeline/orchestrator.js";
import { requireRole } from "../security/auth.js";
import { sendAuthMail, tokenExpiry } from "./auth.js";
import { createOpaqueToken, hashOpaqueToken, publicUser } from "../services/auth.js";
import { recordAuditEvent } from "../services/audit.js";

export function usersRouter(mailClient: MailClient) {
  const router = Router();
  router.use(requireRole("admin"));

  router.get("/", async (request, response, next) => {
    try {
      const users = await UserModel.find({ workspaceId: request.actor.workspaceId }).sort({ createdAt: 1 });
      return response.json(users.map(publicUser));
    } catch (error) { return next(error); }
  });

  router.post("/invitations", async (request, response, next) => {
    try {
      const input = z.object({
        email: z.string().trim().toLowerCase().email().max(254),
        name: z.string().trim().max(100).optional(),
        role: z.enum(["admin", "operator", "reviewer"])
      }).parse(request.body);
      if (await UserModel.exists({ email: input.email })) return response.status(409).json({ error: "A user already exists for this email" });
      await InvitationModel.deleteMany({ workspaceId: request.actor.workspaceId, email: input.email, acceptedAt: { $exists: false } });
      const token = createOpaqueToken();
      const invitation = await InvitationModel.create({
        workspaceId: request.actor.workspaceId,
        email: input.email,
        name: input.name,
        role: input.role,
        tokenHash: hashOpaqueToken(token),
        invitedBy: request.actor.userId,
        expiresAt: tokenExpiry()
      });
      const inviteUrl = `${env.APP_BASE_URL}/#accept-invite?token=${encodeURIComponent(token)}`;
      await sendAuthMail(mailClient, input.email, input.name || input.email, "You are invited to Power Leads", `You have been invited as ${input.role}.\n\nAccept your invitation:\n${inviteUrl}\n\nThis link expires in ${env.AUTH_TOKEN_TTL_HOURS} hours.`);
      await recordAuditEvent(request, "user.invited", "invitation", invitation.id, { email: input.email, role: input.role });
      return response.status(201).json({ id: invitation.id, email: invitation.email, role: invitation.role, expiresAt: invitation.expiresAt.toISOString(), debugInviteUrl: env.NODE_ENV !== "production" ? inviteUrl : undefined });
    } catch (error) { return next(error); }
  });

  router.patch("/:userId", async (request, response, next) => {
    try {
      const userId = objectId(request.params.userId);
      if (!userId) return response.status(400).json({ error: "Invalid user ID" });
      const input = z.object({ role: z.enum(["admin", "operator", "reviewer"]).optional(), status: z.enum(["active", "disabled"]).optional() }).refine((value) => value.role || value.status, "No changes supplied").parse(request.body);
      const user = await UserModel.findOne({ _id: userId, workspaceId: request.actor.workspaceId });
      if (!user) return response.status(404).json({ error: "User not found" });
      if (user.id === request.actor.userId && input.status === "disabled") return response.status(409).json({ error: "You cannot disable your own account" });
      const removesAdmin = user.role === "admin" && (input.role && input.role !== "admin" || input.status === "disabled");
      if (removesAdmin && await UserModel.countDocuments({ workspaceId: request.actor.workspaceId, role: "admin", status: "active" }) <= 1) {
        return response.status(409).json({ error: "At least one active admin is required" });
      }
      if (input.role) user.role = input.role;
      if (input.status) user.status = input.status;
      await user.save();
      if (user.status === "disabled") await AuthSessionModel.deleteMany({ userId: user._id });
      await recordAuditEvent(request, "user.updated", "user", user.id, input);
      return response.json(publicUser(user));
    } catch (error) { return next(error); }
  });

  return router;
}
