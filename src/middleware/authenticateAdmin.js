const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET;

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { message: 'Missing or invalid authorization header', status: 401 },
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.role !== 'admin') {
      return res.status(403).json({
        error: { message: 'Admin access required', status: 403 },
      });
    }

    req.admin = decoded; // { adminId, role, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({
      error: { message: 'Invalid or expired token', status: 401 },
    });
  }
}

module.exports = authenticateAdmin;