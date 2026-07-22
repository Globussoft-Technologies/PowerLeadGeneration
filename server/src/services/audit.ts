import type { Request } from "express";
import { AuditEventModel } from "../models/auditEvent.js";

export async function recordAuditEvent(
  request: Request,
  action: string,
  resourceType: string,
  resourceId: string,
  metadata: Record<string, unknown> = {}
) {
  await AuditEventModel.create({
    workspaceId: request.actor.workspaceId,
    actorId: request.actor.userId,
    actorRole: request.actor.role,
    action,
    resourceType,
    resourceId,
    requestId: request.requestId,
    metadata
  });
}
