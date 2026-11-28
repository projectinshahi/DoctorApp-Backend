// services/account.service.js
//
// Permanent deletion of a student account. Shared by the student's own
// DELETE /api/users/me and the admin's DELETE /admin/students/:id, so both
// remove exactly the same rows.

const prisma = require('../db');

// Progress, attempts, saved items, comments, reports, notifications, FCM
// tokens and daily quizzes cascade from the user row. Sessions and
// subscriptions are ON DELETE RESTRICT, so they are deleted first, in the same
// transaction — a failure part way leaves the account untouched rather than
// half-erased. Deleting the sessions also ends any live login at once
// (authenticateStudent looks the session up on every request).
async function deleteUserAccount(userId) {
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId } }),
    prisma.subscription.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
}

module.exports = { deleteUserAccount };
