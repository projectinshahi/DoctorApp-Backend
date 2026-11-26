-- Owner access: a student account that opens all content without a
-- subscription. Off for everyone; set by scripts/grantFullAccess.js only.
ALTER TABLE "users" ADD COLUMN "fullAccess" BOOLEAN NOT NULL DEFAULT false;
