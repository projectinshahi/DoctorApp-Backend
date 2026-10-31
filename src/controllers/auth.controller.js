// const crypto = require('crypto');
// const { PrismaClient } = require('../generated/prisma');
// const { PrismaPg } = require('@prisma/adapter-pg');
// const {
//   verifyGoogleToken,
//   generateAccessToken,
//   generateRefreshToken,
// } = require('../services/auth.service');

// const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
// const prisma = new PrismaClient({ adapter });

// async function googleSignIn(req, res, next) {
//   try {
//     const { idToken, deviceId } = req.body;

//     if (!idToken) {
//       return res.status(400).json({
//         error: { message: 'idToken is required', status: 400 },
//       });
//     }

//     if (!deviceId) {
//       return res.status(400).json({
//         error: { message: 'deviceId is required', status: 400 },
//       });
//     }

//     const googleUser = await verifyGoogleToken(idToken);

//     let user = await prisma.user.findUnique({
//       where: { email: googleUser.email },
//     });

//     let isNewUser = false;

//     if (!user) {
//       user = await prisma.user.create({
//         data: {
//           email: googleUser.email,
//           name: googleUser.name,
//           status: 'verified',
//           password: null,
//         },
//       });
//       isNewUser = true;
//     }

//     // Revoke any existing active session(s) for this user (single-active-session rule)
//     await prisma.session.updateMany({
//       where: {
//         userId: user.id,
//         revokedAt: null,
//       },
//       data: {
//         revokedAt: new Date(),
//       },
//     });

//     // Create the new session with a temporary unique placeholder token
//     const session = await prisma.session.create({
//       data: {
//         userId: user.id,
//         deviceId: deviceId,
//         refreshToken: crypto.randomUUID(), // temporary unique value, replaced below
//       },
//     });

//     // Now generate the real tokens, embedding the session's id
//     const accessToken = generateAccessToken({
//       userId: user.id,
//       role: user.role,
//       sessionId: session.id,
//     });
//     const refreshToken = generateRefreshToken({
//       userId: user.id,
//       sessionId: session.id,
//     });

//     // Update the session with the real refresh token
//     await prisma.session.update({
//       where: { id: session.id },
//       data: { refreshToken: refreshToken },
//     });

//     res.status(200).json({
//       accessToken,
//       refreshToken,
//       isNewUser,
//       sessionId: session.id,
//       user: {
//         id: user.id,
//         email: user.email,
//         name: user.name,
//         role: user.role,
//       },
//     });
//   } catch (err) {
//     console.error(err);
//     return res.status(401).json({
//       error: { message: 'Invalid or expired Google token', status: 401 },
//     });
//   }
// }

// module.exports = { googleSignIn };

const crypto = require('crypto');
const {
  verifyGoogleToken,
  verifyAppleToken,
  hashPassword,
  comparePassword,
  generateEmailToken,
  verifyEmailToken,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
} = require('../services/auth.service');
const { revokeActiveSessions, revokeSession } = require('../services/session.service');
const { sendVerificationEmail } = require('../services/email.service');

const prisma = require('../db');

/**
 * Whether this login may proceed, and what to say either way.
 *
 * The policy is FIRST DEVICE WINS: while an account is genuinely in use on one
 * device, a second is refused rather than taking it over. That is the opposite
 * of the usual rule and it is chosen deliberately — the point is to stop one
 * subscription being shared, and a policy that hands the account to whoever
 * logged in most recently does not stop that at all, it just alternates.
 *
 * The danger with it is locking a student out of their own account: a lost
 * phone, a reinstall that regenerates the device id, an app killed without
 * logging out. So a session only holds the lock while it is being USED. Once
 * it has gone quiet for IDLE_RELEASE_MS the next device may take it, which
 * covers every one of those cases without anyone contacting support.
 */
const IDLE_RELEASE_MS = 30 * 60 * 1000;

