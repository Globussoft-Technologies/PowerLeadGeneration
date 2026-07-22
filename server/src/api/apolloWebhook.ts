import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { ContactModel } from "../models/contact.js";

const nullableText = z.string().trim().nullable().optional().transform((value) => value || undefined);
const phoneSchema = z.object({
  raw_number: nullableText,
  sanitized_number: nullableText,
  type: nullableText,
  type_cd: nullableText,
  status: nullableText,
  status_cd: nullableText,
  source_name: nullableText,
  direct_dial_source_cd: nullableText
}).passthrough();

const payloadSchema = z.object({
  people: z.array(z.object({
    id: z.string().trim().min(1),
    phone_numbers: z.array(phoneSchema).nullish().transform((value) => value ?? [])
  }).passthrough()).nullish().transform((value) => value ?? [])
}).passthrough();

export const apolloWebhookHandler: RequestHandler = async (request, response, next) => {
  try {
    if (!env.APOLLO_WEBHOOK_SECRET) return response.status(503).json({ error: "Apollo webhook is not configured" });
    const supplied = typeof request.query.token === "string" ? request.query.token : "";
    if (!safeEqual(supplied, env.APOLLO_WEBHOOK_SECRET)) return response.status(401).json({ error: "Invalid webhook token" });

    const payload = parseApolloPhoneWebhook(request.body);
    let matched = 0;
    for (const person of payload.people) {
      const phoneNumbers = normalizePhones(person.phone_numbers ?? []);
      if (phoneNumbers.length === 0) continue;
      const result = await ContactModel.updateMany({ apolloId: person.id }, { $set: { phoneNumbers } });
      matched += result.matchedCount;
    }
    return response.json({ received: payload.people.length, contactsUpdated: matched });
  } catch (error) {
    return next(error);
  }
};

export function parseApolloPhoneWebhook(value: unknown) {
  return payloadSchema.parse(value);
}

function normalizePhones(phones: z.infer<typeof phoneSchema>[]) {
  const seen = new Set<string>();
  return phones.flatMap((phone) => {
    const number = phone.sanitized_number ?? phone.raw_number;
    if (!number || seen.has(number)) return [];
    seen.add(number);
    return [{
      number,
      type: phone.type ?? phone.type_cd,
      status: phone.status ?? phone.status_cd,
      source: phone.source_name ?? phone.direct_dial_source_cd
    }];
  });
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
