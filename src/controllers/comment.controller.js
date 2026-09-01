// Lesson comments, student side.
//
// Three rules drive every handler here, and they are the ones that would be
// quietly broken by an obvious implementation:
//
//   1. A hidden comment disappears WITH ITS REPLIES. A moderator hiding an
//      abusive comment must not leave five replies quoting it behind.
//   2. A reported comment stays VISIBLE until a moderator acts. Otherwise one
//      student with a grudge is a censor.
//   3. Nesting is one level deep. A reply to a reply is re-parented onto the
//      thread root rather than rejected, because the app naturally sends the
//      id of whatever was tapped.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const { isLessonUnlocked } = require('./selected-course.controller');

const MAX_BODY = 2000;

/** Author fields a student may see about another student. No email. */
const AUTHOR_SELECT = { id: true, name: true, avatarUrl: true };

const COMMENT_SELECT = {
  id: true, parentId: true, body: true, createdAt: true, editedAt: true,
  user: { select: AUTHOR_SELECT },
};


/**
 * Where a reply actually attaches.
 *
 * One level only: replying to a reply joins the same thread rather than
 * starting a third tier. The app sends the id of whatever was tapped, so
 * rejecting that would be a bug the user pays for.
 */
function threadRootId(parent) {
  return parent.parentId ?? parent.id;
}


function shapeComment(comment, viewerId, reportedIds) {
  return {
    id: comment.id,
    parentId: comment.parentId,
    body: comment.body,
    createdAt: comment.createdAt,
    editedAt: comment.editedAt,
    edited: comment.editedAt !== null,
    author: comment.user,
    // Drives the UI without a second call: the app shows Edit/Delete on one's
    // own, Report on everyone else's, and never both.
    isMine: comment.userId === viewerId,
    reportedByMe: reportedIds.has(comment.id),
    replies: [],
  };
}


/**
 * The lesson, if this student is allowed to read it at all.
 *
 * Commenting inherits the lesson's access rules rather than inventing its own:
 * a locked premium lesson whose comments were readable would leak the content
 * through the discussion of it.
 */
async function readableLesson(userId, lessonId) {
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    select: {
      id: true, title: true, type: true, status: true, accessType: true,
      isFreePreview: true, commentsEnabled: true,
      lessonPlans: { select: { planId: true } },
      chapter: { select: { courseId: true, courseType: { select: { courseId: true } } } },
    },
  });
  if (!lesson || lesson.status !== 'published') {
    return { error: { status: 404, message: 'Lesson not found' } };
  }

  const courseId = lesson.chapter.courseId ?? lesson.chapter.courseType?.courseId ?? null;
  const activeSubs = courseId === null ? [] : await prisma.subscription.findMany({
    where: { userId, courseId, isActive: true, endDate: { gte: new Date() } },
    select: { planId: true },
  });

  if (!isLessonUnlocked(lesson, new Set(activeSubs.map((s) => s.planId)))) {
    return { error: { status: 403, message: 'This lesson is locked. Subscribe to join the discussion.' } };
  }
  return { lesson };
}


// GET /api/users/me/lessons/:lessonId/comments?page=1&limit=20
//
// Top-level comments are paginated; their replies come with them. Paginating
// replies too would mean a request per thread on a screen that is mostly
// scrolling.
async function listComments(req, res) {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }
    const userId = req.user.userId;

    const { lesson, error } = await readableLesson(userId, lessonId);
    if (error) return res.status(error.status).json({ error: { message: error.message } });

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

    const where = { lessonId, parentId: null, status: 'published' };

    const [roots, total] = await Promise.all([
      prisma.lessonComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { ...COMMENT_SELECT, userId: true },
      }),
      prisma.lessonComment.count({ where }),
    ]);

    const rootIds = roots.map((c) => c.id);
    // Replies read oldest-first: a thread is a conversation and reads forwards,
    // even though the threads themselves are newest-first.
    const replies = rootIds.length === 0 ? [] : await prisma.lessonComment.findMany({
      where: { parentId: { in: rootIds }, status: 'published' },
      orderBy: { createdAt: 'asc' },
      select: { ...COMMENT_SELECT, userId: true },
    });

    const visibleIds = [...rootIds, ...replies.map((r) => r.id)];
    const reportedIds = new Set(
      (visibleIds.length === 0 ? [] : await prisma.commentReport.findMany({
        where: { userId, commentId: { in: visibleIds } },
        select: { commentId: true },
      })).map((r) => r.commentId),
    );

    const byId = new Map(roots.map((c) => [c.id, shapeComment(c, userId, reportedIds)]));
    for (const reply of replies) {
      byId.get(reply.parentId)?.replies.push(shapeComment(reply, userId, reportedIds));
    }

    // Every comment in the lesson, replies included — the "12 comments" label.
    const totalWithReplies = await prisma.lessonComment.count({
      where: { lessonId, status: 'published' },
    });

    return res.status(200).json({
      lesson: { id: lesson.id, title: lesson.title, type: lesson.type },
      // False means the thread is read-only: render the comments, hide the box.
      commentsEnabled: lesson.commentsEnabled,
      totalComments: totalWithReplies,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      comments: [...byId.values()],
    });
  } catch (error) {
    console.error('listComments error:', error);
    return res.status(500).json({ error: { message: 'Failed to load comments' } });
  }
}


