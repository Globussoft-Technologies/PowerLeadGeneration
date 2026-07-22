import sgMail from "@sendgrid/mail";
import pRetry, { AbortError } from "p-retry";
import { env } from "../config/env.js";

export type MailMessage = {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html: string;
  customArgs: Record<string, string>;
};

export type MailSendResult = { messageId: string };

export interface MailClient {
  send(message: MailMessage): Promise<MailSendResult>;
}

class LiveSendGridClient implements MailClient {
  constructor() {
    sgMail.setApiKey(env.SENDGRID_API_KEY ?? "");
  }

  async send(message: MailMessage) {
    const [response] = await pRetry(async () => {
      try {
        return await sgMail.send({
          to: { email: message.to, name: message.toName },
          from: { email: env.SENDGRID_FROM_EMAIL ?? "", name: env.SENDGRID_FROM_NAME },
          subject: message.subject,
          text: message.text,
          html: message.html,
          customArgs: message.customArgs
        });
      } catch (error) {
        const status = sendGridStatus(error);
        const message = formatSendGridError(error);
        if (status && status !== 429 && status < 500) {
          throw new AbortError(message);
        }
        throw new Error(message, { cause: error });
      }
    }, { retries: 3, factor: 2, minTimeout: 500, maxTimeout: 4_000 });

    const header = response.headers["x-message-id"];
    const messageId = Array.isArray(header) ? header[0] : header;
    return { messageId: messageId || `sendgrid-${Date.now()}` };
  }
}

class MockMailClient implements MailClient {
  async send(message: MailMessage) {
    return { messageId: `mock-${Buffer.from(message.to).toString("base64url")}` };
  }
}

function sendGridStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  if (typeof error.code === "number") return error.code;
  if (typeof error.code === "string" && /^\d{3}$/.test(error.code)) return Number(error.code);
  return undefined;
}

export function formatSendGridError(error: unknown) {
  const status = sendGridStatus(error);
  const messages = sendGridBodyMessages(error);
  const base = status ? `SendGrid request failed (${status})` : "SendGrid request failed";
  if (messages.length > 0) return `${base}: ${messages.join("; ")}`;
  if (error instanceof Error && error.message.trim()) return `${base}: ${error.message.trim()}`;
  return base;
}

function sendGridBodyMessages(error: unknown) {
  if (!error || typeof error !== "object" || !("response" in error)) return [];
  const response = error.response;
  if (!response || typeof response !== "object" || !("body" in response)) return [];
  const body = response.body;
  if (!body || typeof body !== "object") return [];
  const values: string[] = [];
  if ("message" in body && typeof body.message === "string" && body.message.trim()) values.push(body.message.trim());
  if ("errors" in body && Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (item && typeof item === "object" && "message" in item && typeof item.message === "string" && item.message.trim()) {
        values.push(item.message.trim());
      }
    }
  }
  return [...new Set(values)].slice(0, 5);
}

export function createMailClient(mode: "mock" | "live" = env.MAIL_MODE): MailClient {
  return mode === "live" ? new LiveSendGridClient() : new MockMailClient();
}
