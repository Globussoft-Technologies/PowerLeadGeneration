import { afterEach, describe, expect, it, vi } from "vitest";
import { createApolloClient, parseApolloEnrichResponse, parseApolloSearchResponse } from "./apollo.js";

afterEach(() => vi.restoreAllMocks());

describe("mock Apollo client", () => {
  it("searches personas and enriches a verified work email", async () => {
    const client = createApolloClient("mock");
    const candidates = await client.searchPeople("acme.example", {
      titles: ["CMO", "VP Marketing"],
      seniorities: ["c_suite", "vp"],
      requireVerifiedEmail: true
    });

    expect(candidates).toHaveLength(3);
    expect(candidates[0]?.title).toBe("CMO");

    const contact = await client.enrichPerson(candidates[0]!, "acme.example");
    expect(contact).toMatchObject({
      name: "Morgan Lee",
      email: "morgan.lee@acme.example",
      emailVerified: true
    });
  });

  it("validates Apollo search and enrichment contracts", () => {
    expect(parseApolloSearchResponse({ people: [{ id: "person-1", email: "valid@example.com" }] }).people).toHaveLength(1);
    expect(() => parseApolloSearchResponse({ people: [{ title: "Missing ID" }] })).toThrow();
    expect(parseApolloEnrichResponse({ person: { id: "person-1", email: "not-an-email" } }).person?.email).toBe("not-an-email");
  });

  it("accepts nullable Apollo channels and preserves channel arrays", () => {
    const payload = parseApolloEnrichResponse({
      person: {
        id: "person-1",
        linkedin_url: null,
        email_status: null,
        personal_emails: ["PERSONAL@EXAMPLE.COM", null],
        phone_numbers: [{ raw_number: "+1 555 123 4567", sanitized_number: "+15551234567", type: "mobile", status: "valid_number" }]
      }
    });

    expect(payload.person?.linkedin_url).toBeUndefined();
    expect(payload.person?.personal_emails).toEqual(["PERSONAL@EXAMPLE.COM", undefined]);
    expect(payload.person?.phone_numbers[0]?.sanitized_number).toBe("+15551234567");
  });

  it("skips a candidate-specific 422 and exposes Apollo's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "Person is no longer available" }), {
      status: 422,
      headers: { "content-type": "application/json" }
    }));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await createApolloClient("live").enrichPerson({
      id: "stale-person",
      firstName: "Stale",
      title: "CMO"
    }, "example.com");

    expect(result).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("Person is no longer available"));
  });

  it("keeps authentication failures fatal and includes Apollo's reason", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: "API key is invalid" }), {
      status: 401,
      headers: { "content-type": "application/json" }
    }));

    await expect(createApolloClient("live").enrichPerson({
      id: "person-1",
      firstName: "Valid",
      title: "CMO"
    }, "example.com")).rejects.toThrow("Apollo request failed (401): API key is invalid");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