// POST /api/users/me/lessons/:lessonId/comments   { body, parentId? }
async function createComment(req, res) {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }
    const userId = req.user.userId;

    const { lesson, error } = await readableLesson(userId, lessonId);
    if (error) return res.status(error.status).json({ error: { message: error.message } });

    if (!lesson.commentsEnabled) {
      return res.status(409).json({ error: { message: 'Commenting is turned off for this lesson' } });
    }

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (body === '') {
      return res.status(400).json({ error: { message: 'Write something first' } });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({ error: { message: `Comments are limited to ${MAX_BODY} characters` } });
    }

    let parentId = null;
    if (req.body?.parentId !== undefined && req.body.parentId !== null) {
      const requested = Number(req.body.parentId);
      if (!Number.isInteger(requested)) {
        return res.status(400).json({ error: { message: 'parentId must be an integer' } });
      }
      const parent = await prisma.lessonComment.findUnique({
        where: { id: requested },
        select: { id: true, lessonId: true, parentId: true, status: true },
      });
      if (!parent || parent.lessonId !== lessonId || parent.status !== 'published') {
        return res.status(404).json({ error: { message: 'That comment is no longer available' } });
      }
      parentId = threadRootId(parent);
    }

    const created = await prisma.lessonComment.create({
      data: { lessonId, userId, parentId, body },
      select: { ...COMMENT_SELECT, userId: true },
    });

    return res.status(201).json({
      comment: shapeComment(created, userId, new Set()),
      // Echoed because it may differ from what was sent, when a reply to a
      // reply was re-parented. Place the new comment using THIS value.
      parentId,
    });
  } catch (error) {
    console.error('createComment error:', error);
    return res.status(500).json({ error: { message: 'Failed to post the comment' } });
  }
}


/** A comment this student may still act on. Hidden ones are gone to them. */
async function ownComment(userId, commentId) {
  if (!Number.isInteger(commentId)) {
    return { error: { status: 400, message: 'Invalid comment id' } };
  }
  const comment = await prisma.lessonComment.findUnique({
    where: { id: commentId },
    select: { id: true, userId: true, status: true, lessonId: true, parentId: true },
  });
  // A hidden comment is 404, not 403: it is gone from the student's view, and
  // saying "you may not edit that" would confirm it is still there.
  if (!comment || comment.status !== 'published') {
    return { error: { status: 404, message: 'Comment not found' } };
  }
  if (comment.userId !== userId) {
    return { error: { status: 403, message: 'You can only change your own comments' } };
  }
  return { comment };
}


// PATCH /api/users/me/comments/:commentId   { body }
async function updateComment(req, res) {
  try {
    const userId = req.user.userId;
    const { comment, error } = await ownComment(userId, Number(req.params.commentId));
    if (error) return res.status(error.status).json({ error: { message: error.message } });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (body === '') {
      return res.status(400).json({ error: { message: 'Write something first' } });
    }
    if (body.length > MAX_BODY) {
      return res.status(400).json({ error: { message: `Comments are limited to ${MAX_BODY} characters` } });
    }

    const updated = await prisma.lessonComment.update({
      where: { id: comment.id },
      data: { body, editedAt: new Date() },
      select: { ...COMMENT_SELECT, userId: true },
    });

    return res.status(200).json({ comment: shapeComment(updated, userId, new Set()) });
  } catch (error) {
    console.error('updateComment error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the comment' } });
  }
}


// DELETE /api/users/me/comments/:commentId
async function deleteComment(req, res) {
  try {
    const userId = req.user.userId;
    const { comment, error } = await ownComment(userId, Number(req.params.commentId));
    if (error) return res.status(error.status).json({ error: { message: error.message } });

    // Counted before the cascade, so the response can say what actually went.
    const replyCount = comment.parentId === null
      ? await prisma.lessonComment.count({ where: { parentId: comment.id } })
      : 0;

    await prisma.lessonComment.delete({ where: { id: comment.id } });

    return res.status(200).json({
      message: replyCount > 0
        ? `Comment deleted, along with ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}.`
        : 'Comment deleted.',
      commentId: comment.id,
      deletedReplies: replyCount,
    });
  } catch (error) {
    console.error('deleteComment error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the comment' } });
  }
}


// POST /api/users/me/comments/:commentId/report   { reason? }
async function reportComment(req, res) {
  try {
    const userId = req.user.userId;
    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId)) {
      return res.status(400).json({ error: { message: 'Invalid comment id' } });
    }

    const comment = await prisma.lessonComment.findUnique({
      where: { id: commentId },
      select: { id: true, userId: true, status: true },
    });
    if (!comment || comment.status !== 'published') {
      return res.status(404).json({ error: { message: 'Comment not found' } });
    }
    if (comment.userId === userId) {
      return res.status(400).json({ error: { message: 'You cannot report your own comment' } });
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 500) : null;

    // Upsert, so a second tap is not an error the student has to understand.
    // The unique index is what stops one person filing ten reports.
    await prisma.commentReport.upsert({
      where: { commentId_userId: { commentId, userId } },
      create: { commentId, userId, reason: reason || null },
      update: { reason: reason || undefined },
    });

    // Deliberately still visible. It goes to the moderation queue; it does not
    // vanish because one person objected.
    return res.status(200).json({
      message: 'Reported. A moderator will review it.',
      commentId,
      reported: true,
    });
  } catch (error) {
    console.error('reportComment error:', error);
    return res.status(500).json({ error: { message: 'Failed to report the comment' } });
  }
}


module.exports = {
  listComments, createComment, updateComment, deleteComment, reportComment,
  // Exported for comment.test.js — pure, no DB.
  shapeComment, threadRootId,
};
