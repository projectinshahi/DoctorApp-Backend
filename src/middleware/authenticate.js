const { verifyAccessToken } = require('../services/auth.service');

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Missing or invalid authorization header', status: 401 },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = verifyAccessToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      error: { message: 'Invalid or expired token', status: 401 },
    });
  }
}

module.exports = authenticate;