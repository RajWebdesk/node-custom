import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma 7: connection URLs live here, not in the schema. The app passes a driver adapter at runtime.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: env("DATABASE_URL") },
});
