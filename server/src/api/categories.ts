import { Router } from "express";
import { getCategoryCatalog } from "../services/categoryCatalog.js";

export function categoriesRouter() {
  const router = Router();
  router.get("/", (_request, response) => response.json(getCategoryCatalog()));
  return router;
}
