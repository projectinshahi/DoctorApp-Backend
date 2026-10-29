const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const ACCESS_TOKEN_EXPIRY='1d';
//'15m';
const REFRESH_TOKEN_EXPIRY = '7d';
const SALT_ROUNDS = 12;
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);



function hashPassword(PlaninPassword){

    return bcrypt.hash(PlaninPassword, SALT_ROUNDS);

}

function comparePassword(PlaninPassword, hashPassword){

    return bcrypt.compare(PlaninPassword, hashPassword);
}

function generateAccessToken(payload) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRY,
  });
}


function generateRefreshToken(payload) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRY,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}


async function verifyGoogleToken(idToken) {
  const ticket = await googleClient.verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  return {
    email: payload.email,
    name: payload.name,
    googleId: payload.sub,
  };
}

// Apple signs its identity tokens with one of the keys published here. The
// token's header says which (kid); we fetch the set per sign-in, which is
// rare enough not to need a cache.
async function verifyAppleToken(idToken) {
  const { header } = jwt.decode(idToken, { complete: true }) || {};
  if (!header?.kid) throw new Error('Malformed Apple token');

  const res = await fetch('https://appleid.apple.com/auth/keys');
  if (!res.ok) throw new Error(`Apple keys request failed: ${res.status}`);
  const { keys } = await res.json();
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Apple signing key not found');

  const payload = jwt.verify(idToken, crypto.createPublicKey({ key: jwk, format: 'jwk' }), {
    algorithms: ['RS256'],
    issuer: 'https://appleid.apple.com',
    // The iOS app's bundle id. Comma-separate to also accept a web Service ID.
    audience: process.env.APPLE_CLIENT_ID.split(',').map((s) => s.trim()),
  });
  return { email: payload.email, name: null, appleId: payload.sub };
}

module.exports = {
  verifyAppleToken,
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyGoogleToken,
};


