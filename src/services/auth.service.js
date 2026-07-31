const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { OAuth2Client } = require('google-auth-library');

const ACCESS_TOKEN_EXPIRY='15m';
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

module.exports = {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  verifyGoogleToken,
};


