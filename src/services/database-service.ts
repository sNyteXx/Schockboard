import { ensureDatabaseReady, resetBootstrapFlag } from "@/db/bootstrap";
import { getSqlite } from "@/db/client";

export const DatabaseService = {
  async initialize() {
    ensureDatabaseReady();
  },
  async reset() {
    const db = getSqlite();
    db.execSync("PRAGMA foreign_keys = OFF;");

    try {
      const objects = db.getAllSync(
        "SELECT name, type FROM sqlite_master WHERE (type = 'table' OR type = 'view') AND name NOT LIKE 'sqlite_%'",
      ) as Array<{ name: string; type: "table" | "view" }>;

      for (const object of objects) {
        const kind = object.type === "view" ? "VIEW" : "TABLE";
        db.execSync(`DROP ${kind} IF EXISTS "${object.name}"`);
      }

      resetBootstrapFlag();
    } finally {
      db.execSync("PRAGMA foreign_keys = ON;");
    }

    ensureDatabaseReady();
  },
};