function decideLogin(previous, deviceId, now = Date.now()) {
  if (!previous) {
    return { allow: true, reason: 'first', previousSession: null, notice: null };
  }

  const sameDevice = previous.deviceId === deviceId;
  if (sameDevice) {
    // The same device signing in again is not a takeover, whatever the clock
    // says. Refusing here would lock a student out with their own phone in
    // their hand.
    return {
      allow: true,
      reason: 'sameDevice',
      previousSession: { deviceId: previous.deviceId, signedInAt: previous.createdAt, sameDevice: true },
      notice: null,
    };
  }

  // A session that has never reported activity is treated as last seen when it
  // was created, so an old row cannot hold the lock for ever.
  const lastSeen = (previous.lastSeenAt ?? previous.createdAt).getTime();
  const idleMs = now - lastSeen;

  if (idleMs >= IDLE_RELEASE_MS) {
    return {
      allow: true,
      reason: 'idleReleased',
      previousSession: {
        deviceId: previous.deviceId, signedInAt: previous.createdAt,
        lastSeenAt: previous.lastSeenAt ?? previous.createdAt, sameDevice: false,
      },
      notice: "Your other device had been inactive, so it has been signed out.",
    };
  }

  return {
    allow: false,
    reason: 'activeElsewhere',
    previousSession: {
      deviceId: previous.deviceId, signedInAt: previous.createdAt,
      lastSeenAt: previous.lastSeenAt ?? previous.createdAt, sameDevice: false,
    },
    // Rounded up, so "0 minutes" is never shown for a session seen seconds ago.
    retryAfterMinutes: Math.max(1, Math.ceil((IDLE_RELEASE_MS - idleMs) / 60000)),
    notice: null,
  };
}


// Everything after "who is this?" is the same for every way of signing in:
// the device lock, the session row and the tokens.
async function startSession(res, user, deviceId, isNewUser) {
  // First device wins: an account in active use on one device refuses a
  // second, rather than the second taking it over.
  const previous = await prisma.session.findFirst({
    where: { userId: user.id, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: { deviceId: true, createdAt: true, lastSeenAt: true },
  });
  const decision = decideLogin(previous, deviceId);

  if (!decision.allow) {
    return res.status(409).json({
      error: {
        code: 'SESSION_ACTIVE_ELSEWHERE',
        message: 'This account is signed in on another device. Sign out there first, or try again in a few minutes.',
        status: 409,
      },
      previousSession: decision.previousSession,
      // How long until the other session goes idle and the lock is released,
      // so the app can say "try again in 12 minutes" instead of "try later".
      retryAfterMinutes: decision.retryAfterMinutes,
    });
  }

  // Allowed. Anything still open is now released — including the idle
  // session this login is taking over from.
  await revokeActiveSessions(user.id);

  // Create the new session with a temporary unique placeholder token
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      deviceId: deviceId,
      refreshToken: crypto.randomUUID(),
    },
  });

  // Now generate the real tokens, embedding the session's id
  const accessToken = generateAccessToken({
    userId: user.id,
    role: user.role,
    sessionId: session.id,
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    sessionId: session.id,
  });

  // Update the session with the real refresh token
  await prisma.session.update({
    where: { id: session.id },
    data: { refreshToken: refreshToken },
  });

  res.status(200).json({
    accessToken,
    refreshToken,
    isNewUser,
    sessionId: session.id,
    // notice — ready to show as-is, non-null only when an idle device was
    // released to let this login through. previousSession.sameDevice lets
    // the client check against its own stored deviceId.
    notice: decision.notice,
    previousSession: decision.previousSession,
    signedOutOtherDevice: decision.reason === 'idleReleased',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}

// One handler per provider; everything after the token check is shared.
// `verify` turns the provider's idToken into { email, name }.
function signInWith(verify, provider) {
  return async function (req, res) {
  try {
    const { idToken, deviceId } = req.body;

    if (!idToken) {
      return res.status(400).json({
        error: { message: 'idToken is required', status: 400 },
      });
    }

    if (!deviceId) {
      return res.status(400).json({
        error: { message: 'deviceId is required', status: 400 },
      });
    }

    const profile = await verify(idToken);
    if (!profile.email) {
      return res.status(400).json({
        error: { message: `${provider} did not share an email address`, status: 400 },
      });
    }

    let user = await prisma.user.findUnique({
      where: { email: profile.email },
    });

    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          email: profile.email,
          // Apple puts no name in its token and gives it to the app only on
          // the very first sign-in, so the app forwards it in the body.
          name: profile.name || req.body.name || null,
          status: 'verified',
          password: null,
        },
      });
      isNewUser = true;
    } else if (user.status === 'unverified') {
      // Google or Apple has just proved this person owns the address, so it
      // is verified. The password goes: whoever registered it never proved
      // the address, and may not be this person — keeping it would let them
      // into the account the real owner is about to fill.
      user = await prisma.user.update({
        where: { id: user.id },
        data: { status: 'verified', password: null },
      });
    }

    // Without this, a blocked student could simply sign in again and get a
    // fresh session, making the admin block button useless.
    if (user.status === 'blocked') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_BLOCKED',
          message: 'Your account has been blocked. Please contact support.',
          status: 403,
        },
      });
    }

    return await startSession(res, user, deviceId, isNewUser);
  } catch (err) {
    console.error(err);
    return res.status(401).json({
      error: { message: `Invalid or expired ${provider} token`, status: 401 },
    });
  }
  };
}

