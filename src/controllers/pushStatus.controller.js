// Answers one question: can THIS server actually send push notifications?
//
// A hosting dashboard's environment cannot be read from outside, so until now
// the only way to find out was to publish a course and read the logs. Three
// rounds of debugging went into guessing at it.
//
// Nothing secret is returned. project_id identifies the Firebase project and
// is already visible in the app's own configuration; the private key is never
// read into the response, only used.
const push = require('../services/push.service');
const prisma = require('../db');

// GET /api/admin/push/status
async function getPushStatus(req, res) {
  try {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    const devices = await prisma.fcmToken.count();

    if (!raw) {
      return res.status(200).json({
        configured: false,
        reason: 'FIREBASE_SERVICE_ACCOUNT is not set on this server',
        fix: 'Add it in the hosting dashboard as the full contents of the Firebase service account JSON file, then redeploy.',
        devices,
      });
    }

    let projectId = null;
    try {
      projectId = JSON.parse(raw).project_id ?? null;
    } catch {
      return res.status(200).json({
        configured: false,
        reason: 'FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON',
        fix: 'Paste the whole file, including the opening and closing braces.',
        devices,
      });
    }

    if (!push._messagingClient()) {
      return res.status(200).json({
        configured: false,
        projectId,
        reason: 'the key is present but Firebase refused to initialise with it',
        fix: 'Usually a mangled private_key: the newlines must survive the paste. Re-copy the file and paste it again.',
        devices,
      });
    }

    // Parsing proves the shape; only Google can say the credentials are
    // accepted. A dry run asks it to validate the message and the key without
    // delivering anything to anyone.
    const result = await push.notifyCoursePublished(
      { id: 0, title: 'Push status check (not delivered)' },
      { dryRun: true },
    );

    if (!result.messageId) {
      return res.status(200).json({
        configured: false,
        projectId,
        reason: `Firebase rejected the key: ${result.reason}`,
        devices,
      });
    }

    return res.status(200).json({
      configured: true,
      projectId,
      validated: true,
      devices,
      note: devices === 0
        ? 'Sending works, but no device has registered yet, so student-targeted notifications reach nobody.'
        : undefined,
    });
  } catch (error) {
    console.error('getPushStatus error:', error);
    return res.status(500).json({ error: { message: 'Failed to read the push status' } });
  }
}

module.exports = { getPushStatus };
