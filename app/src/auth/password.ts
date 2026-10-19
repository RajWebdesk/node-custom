import { hash, verify, Algorithm } from "@node-rs/argon2";

// D2 (approved by Hazel, relayed 2026-10-19): Argon2id password hashing.
// Parameters are set here from the OWASP minimums and must be verified against current
// guidance before production (see decision D2). Plaintext passwords are never stored or logged.
const OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(stored: string, plain: string): Promise<boolean> {
  try {
    return await verify(stored, plain);
  } catch {
    // A malformed stored hash counts as a failed verification, never a crash or a leak.
    return false;
  }
}
