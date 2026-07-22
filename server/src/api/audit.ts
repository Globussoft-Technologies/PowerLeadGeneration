import { Router } from "express";
import { z } from "zod";
import { AuditEventModel } from "../models/auditEvent.js";
import { requireRole } from "../security/auth.js";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  action: z.string().trim().min(1).max(100).optional()
});

export function auditRouter() {
  const router = Router();
  router.get("/", requireRole("admin"), async (request, response, next) => {
    try {
      const query = querySchema.parse(request.query);
      const events = await AuditEventModel.find({
        workspaceId: request.actor.workspaceId,
        ...(query.action ? { action: query.action } : {})
      }).sort({ createdAt: -1 }).limit(query.limit).lean();
      return response.json(events.map((event) => ({
        id: event._id.toString(),
        actorId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        resourceType: event.resourceType,
        resourceId: event.resourceId,
        requestId: event.requestId,
        metadata: event.metadata,
        createdAt: event.createdAt.toISOString()
      })));
    } catch (error) {
      return next(error);
    }
  });
  return router;
}
