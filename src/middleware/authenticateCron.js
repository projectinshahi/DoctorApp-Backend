const jwt = require('jsonwebtoken');

/**
 * Lets either an admin or the scheduler through.
 *
 * The scheduler has no login, so it carries a shared secret in a header. Admin
 * tokens still work, so the endpoint can be triggered by hand from the panel
 * when someone wants the reminders out now.
 */
function authenticateCron(req, res, next) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers['x-cron-key'];

  // Only when the secret is configured: an unset CRON_SECRET must not turn
  // into "anyone with no header may call this".
  if (secret && typeof supplied === 'string' && supplied === secret) {
    req.caller = 'scheduler';
    return next();
  }

  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(header.split(' ')[1], process.env.ADMIN_JWT_SECRET);
      if (decoded.role === 'admin') {
        req.admin = decoded;
        req.caller = 'admin';
        return next();
      }
    } catch {
      // falls through to the 401 below
    }
  }

  return res.status(401).json({
    error: { code: 'UNAUTHORIZED', message: 'Admin token or scheduler key required', status: 401 },
  });
}

module.exports = authenticateCron;
