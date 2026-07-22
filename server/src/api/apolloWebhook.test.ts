import { describe, expect, it } from "vitest";
import { parseApolloPhoneWebhook } from "./apolloWebhook.js";

describe("Apollo phone webhook", () => {
  it("accepts nullable phone metadata from Apollo", () => {
    const payload = parseApolloPhoneWebhook({ people: [{
      id: "person-1",
      phone_numbers: [{ raw_number: "+1 555 123 4567", sanitized_number: "+15551234567", type_cd: null, status_cd: "valid_number" }]
    }] });

    expect(payload.people[0]?.phone_numbers[0]).toMatchObject({ sanitized_number: "+15551234567", status_cd: "valid_number" });
  });

  it("rejects phone results without an Apollo person id", () => {
    expect(() => parseApolloPhoneWebhook({ people: [{ phone_numbers: [] }] })).toThrow();
  });
});
