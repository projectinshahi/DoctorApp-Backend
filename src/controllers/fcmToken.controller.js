// Device registration for push notifications.
//
// The student is always taken from their auth token, never from the URL. With
// an id in the path, anyone could register their own phone against another
// student's account and receive that student's notifications.
const prisma = require('../db');

// Registration tokens are around 160 characters; the cap only stops something
// absurd being stored.
const MAX_TOKEN_LENGTH = 4096;
const PLATFORMS = ['android', 'ios'];

// POST /api/users/me/fcm-token   { token, platform? }
async function registerFcmToken(req, res) {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    if (token === '') {
      return res.status(400).json({ error: { message: 'token is required' } });
    }
    if (token.length > MAX_TOKEN_LENGTH) {
      return res.status(400).json({ error: { message: 'token is too long to be a registration token' } });
    }

    let platform;
    if (req.body?.platform !== undefined && req.body.platform !== null) {
      platform = String(req.body.platform).trim().toLowerCase();
      if (!PLATFORMS.includes(platform)) {
        return res.status(400).json({ error: { message: `platform must be one of: ${PLATFORMS.join(', ')}` } });
      }
    }

    // Keyed on the token, not on (student, token). A registration token
    // belongs to an app install rather than a person, so when a phone changes
    // hands the row moves to whoever signed in — otherwise the previous
    // student's notifications keep arriving on a phone they no longer own.
    const saved = await prisma.fcmToken.upsert({
      where: { token },
      create: { token, userId: req.user.userId, platform: platform ?? null },
      update: { userId: req.user.userId, ...(platform ? { platform } : {}) },
      select: { platform: true, updatedAt: true },
    });

    // Safe to call on every launch: re-sending the same token just refreshes
    // updatedAt, so the app never has to remember whether it registered.
    return res.status(200).json({
      registered: true,
      platform: saved.platform,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    console.error('registerFcmToken error:', error);
    return res.status(500).json({ error: { message: 'Failed to register the device' } });
  }
}

// DELETE /api/users/me/fcm-token?token=...   (or { token } in the body)
//
// Called on logout. Without it, the next person to use a shared phone keeps
// receiving the previous student's notifications.
//
// The query parameter is accepted because dr_app's ApiClient.delete() sends no
// body, and giving every other DELETE in the app a body to carry this one call
// is the wrong trade.
async function deleteFcmToken(req, res) {
  try {
    const raw = req.body?.token ?? req.query?.token;
    const token = typeof raw === 'string' ? raw.trim() : '';
    if (token === '') {
      return res.status(400).json({ error: { message: 'token is required' } });
    }

    // Scoped to this student, so one account cannot unregister another's
    // device by guessing its token.
    const { count } = await prisma.fcmToken.deleteMany({
      where: { token, userId: req.user.userId },
    });

    // Not a 404 when nothing matched: logging out twice, or on a device that
    // never registered, is not an error the app should have to handle.
    return res.status(200).json({ removed: count > 0 });
  } catch (error) {
    console.error('deleteFcmToken error:', error);
    return res.status(500).json({ error: { message: 'Failed to remove the device' } });
  }
}

module.exports = { registerFcmToken, deleteFcmToken };
