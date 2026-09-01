// Comment moderation.
//
// The queue is the point of this file. A moderator's question is never "show
// me all comments" — it is "what needs me?", and that is `status=reported`:
// comments still visible to students with an unresolved report against them.
const { PrismaClient } = require('../generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const STATUSES = ['all', 'published', 'hidden', 'reported'];

/**
 * A lesson belongs to a course either directly through its chapter or through
 * the chapter's course type — both columns are nullable and both are in use,
 * so filtering by course has to accept either path.
 */
function courseFilter(courseId) {
  return {
    lesson: {
      chapter: {
        OR: [{ courseId }, { courseType: { courseId } }],
      },
    },
  };
}


// GET /api/admin/comments?status=&lessonId=&courseId=&search=&page=&limit=
async function listComments(req, res) {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);

    const status = req.query.status ?? 'all';
    if (!STATUSES.includes(status)) {
      return res.status(400).json({ error: { message: `status must be one of: ${STATUSES.join(', ')}` } });
    }

    const where = {};

    if (status === 'published' || status === 'hidden') where.status = status;
    if (status === 'reported') {
      // Still published AND still complained about. A hidden comment has been
      // dealt with; a resolved report has been dismissed. Neither needs a
      // moderator, and leaving them here is how a queue stops being read.
      where.status = 'published';
      where.reports = { some: { resolvedAt: null } };
    }

    if (req.query.lessonId !== undefined) {
      const lessonId = Number(req.query.lessonId);
      if (!Number.isInteger(lessonId)) {
        return res.status(400).json({ error: { message: 'lessonId must be an integer' } });
      }
      where.lessonId = lessonId;
    }

    if (req.query.courseId !== undefined) {
      const courseId = Number(req.query.courseId);
      if (!Number.isInteger(courseId)) {
        return res.status(400).json({ error: { message: 'courseId must be an integer' } });
      }
      Object.assign(where, courseFilter(courseId));
    }

    const search = (req.query.search ?? '').trim();
    if (search !== '') {
      // Body or author name. A moderator chasing a complaint has one of the
      // two and should not have to know which field to search.
      where.OR = [
        { body: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const [comments, total] = await Promise.all([
      prisma.lessonComment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, parentId: true, body: true, status: true,
          createdAt: true, editedAt: true,
          user: { select: { id: true, name: true, email: true, avatarUrl: true } },
          lesson: {
            select: {
              id: true, title: true, type: true, commentsEnabled: true,
              chapter: {
                select: {
                  id: true, title: true,
                  course: { select: { id: true, title: true } },
                  courseType: { select: { id: true, title: true, course: { select: { id: true, title: true } } } },
                },
              },
            },
          },
          reports: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true, reason: true, createdAt: true, resolvedAt: true,
              user: { select: { id: true, name: true } },
            },
          },
          _count: { select: { replies: true } },
        },
      }),
      prisma.lessonComment.count({ where }),
    ]);

    // One query per tab label, not one per row. The moderator needs to see
    // that 3 things are waiting without opening the tab.
    const [publishedCount, hiddenCount, reportedCount] = await Promise.all([
      prisma.lessonComment.count({ where: { status: 'published' } }),
      prisma.lessonComment.count({ where: { status: 'hidden' } }),
      prisma.lessonComment.count({
        where: { status: 'published', reports: { some: { resolvedAt: null } } },
      }),
    ]);

    return res.status(200).json({
      counts: {
        all: publishedCount + hiddenCount,
        published: publishedCount,
        hidden: hiddenCount,
        reported: reportedCount,
      },
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      comments: comments.map(({ _count, reports, lesson, ...rest }) => {
        const open = reports.filter((r) => r.resolvedAt === null);
        const { chapter, ...lessonRest } = lesson;
        return {
          ...rest,
          isReply: rest.parentId !== null,
          replyCount: _count.replies,
          lesson: {
            ...lessonRest,
            chapter: { id: chapter.id, title: chapter.title },
            // Either path to the course; the panel should not have to know
            // which of the two nullable columns this chapter used.
            course: chapter.course ?? chapter.courseType?.course ?? null,
            courseType: chapter.courseType
              ? { id: chapter.courseType.id, title: chapter.courseType.title }
              : null,
          },
          reportCount: reports.length,
          openReportCount: open.length,
          // Above zero and status published is exactly the queue condition.
          needsReview: open.length > 0 && rest.status === 'published',
          reports,
        };
      }),
    });
  } catch (error) {
    console.error('admin listComments error:', error);
    return res.status(500).json({ error: { message: 'Failed to load comments' } });
  }
}


