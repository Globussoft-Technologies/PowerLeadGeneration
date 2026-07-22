import { describe, expect, it } from "vitest";
import { createOpaqueToken, hashOpaqueToken, hashPassword, safeTokenMatch, validatePassword, verifyPassword } from "./auth.js";

describe("authentication primitives", () => {
  it("enforces the production password policy", () => {
    expect(validatePassword("short")).toContain("12 characters");
    expect(validatePassword("alllowercase123")).toContain("uppercase");
    expect(validatePassword("ValidPassword123")).toBeNull();
  });

  it("hashes passwords without storing the original value", async () => {
    const hash = await hashPassword("ValidPassword123");
    expect(hash).not.toContain("ValidPassword123");
    expect(await verifyPassword("ValidPassword123", hash)).toBe(true);
    expect(await verifyPassword("WrongPassword123", hash)).toBe(false);
  });

  it("creates opaque tokens and compares CSRF values safely", () => {
    const token = createOpaqueToken();
    expect(token.length).toBeGreaterThan(30);
    expect(hashOpaqueToken(token)).toHaveLength(64);
    expect(safeTokenMatch(token, token)).toBe(true);
    expect(safeTokenMatch(token, `${token}x`)).toBe(false);
  });
});
