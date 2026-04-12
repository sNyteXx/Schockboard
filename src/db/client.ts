import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync, type SQLiteBindParams, type SQLiteDatabase, type SQLiteRunResult } from "expo-sqlite";

import * as schema from "@/db/schema";

let sqlite: SQLiteDatabase | null = null;
let drizzleDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getSqlite() {
  if (!sqlite) {
    sqlite = openDatabaseSync("schockboard.db");
    sqlite.execSync("PRAGMA foreign_keys = ON;");
    sqlite.execSync("PRAGMA journal_mode = WAL;");
  }

  return sqlite;
}

export function getDrizzle() {
  if (!drizzleDb) {
    drizzleDb = drizzle(getSqlite(), { schema });
  }

  return drizzleDb;
}

export function sqliteRun(source: string, params: Record<string, unknown> = {}) {
  return getSqlite().runSync(source, params as SQLiteBindParams) as SQLiteRunResult;
}

export function sqliteGet<T>(source: string, params: Record<string, unknown> = {}) {
  return getSqlite().getFirstSync<T>(source, params as SQLiteBindParams);
}

export function sqliteAll<T>(source: string, params: Record<string, unknown> = {}) {
  return getSqlite().getAllSync<T>(source, params as SQLiteBindParams);
}
