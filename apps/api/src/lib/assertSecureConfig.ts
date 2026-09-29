/**
 * Refuse to boot in production with credentials that would make every other
 * security control irrelevant. The repository's own `.env` files use
 * `devsecret` for BOTH JWT secrets and an all-zero encryption key; a production
 * deploy that copies them would let anyone mint a valid SUPER_ADMIN token (the
 * signing secret is public) and would "encrypt" stored payment credentials with
 * a known key.
 */
const WEAK_WORDS = /dev|test|change|default|example|password|secret|demo|sample|12345|qwerty/i;

function looksWeak(value: string): boolean {
  if (value.length < 32) return true;
  if (WEAK_WORDS.test(value)) return true;
  return new Set(value).size < 10; // "aaaa…", "0000…", repeated short patterns
}

export function findConfigProblems(env: NodeJS.ProcessEnv): string[] {
  const problems: string[] = [];

  const access = env.JWT_ACCESS_SECRET ?? "";
  const refresh = env.JWT_REFRESH_SECRET ?? "";
  if (looksWeak(access)) problems.push("JWT_ACCESS_SECRET is missing, shorter than 32 chars, or looks like a placeholder");
  if (looksWeak(refresh)) problems.push("JWT_REFRESH_SECRET is missing, shorter than 32 chars, or looks like a placeholder");
  if (access && access === refresh) {
    problems.push("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are identical — access and refresh tokens would be interchangeable");
  }

  const key = env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(key) || new Set(key).size < 8) {
    problems.push("ENCRYPTION_KEY must be 64 hex chars of real randomness (e.g. `openssl rand -hex 32`), not empty or repeated characters");
  }

  if (env.SKIP_ADMIN_IP_CHECK === "true") {
    problems.push("SKIP_ADMIN_IP_CHECK=true disables the admin IP allow-list; it must not be set in production");
  }

  return problems;
}

/** Call once at startup. No-op outside production so local dev keeps its convenient defaults. */
export function assertSecureConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production") return;
  const problems = findConfigProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `Refusing to start in production with an insecure configuration:\n  - ${problems.join("\n  - ")}`,
  );
}
