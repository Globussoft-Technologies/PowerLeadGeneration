import { Schema, Types, model } from "mongoose";

export type AuthSessionDocumentShape = {
  workspaceId: string;
  userId: Types.ObjectId;
  tokenHash: string;
  csrfToken: string;
  expiresAt: Date;
  lastSeenAt: Date;
  userAgent?: string;
  ip?: string;
  createdAt: Date;
};

const authSessionSchema = new Schema<AuthSessionDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  csrfToken: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  lastSeenAt: { type: Date, required: true },
  userAgent: String,
  ip: String
}, { timestamps: { createdAt: true, updatedAt: false } });

authSessionSchema.index({ userId: 1, expiresAt: 1 });

export const AuthSessionModel = model<AuthSessionDocumentShape>("AuthSession", authSessionSchema);
