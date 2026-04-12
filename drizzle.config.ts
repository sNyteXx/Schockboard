import type { Config } from "drizzle-kit";

export default {
  schema: "./src/db/schema.ts",
  out: "./src/db/generated",
  dialect: "sqlite",
  dbCredentials: {
    url: "schockboard.db",
  },
} satisfies Config;
