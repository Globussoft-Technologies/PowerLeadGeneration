import { describe, expect, it } from "vitest";
import { getCategoryCatalog } from "./categoryCatalog.js";

describe("category catalog", () => {
  it("loads category and industry titles from the root JSON file", () => {
    const categories = getCategoryCatalog();
    expect(categories).toHaveLength(45);
    expect(categories.flatMap((category) => category.industries)).toHaveLength(539);
    expect(categories.find((category) => category.title === "Alcohol")?.industries.map((industry) => industry.title))
      .toEqual(["Bars", "Beer", "Hard Sodas, Seltzers, Alco Pops", "Spirits", "Wine"]);
  });
});
