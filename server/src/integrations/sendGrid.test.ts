import { describe, expect, it } from "vitest";
import { createMailClient, formatSendGridError } from "./sendGrid.js";

describe("SendGrid mail client", () => {
  it("provides deterministic mock message identifiers", async () => {
    const result = await createMailClient("mock").send({
      to: "morgan@example.com",
      subject: "Hello",
      text: "Hello Morgan",
      html: "Hello Morgan",
      customArgs: { source: "power_leads" }
    });
    expect(result.messageId).toMatch(/^mock-/);
  });

  it("preserves SendGrid response details when status text is blank", () => {
    const message = formatSendGridError({
      code: 403,
      message: "",
      response: { body: { errors: [{ message: "The from address does not match a verified Sender Identity." }] } }
    });

    expect(message).toBe("SendGrid request failed (403): The from address does not match a verified Sender Identity.");
  });

  it("normalizes numeric status strings and empty provider errors", () => {
    expect(formatSendGridError({ code: "401", response: { body: { errors: [{ message: "Unauthorized" }] } } }))
      .toBe("SendGrid request failed (401): Unauthorized");
    expect(formatSendGridError(new Error("socket closed"))).toBe("SendGrid request failed: socket closed");
  });
});
