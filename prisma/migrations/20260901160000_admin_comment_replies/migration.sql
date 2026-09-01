-- A comment is written either by a student or by the teaching side. Admins are
-- not rows in "users", so the author needs two nullable columns and a rule
-- saying exactly one of them is filled.
ALTER TABLE "lesson_comments" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "lesson_comments" ADD COLUMN "adminId" INTEGER;

ALTER TABLE "lesson_comments"
  ADD CONSTRAINT "lesson_comments_adminId_fkey" FOREIGN KEY ("adminId")
  REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Neither-nor would be an orphan comment with no author to show; both-and
-- would be a comment claiming two. Neither is recoverable in the UI, so the
-- database refuses them rather than leaving it to every future caller.
ALTER TABLE "lesson_comments"
  ADD CONSTRAINT "lesson_comments_one_author"
  CHECK (("userId" IS NOT NULL AND "adminId" IS NULL)
      OR ("userId" IS NULL AND "adminId" IS NOT NULL));

CREATE INDEX "lesson_comments_adminId_idx" ON "lesson_comments"("adminId");
