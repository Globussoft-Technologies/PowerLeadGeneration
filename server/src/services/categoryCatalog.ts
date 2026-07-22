import type { CategoryOption } from "@power-leads/shared";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type RawCatalog = Record<string, {
  id: number;
  sub_categories: Record<string, { id: number }>;
}>;

let cachedCatalog: CategoryOption[] | undefined;

export function getCategoryCatalog() {
  if (cachedCatalog) return cachedCatalog;
  const catalogPath = resolve(import.meta.dirname, "../../../category.json");
  const raw = JSON.parse(readFileSync(catalogPath, "utf8")) as RawCatalog;

  cachedCatalog = Object.entries(raw).map(([title, category]) => {
    if (!Number.isInteger(category.id) || !category.sub_categories) {
      throw new Error(`Invalid category entry: ${title}`);
    }
    return {
      id: category.id,
      title,
      industries: Object.entries(category.sub_categories).map(([industryTitle, industry]) => {
        if (!Number.isInteger(industry.id)) throw new Error(`Invalid industry entry: ${industryTitle}`);
        return { id: industry.id, title: industryTitle };
      })
    };
  });

  return cachedCatalog;
}
