import mongoose from "mongoose";
import { env } from "../config/env.js";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5_000 });
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}

export function databaseState() {
  switch (mongoose.connection.readyState) {
    case 0: return "disconnected";
    case 1: return "connected";
    case 2: return "connecting";
    case 3: return "disconnecting";
    default: return "unknown";
  }
}
