-- Email signup is verified with a 6-digit code typed into the app.
--
-- Only an HMAC of the code is stored. All four columns are empty for Google
-- accounts and for anyone already verified.
ALTER TABLE "users"
    ADD COLUMN "emailOtpHash" TEXT,
    ADD COLUMN "emailOtpExpiresAt" TIMESTAMP(3),
    ADD COLUMN "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "emailOtpSentAt" TIMESTAMP(3);
