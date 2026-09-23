-- What a student sees on the notifications screen.
--
-- Written whether or not the push goes out: a phone with notifications off, or
-- none registered, should still find the item in the app.
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER,
    "courseId" INTEGER,
    "courseTypeId" INTEGER,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "notifications_courseId_courseTypeId_createdAt_idx" ON "notifications"("courseId", "courseTypeId", "createdAt");

CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everything newer than this counts as unread. One timestamp per student is
-- all a badge needs; a row per student per notification is not.
ALTER TABLE "users" ADD COLUMN "notificationsReadAt" TIMESTAMP(3);