const googleSignIn = signInWith(verifyGoogleToken, 'Google');
const appleSignIn = signInWith(verifyAppleToken, 'Apple');

// ---- Email and password ----

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

// Lower-cased so "Asha@Gmail.com" and "asha@gmail.com" are one account, as
// they are one inbox.
const normaliseEmail = (email) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

// The link points back at this server, whatever host it is reached on.
// Render terminates HTTPS in front of us, hence x-forwarded-proto.
function verificationLink(req, userId) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}/api/auth/verify-email?token=${generateEmailToken(userId)}`;
}

// POST /api/auth/register  { email, password, name? }
async function register(req, res) {
  try {
    const email = normaliseEmail(req.body.email);
    const { password } = req.body;
    const name = typeof req.body.name === 'string' && req.body.name.trim() ? req.body.name.trim() : null;

    if (!EMAIL_RE.test(email)) {
      return res.status(400).json({
        error: { code: 'INVALID_EMAIL', message: 'Enter a valid email address', status: 400 },
      });
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      return res.status(400).json({
        error: { code: 'WEAK_PASSWORD', message: `Password must be at least ${MIN_PASSWORD} characters`, status: 400 },
      });
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { password: true } });
    if (existing) {
      return res.status(409).json({
        error: {
          code: 'EMAIL_TAKEN',
          // A Google account has no password, so "log in" would not work for it.
          message: existing.password
            ? 'An account with this email already exists. Please log in.'
            : 'This email is already registered with Google. Please sign in with Google.',
          status: 409,
        },
      });
    }

    let user;
    try {
      user = await prisma.user.create({
        data: { email, name, password: await hashPassword(password), status: 'unverified' },
        select: { id: true, email: true, name: true, status: true },
      });
    } catch (err) {
      // Two signups for one address at the same moment: the unique index
      // lets one through, and the other lands here rather than as a 500.
      if (err.code === 'P2002') {
        return res.status(409).json({
          error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists. Please log in.', status: 409 },
        });
      }
      throw err;
    }

    // A failed send does not undo the account: /resend-verification exists
    // for exactly this.
    const emailSent = await sendVerificationEmail(email, verificationLink(req, user.id));

    return res.status(201).json({
      message: 'Account created. Check your email to verify it before logging in.',
      emailSent,
      user,
    });
  } catch (err) {
    console.error('register error:', err);
    return res.status(500).json({ error: { message: 'Could not create the account', status: 500 } });
  }
}

// POST /api/auth/login  { email, password, deviceId }
async function login(req, res) {
  try {
    const email = normaliseEmail(req.body.email);
    const { password, deviceId } = req.body;

    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({
        error: { message: 'email and password are required', status: 400 },
      });
    }
    if (!deviceId) {
      return res.status(400).json({ error: { message: 'deviceId is required', status: 400 } });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    // One answer for "no such account", "Google-only account" and "wrong
    // password", so the endpoint cannot be used to test which emails exist.
    if (!user || !user.password || !(await comparePassword(password, user.password))) {
      return res.status(401).json({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password', status: 401 },
      });
    }

    // Status is only revealed once the password has been proved.
    if (user.status === 'unverified') {
      return res.status(403).json({
        error: {
          code: 'EMAIL_NOT_VERIFIED',
          message: 'Please verify your email before logging in. Check your inbox for the link.',
          status: 403,
        },
      });
    }
    if (user.status === 'blocked') {
      return res.status(403).json({
        error: {
          code: 'ACCOUNT_DEACTIVATED',
          message: 'Your account has been deactivated. Please contact support.',
          status: 403,
        },
      });
    }

    return await startSession(res, user, deviceId, false);
  } catch (err) {
    console.error('login error:', err);
    return res.status(500).json({ error: { message: 'Could not log in', status: 500 } });
  }
}

// A page, not JSON: this is opened from an email, in a browser.
function page(res, status, title, text) {
  return res.status(status).type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${title}</title><body style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">` +
    `<h2>${title}</h2><p>${text}</p></body>`
  );
}

