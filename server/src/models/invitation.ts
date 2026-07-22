import { Schema, Types, model } from "mongoose";
import type { Role } from "../security/auth.js";

export type InvitationDocumentShape = {
  workspaceId: string;
  email: string;
  name?: string;
  role: Role;
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt?: Date;
  createdAt: Date;
};

const invitationSchema = new Schema<InvitationDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  email: { type: String, required: true, lowercase: true, trim: true, index: true },
  name: { type: String, trim: true },
  role: { type: String, enum: ["admin", "operator", "reviewer"], required: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  acceptedAt: Date
}, { timestamps: { createdAt: true, updatedAt: false } });

invitationSchema.index({ workspaceId: 1, email: 1, createdAt: -1 });

export const InvitationModel = model<InvitationDocumentShape>("Invitation", invitationSchema);
