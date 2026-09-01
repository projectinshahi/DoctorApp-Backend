-- Instructions the admin writes once and both sides read: the panel to edit,
-- the student app to show before the timer starts.
ALTER TABLE "tests" ADD COLUMN "instructions" TEXT;

-- The part of the paper a question sits in. A label, not a foreign key — a
-- section is whatever the questions say it is, so there is no second table to
-- keep in step and no way to have a section with nothing in it.
ALTER TABLE "test_questions" ADD COLUMN "section" TEXT;
