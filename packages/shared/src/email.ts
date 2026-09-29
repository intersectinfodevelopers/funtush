/**
 * Canonical form of an email used ONLY for uniqueness comparisons — never
 * for display or for actually sending mail (that still uses the address the
 * user typed, unchanged).
 *
 * Without this, registration's "email already exists" check is trivially
 * bypassable: Gmail (and Google Workspace/Google Apps domains riding the
 * same rules) ignores dots in the local part and treats anything after a
 * "+" as a discardable tag, so `john.doe@gmail.com`, `johndoe@gmail.com`
 * and `john+agency2@gmail.com` all deliver to the same inbox but compare as
 * three different strings — letting one person register unlimited fake
 * accounts with a single real mailbox.
 */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at === -1) return trimmed;

  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);

  if (!GMAIL_DOMAINS.has(domain)) return trimmed;

  const withoutTag = local.split("+")[0];
  const withoutDots = withoutTag.replace(/\./g, "");
  return `${withoutDots}@gmail.com`;
}
