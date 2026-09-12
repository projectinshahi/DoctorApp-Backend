-- Rapid Recall: images with a note against each, filed under a course and
-- narrowed as far as the admin wants.
--
-- Only courseId is required. courseTypeId, subjectId and lessonId each narrow
-- the set further and each may be null, so one set of revision cards can serve
-- a whole subject instead of being duplicated per lesson.
CREATE TABLE "rapid_recalls" (
  "id"           SERIAL PRIMARY KEY,
  "courseId"     INTEGER NOT NULL,
  "courseTypeId" INTEGER,
  "subjectId"    INTEGER,
  "lessonId"     INTEGER,
  "title"        TEXT NOT NULL,
  "description"  TEXT,
  "noteUrl"      TEXT,
  "notePublicId" TEXT,
  "noteFileType" TEXT,
  "status"       "CourseStatus" NOT NULL DEFAULT 'draft',
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "rapid_recalls_courseId_fkey" FOREIGN KEY ("courseId")
    REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "rapid_recalls_courseTypeId_fkey" FOREIGN KEY ("courseTypeId")
    REFERENCES "course_types"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  -- SetNull, not Cascade: retiring a subject from the question bank must not
  -- silently delete revision material an admin wrote.
  CONSTRAINT "rapid_recalls_subjectId_fkey" FOREIGN KEY ("subjectId")
    REFERENCES "subjects"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "rapid_recalls_lessonId_fkey" FOREIGN KEY ("lessonId")
    REFERENCES "lessons"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "rapid_recalls_courseId_courseTypeId_status_displayOrder_idx"
  ON "rapid_recalls"("courseId", "courseTypeId", "status", "displayOrder");
CREATE INDEX "rapid_recalls_subjectId_idx" ON "rapid_recalls"("subjectId");
CREATE INDEX "rapid_recalls_lessonId_idx"  ON "rapid_recalls"("lessonId");

-- A card is an image, a note, or both. Never neither — the API enforces that,
-- the way test questions do.
CREATE TABLE "rapid_recall_cards" (
  "id"           SERIAL PRIMARY KEY,
  "recallId"     INTEGER NOT NULL,
  "imageUrl"     TEXT,
  "note"         TEXT,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "rapid_recall_cards_recallId_fkey" FOREIGN KEY ("recallId")
    REFERENCES "rapid_recalls"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "rapid_recall_cards_recallId_displayOrder_idx"
  ON "rapid_recall_cards"("recallId", "displayOrder");