// GET /api/auth/verify-email?token=...
async function verifyEmail(req, res) {
  let userId;
  try {
    ({ userId } = verifyEmailToken(String(req.query.token || '')));
  } catch {
    return page(res, 400, 'Link expired or invalid', 'Request a new verification email from the app and try again.');
  }

  try {
    // Only unverified moves to verified. A blocked account must not be
    // unblocked by an old link, and a second click is harmless.
    await prisma.user.updateMany({ where: { id: userId, status: 'unverified' }, data: { status: 'verified' } });
    return page(res, 200, 'Email verified', 'Your account is ready. Go back to the app and log in.');
  } catch (err) {
    console.error('verifyEmail error:', err);
    return page(res, 500, 'Something went wrong', 'Please try the link again in a moment.');
  }
}

// POST /api/auth/resend-verification  { email }
async function resendVerification(req, res) {
  try {
    const email = normaliseEmail(req.body.email);
    const user = email && await prisma.user.findUnique({
      where: { email },
      select: { id: true, status: true, password: true },
    });
    if (user && user.status === 'unverified' && user.password) {
      await sendVerificationEmail(email, verificationLink(req, user.id));
    }
    // The same reply either way, so this cannot be used to probe for accounts.
    return res.status(200).json({
      message: 'If that account exists and is not yet verified, a new link has been sent.',
    });
  } catch (err) {
    console.error('resendVerification error:', err);
    return res.status(500).json({ error: { message: 'Could not send the email', status: 500 } });
  }
}

// NEW: refresh access token using a valid refresh token
async function refreshAccessToken(req, res) {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        error: { code: 'MISSING_REFRESH_TOKEN', message: 'refreshToken is required', status: 400 },
      });
    }

    // 1. Verify JWT signature/expiry
    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (err) {
      return res.status(401).json({
        error: { code: 'INVALID_REFRESH_TOKEN', message: 'Invalid or expired refresh token', status: 401 },
      });
    }

    // 2. Look up the session
    const session = await prisma.session.findUnique({
      where: { id: decoded.sessionId },
    });

    if (!session) {
      return res.status(401).json({
        error: { code: 'SESSION_NOT_FOUND', message: 'Session not found', status: 401 },
      });
    }

    // 3. Session must not be revoked (kicked out by another device / logged out)
    if (session.revokedAt !== null) {
      return res.status(401).json({
        error: {
          code: 'SESSION_ENDED',
          message: 'You were signed out because your account was accessed on another device.',
          status: 401,
        },
      });
    }

    // 4. The refresh token sent must match the one currently stored for this session
    //    (prevents reuse of an old/rotated-out refresh token)
    if (session.refreshToken !== refreshToken) {
      // Someone is trying to use a stale/stolen refresh token — revoke the session as a precaution
      await revokeSession(session.id);
      return res.status(401).json({
        error: { code: 'REFRESH_TOKEN_REUSED', message: 'Refresh token is no longer valid', status: 401 },
      });
    }

    // 5. Fetch user for role info
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      return res.status(401).json({
        error: { code: 'USER_NOT_FOUND', message: 'User not found', status: 401 },
      });
    }

    // 6. Issue a new access token
    const newAccessToken = generateAccessToken({
      userId: user.id,
      role: user.role,
      sessionId: session.id,
    });

    // 7. Rotate the refresh token too (recommended security practice)
    const newRefreshToken = generateRefreshToken({
      userId: user.id,
      sessionId: session.id,
    });

    await prisma.session.update({
      where: { id: session.id },
      data: { refreshToken: newRefreshToken },
    });

    res.status(200).json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      error: { message: 'Failed to refresh token', status: 500 },
    });
  }
}

// logout controller
async function logout(req, res) {
  try {
    await revokeSession(req.user.sessionId); // req.user comes from authenticateStudent middleware
    res.status(200).json({ message: 'Logged out successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: { message: 'Logout failed', status: 500 } });
  }
}

module.exports = {
  googleSignIn, appleSignIn, refreshAccessToken, logout,
  register, login, verifyEmail, resendVerification,
  // Exported for auth.test.js — pure, no DB.
  decideLogin, IDLE_RELEASE_MS,
};