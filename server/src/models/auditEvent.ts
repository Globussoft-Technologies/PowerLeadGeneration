import { Schema, model } from "mongoose";
import type { Role } from "../security/auth.js";

export type AuditEventDocumentShape = {
  workspaceId: string;
  actorId: string;
  actorRole: Role;
  action: string;
  resourceType: string;
  resourceId: string;
  requestId: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

const auditEventSchema = new Schema<AuditEventDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  actorId: { type: String, required: true, trim: true, index: true },
  actorRole: { type: String, enum: ["admin", "operator", "reviewer"], required: true },
  action: { type: String, required: true, trim: true, index: true },
  resourceType: { type: String, required: true, trim: true },
  resourceId: { type: String, required: true, trim: true },
  requestId: { type: String, required: true, trim: true },
  metadata: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: { createdAt: true, updatedAt: false } });

auditEventSchema.index({ workspaceId: 1, createdAt: -1 });
auditEventSchema.index({ workspaceId: 1, resourceType: 1, resourceId: 1, createdAt: -1 });

export const AuditEventModel = model<AuditEventDocumentShape>("AuditEvent", auditEventSchema);
