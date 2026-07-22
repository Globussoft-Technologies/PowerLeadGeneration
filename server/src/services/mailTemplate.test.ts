import { describe, expect, it } from "vitest";
import { renderMailTemplate, textToHtml, unsupportedPlaceholders } from "./mailTemplate.js";

const context = {
  firstName: "Morgan",
  contactName: "Morgan Lee",
  companyName: "Acme",
  companyDomain: "acme.com",
  personalization: "Your growth campaign stood out.",
  adSnippet: "Build faster",
  senderName: "Alex"
};

describe("mail templates", () => {
  it("renders supported personalization fields", () => {
    expect(renderMailTemplate("Hi {{firstName}}, {{personalization}} — {{senderName}}", context))
      .toBe("Hi Morgan, Your growth campaign stood out. — Alex");
  });

  it("reports unsupported placeholders", () => {
    expect(unsupportedPlaceholders("Hello {{firstName}} {{unknown}}"))
      .toEqual(["unknown"]);
  });

  it("escapes HTML while preserving line breaks", () => {
    expect(textToHtml("Hi <Morgan>\nAcme & Co"))
      .toBe("Hi &lt;Morgan&gt;<br>Acme &amp; Co");
  });
});
