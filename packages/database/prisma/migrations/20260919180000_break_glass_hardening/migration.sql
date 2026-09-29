-- Break-glass becomes a real, auditable, single-use recovery credential.
-- `token` now holds a SHA-256 hash; any pre-existing rows held raw tokens that
-- nothing could ever redeem, so they are removed rather than kept as live secrets.
DELETE FROM "break_glass_tokens";

ALTER TABLE "break_glass_tokens"
  ADD COLUMN "user_id"    TEXT,
  ADD COLUMN "issued_by"  TEXT,
  ADD COLUMN "reason"     TEXT,
  ADD COLUMN "used_at"    TIMESTAMP(3),
  ADD COLUMN "revoked_at" TIMESTAMP(3);