// PATCH /api/admin/comments/:commentId   { status: "hidden" | "published" }
async function setCommentStatus(req, res) {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId)) {
      return res.status(400).json({ error: { message: 'Invalid comment id' } });
    }

    const status = req.body?.status;
    if (status !== 'hidden' && status !== 'published') {
      return res.status(400).json({ error: { message: 'status must be "hidden" or "published"' } });
    }

    const comment = await prisma.lessonComment.findUnique({
      where: { id: commentId },
      select: { id: true, parentId: true, _count: { select: { replies: true } } },
    });
    if (!comment) return res.status(404).json({ error: { message: 'Comment not found' } });

    const replyIds = comment.parentId !== null ? [] :
      (await prisma.lessonComment.findMany({
        where: { parentId: commentId }, select: { id: true },
      })).map((r) => r.id);

    const [updated] = await prisma.$transaction([
      prisma.lessonComment.update({
        where: { id: commentId }, data: { status },
        select: { id: true, status: true, body: true },
      }),
      // Replies follow the parent. Hiding an abusive comment while leaving
      // five replies quoting it behind achieves nothing.
      prisma.lessonComment.updateMany({
        where: { id: { in: replyIds } }, data: { status },
      }),
      // Either decision IS acting on the report — hiding agrees with it,
      // restoring overrules it — so both close it. Leaving reports open would
      // keep the comment in the queue forever, and a queue that never empties
      // stops being read.
      prisma.commentReport.updateMany({
        where: { commentId, resolvedAt: null },
        data: { resolvedAt: new Date() },
      }),
    ]);

    return res.status(200).json({
      comment: updated,
      affectedReplies: replyIds.length,
      message: status === 'hidden'
        ? `Hidden${replyIds.length ? ` along with ${replyIds.length} repl${replyIds.length === 1 ? 'y' : 'ies'}` : ''}. Students can no longer see it.`
        : `Restored${replyIds.length ? ` along with ${replyIds.length} repl${replyIds.length === 1 ? 'y' : 'ies'}` : ''}.`,
    });
  } catch (error) {
    console.error('setCommentStatus error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the comment' } });
  }
}


// POST /api/admin/comments/:commentId/dismiss-reports
//
// "I looked, it is fine." Without this the only way out of the queue is to
// hide something that did not deserve it.
async function dismissReports(req, res) {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId)) {
      return res.status(400).json({ error: { message: 'Invalid comment id' } });
    }

    const comment = await prisma.lessonComment.findUnique({
      where: { id: commentId }, select: { id: true },
    });
    if (!comment) return res.status(404).json({ error: { message: 'Comment not found' } });

    const { count } = await prisma.commentReport.updateMany({
      where: { commentId, resolvedAt: null },
      data: { resolvedAt: new Date() },
    });

    return res.status(200).json({
      message: count === 0 ? 'No open reports on this comment.' : `Dismissed ${count} report(s). The comment stays visible.`,
      commentId,
      dismissed: count,
    });
  } catch (error) {
    console.error('dismissReports error:', error);
    return res.status(500).json({ error: { message: 'Failed to dismiss the reports' } });
  }
}


// DELETE /api/admin/comments/:commentId
async function deleteComment(req, res) {
  try {
    const commentId = Number(req.params.commentId);
    if (!Number.isInteger(commentId)) {
      return res.status(400).json({ error: { message: 'Invalid comment id' } });
    }

    const comment = await prisma.lessonComment.findUnique({
      where: { id: commentId },
      select: { id: true, parentId: true, _count: { select: { replies: true } } },
    });
    if (!comment) return res.status(404).json({ error: { message: 'Comment not found' } });

    const replyCount = comment._count.replies;
    await prisma.lessonComment.delete({ where: { id: commentId } });

    return res.status(200).json({
      message: replyCount > 0
        ? `Deleted permanently, along with ${replyCount} repl${replyCount === 1 ? 'y' : 'ies'}.`
        : 'Deleted permanently.',
      commentId,
      deletedReplies: replyCount,
    });
  } catch (error) {
    console.error('admin deleteComment error:', error);
    return res.status(500).json({ error: { message: 'Failed to delete the comment' } });
  }
}


// PATCH /api/admin/lessons/:lessonId/comments   { enabled: boolean }
async function setLessonComments(req, res) {
  try {
    const lessonId = Number(req.params.lessonId);
    if (!Number.isInteger(lessonId)) {
      return res.status(400).json({ error: { message: 'Invalid lesson id' } });
    }
    if (typeof req.body?.enabled !== 'boolean') {
      return res.status(400).json({ error: { message: 'enabled must be true or false' } });
    }

    const lesson = await prisma.lesson.findUnique({ where: { id: lessonId }, select: { id: true } });
    if (!lesson) return res.status(404).json({ error: { message: 'Lesson not found' } });

    const updated = await prisma.lesson.update({
      where: { id: lessonId },
      data: { commentsEnabled: req.body.enabled },
      select: { id: true, title: true, commentsEnabled: true },
    });

    const existing = await prisma.lessonComment.count({ where: { lessonId, status: 'published' } });

    return res.status(200).json({
      lesson: updated,
      existingComments: existing,
      // Turning a discussion off is not the same as erasing it. Say so, so
      // nobody reaches for Delete expecting this to have done it.
      message: req.body.enabled
        ? 'Commenting is on for this lesson.'
        : `Commenting is off. ${existing} existing comment(s) stay visible — hide or delete them individually if that is not what you want.`,
    });
  } catch (error) {
    console.error('setLessonComments error:', error);
    return res.status(500).json({ error: { message: 'Failed to update the lesson' } });
  }
}


module.exports = {
  listComments, setCommentStatus, dismissReports, deleteComment, setLessonComments,
  courseFilter,
};
