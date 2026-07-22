import { env } from "../config/env.js";
import { MailQuotaModel } from "../models/mailQuota.js";

export async function reserveMailQuota(workspaceId: string, runId: string, recipients: number, now = new Date()) {
  if (recipients < 1) return;
  await reserve(workspaceId, "run", runId, recipients, env.MAIL_PER_RUN_LIMIT, "Per-run email limit exceeded");
  const day = now.toISOString().slice(0, 10);
  try {
    await reserve(workspaceId, "day", day, recipients, env.MAIL_DAILY_WORKSPACE_LIMIT, "Daily workspace email limit exceeded");
  } catch (error) {
    await MailQuotaModel.updateOne({ workspaceId, scope: "run", key: runId }, { $inc: { count: -recipients } });
    throw error;
  }
}

async function reserve(workspaceId: string, scope: "run" | "day", key: string, amount: number, limit: number, message: string) {
  try {
    await MailQuotaModel.updateOne(
      { workspaceId, scope, key },
      { $setOnInsert: { workspaceId, scope, key, count: 0 } },
      { upsert: true }
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error;
  }
  const reserved = await MailQuotaModel.findOneAndUpdate(
    { workspaceId, scope, key, count: { $lte: limit - amount } },
    { $inc: { count: amount } },
    { new: true }
  );
  if (!reserved) {
    const current = await MailQuotaModel.findOne({ workspaceId, scope, key });
    throw new Error(`${message} (${current?.count ?? 0}/${limit} already reserved)`);
  }
}

function isDuplicateKey(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11000);
}
