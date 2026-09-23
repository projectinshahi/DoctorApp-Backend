-- Devices that can receive push notifications for a student.
--
-- token is globally unique, not unique per student: a registration token
-- belongs to an app install rather than a person, so when a phone changes
-- hands the token must move to whoever signs in next. Scoped per student, the
-- old row would survive and the previous student's notifications would keep
-- arriving on a phone they no longer own.
CREATE TABLE "fcm_tokens" (
  "id"        SERIAL PRIMARY KEY,
  "userId"    INTEGER NOT NULL,
  "token"     TEXT NOT NULL,
  "platform"  TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "fcm_tokens_userId_fkey" FOREIGN KEY ("userId")
    REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "fcm_tokens_token_key" ON "fcm_tokens"("token");
CREATE INDEX "fcm_tokens_userId_idx" ON "fcm_tokens"("userId");
