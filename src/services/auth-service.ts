import * as SecureStore from "expo-secure-store";

import type { AuthAccount } from "@/domain/types";
import { nowIso } from "@/domain/utils";
import { ensureDatabaseReady } from "@/db/bootstrap";
import { sqliteGet, sqliteRun } from "@/db/client";
import { createId } from "@/services/id";

const SESSION_KEY = "schockboard.unlock.account";
const LOCAL_ACCOUNT_USERNAME = "Dieses Gerät";
const LOCAL_ACCOUNT_SECRET = "local-device-only";

function mapAccount(row: {
  id: string;
  username: string;
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}): AuthAccount {
  return {
    id: row.id,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

function getAccountById(id: string) {
  const row = sqliteGet<{
    id: string;
    username: string;
    password_hash: string;
    password_salt: string;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
  }>(
    `
      SELECT id, username, password_hash, password_salt, created_at, updated_at, last_login_at
      FROM auth_accounts
      WHERE id = $id
      LIMIT 1
    `,
    {
      $id: id,
    },
  );

  return row ? mapAccount(row) : null;
}

function getFirstAccount() {
  const row = sqliteGet<{
    id: string;
    username: string;
    password_hash: string;
    password_salt: string;
    created_at: string;
    updated_at: string;
    last_login_at: string | null;
  }>(
    `
      SELECT id, username, password_hash, password_salt, created_at, updated_at, last_login_at
      FROM auth_accounts
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );

  return row ? mapAccount(row) : null;
}

async function persistSession(accountId: string) {
  await SecureStore.setItemAsync(SESSION_KEY, accountId);
}

export const AuthService = {
  async getCurrentAccount() {
    ensureDatabaseReady();
    const accountId = await SecureStore.getItemAsync(SESSION_KEY);
    const account = accountId ? getAccountById(accountId) : null;

    if (account) {
      return account;
    }

    const firstAccount = getFirstAccount();

    if (firstAccount) {
      await persistSession(firstAccount.id);
    }

    return firstAccount;
  },

  async ensureLocalAccount() {
    ensureDatabaseReady();
    const existing = await this.getCurrentAccount();

    if (existing) {
      sqliteRun(
        `
          UPDATE auth_accounts
          SET last_login_at = $lastLoginAt,
              updated_at = $updatedAt
          WHERE id = $id
        `,
        {
          $id: existing.id,
          $lastLoginAt: nowIso(),
          $updatedAt: nowIso(),
        },
      );

      return getAccountById(existing.id);
    }

    const now = nowIso();
    const accountId = createId("account");

    sqliteRun(
      `
        INSERT INTO auth_accounts (
          id,
          username,
          password_hash,
          password_salt,
          created_at,
          updated_at,
          last_login_at
        )
        VALUES ($id, $username, $passwordHash, $passwordSalt, $createdAt, $updatedAt, $lastLoginAt)
      `,
      {
        $id: accountId,
        $username: LOCAL_ACCOUNT_USERNAME,
        $passwordHash: LOCAL_ACCOUNT_SECRET,
        $passwordSalt: LOCAL_ACCOUNT_SECRET,
        $createdAt: now,
        $updatedAt: now,
        $lastLoginAt: now,
      },
    );

    await persistSession(accountId);
    return getAccountById(accountId);
  },

  async logout() {
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};
