import { Schema, Types, model } from "mongoose";

export type PasswordResetDocumentShape = {
  workspaceId: string;
  userId: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
};

const passwordResetSchema = new Schema<PasswordResetDocumentShape>({
  workspaceId: { type: String, required: true, trim: true, index: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true, index: { expires: 0 } },
  usedAt: Date
}, { timestamps: { createdAt: true, updatedAt: false } });

export const PasswordResetModel = model<PasswordResetDocumentShape>("PasswordReset", passwordResetSchema);
