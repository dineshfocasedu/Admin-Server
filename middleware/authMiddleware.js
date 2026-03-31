const jwt = require('jsonwebtoken');
const User = require('../models/User');

// ─────────────────────────────────────────────
// protect  — verify JWT and attach decoded user to req.user
// ─────────────────────────────────────────────
exports.protect = (req, res, next) => {
  // Support both "Bearer <token>" and raw token headers
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : authHeader;

  if (!token) {
    return res.status(401).json({ message: 'No token provided, access denied' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    console.error('FATAL: JWT_SECRET environment variable is not set');
    return res.status(500).json({ message: 'Server configuration error' });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
    req.user = decoded;
    next();
  } catch (err) {
    // Distinguish expired vs invalid for clearer client-side handling
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expired, please log in again' });
    }
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// ─────────────────────────────────────────────
// requireAdmin — confirm user has isAdmin: true in DB
// Must be used AFTER protect
// ─────────────────────────────────────────────
exports.requireAdmin = async (req, res, next) => {
  try {
    // req.user is set by protect middleware above
    if (!req.user?.userId) {
      return res.status(401).json({ message: 'Not authenticated' });
    }

    const user = await User.findOne({ userId: req.user.userId }).lean();

    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    if (!user.isAdmin) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();
  } catch (error) {
    console.error('requireAdmin error:', error);
    return res.status(500).json({ error: 'Failed to verify admin access' });
  }
};