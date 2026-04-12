import * as Crypto from "expo-crypto";
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export async function hashPassword(password: string, salt = bytesToHex(Crypto.getRandomBytes(16))) {
  const derivedKey = await scryptAsync(password, salt, {
    N: 1 << 14,
    r: 8,
    p: 1,
    dkLen: 64,
  });

  return {
    salt,
    hash: bytesToHex(derivedKey),
  };
}

export async function verifyPassword(password: string, salt: string, hash: string) {
  const candidate = await hashPassword(password, salt);
  return candidate.hash === hash;
}
