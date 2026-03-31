require("dotenv").config();
const User = require("../models/User");
const Session = require("../models/Session");
const Question = require("../models/Question");
const QueryUsage = require("../models/QueryUsage");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

const DAILY_QUERY_LIMIT = 7;
const MONTHLY_QUERY_LIMIT = 70;

// ─────────────────────────────────────────────
// ADMIN LOGIN
// POST /api/admin/login
// ─────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Validate inputs
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: "Missing credentials",
        message: "Email and password are required",
      });
    }

    // 2. Guard: fail fast if JWT_SECRET is missing (common Vercel misconfiguration)
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("FATAL: JWT_SECRET environment variable is not set");
      return res.status(500).json({
        success: false,
        error: "Server configuration error",
        message: "JWT_SECRET is not configured on the server.",
      });
    }

    // 3. Check credentials against env vars (with safe fallbacks)
    const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@focas.com").toLowerCase().trim();
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

    if (email.toLowerCase().trim() !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      return res.status(401).json({
        success: false,
        error: "Authentication failed",
        message: "Invalid admin credentials",
      });
    }

    // 4. Find or create the admin user in DB
    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (!user) {
      user = new User({
        userId: uuidv4(),
        email: email.toLowerCase().trim(),
        name: "Admin User",
        isAdmin: true,
        profileCompleted: true,
        createdAt: new Date(),
      });
      await user.save();
      console.log("Admin user created:", user.email);
    } else if (!user.isAdmin) {
      user.isAdmin = true;
      await user.save();
      console.log("User promoted to admin:", user.email);
    }

    // 5. Update lastLogin
    user.lastLogin = new Date();
    await user.save();

    // 6. Sign JWT
    const token = jwt.sign(
      { userId: user.userId, email: user.email, isAdmin: true },
      jwtSecret,
      { expiresIn: "20d" }
    );

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      data: {
        token,
        user: {
          userId: user.userId,
          name: user.name,
          email: user.email,
          isAdmin: user.isAdmin,
        },
      },
    });
  } catch (error) {
    console.error("Admin login error:", error);
    return res.status(500).json({
      success: false,
      error: "Login failed",
      message: "Internal server error occurred during login",
    });
  }
};

// ─────────────────────────────────────────────
// GET ALL USERS
// GET /api/admin/users
// ─────────────────────────────────────────────
exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find(
      {},
      {
        userId: 1,
        name: 1,
        phoneNumber: 1,
        city: 1,
        caLevel: 1,
        examDate: 1,
        createdAt: 1,
      }
    ).sort({ examDate: 1 });

    return res.status(200).json({
      success: true,
      message: users.length ? "Users retrieved successfully" : "No users found",
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error("Error in getAllUsers:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve users",
      message: "Internal server error occurred while fetching users",
    });
  }
};

// ─────────────────────────────────────────────
// GET USERS BY EXAM DATE RANGE
// GET /api/admin/users/exam-range?startDate=&endDate=
// ─────────────────────────────────────────────
exports.getUsersByExamDateRange = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({
        success: false,
        error: "Missing date parameters",
        message: "Both startDate and endDate are required (YYYY-MM-DD format)",
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format",
        message: "Please provide dates in YYYY-MM-DD format",
      });
    }

    if (start > end) {
      return res.status(400).json({
        success: false,
        error: "Invalid date range",
        message: "Start date must be before or equal to end date",
      });
    }

    const users = await User.find(
      { examDate: { $gte: start, $lte: end } },
      { userId: 1, name: 1, phoneNumber: 1, city: 1, caLevel: 1, examDate: 1 }
    ).sort({ examDate: 1 });

    return res.status(200).json({
      success: true,
      message: "Users retrieved successfully for date range",
      data: users,
      count: users.length,
      dateRange: { startDate, endDate },
    });
  } catch (error) {
    console.error("Error in getUsersByExamDateRange:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve users by date range",
      message: "Internal server error occurred while fetching users",
    });
  }
};

// ─────────────────────────────────────────────
// GET DASHBOARD STATS
// GET /api/admin/stats
// ─────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const [totalUsers, usersWithExamDate, usersByLevel] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ examDate: { $exists: true, $ne: null } }),
      User.aggregate([{ $group: { _id: "$caLevel", count: { $sum: 1 } } }]),
    ]);

    return res.status(200).json({
      success: true,
      message: "Dashboard statistics retrieved successfully",
      data: {
        totalUsers,
        usersWithExamDate,
        usersByLevel: usersByLevel.reduce((acc, item) => {
          acc[item._id || "Not Set"] = item.count;
          return acc;
        }, {}),
      },
    });
  } catch (error) {
    console.error("Error in getDashboardStats:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to retrieve dashboard statistics",
      message: "Internal server error occurred while fetching statistics",
    });
  }
};

// ─────────────────────────────────────────────
// GET COMPREHENSIVE ADMIN DATA
// GET /api/admin/comprehensive-data
// ─────────────────────────────────────────────
exports.getComprehensiveAdminData = async (req, res) => {
  try {
    const users = await User.find({}).lean();

    // Compute date helpers once (outside the loop)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const month = `${startOfDay.getFullYear()}-${String(
      startOfDay.getMonth() + 1
    ).padStart(2, "0")}`;

    const comprehensiveData = await Promise.all(
      users.map(async (user) => {
        const sessions = await Session.find({ userId: user.userId }).lean();
        const sessionIds = sessions.map((s) => s.sessionId);

        // Run all per-user queries in parallel
        const [
          questionCount,
          lastSession,
          dailyUsage,
          monthlyUsageDoc,
          monthlyAggregation,
        ] = await Promise.all([
          Question.countDocuments({ sessionId: { $in: sessionIds } }),
          Session.findOne({ userId: user.userId }).sort({ createdAt: -1 }).lean(),
          QueryUsage.findOne({
            userId: user.userId,
            date: { $gte: startOfDay, $lte: endOfDay },
          }).lean(),
          QueryUsage.findOne({ userId: user.userId, month })
            .sort({ createdAt: -1 })
            .lean(),
          QueryUsage.aggregate([
            { $match: { userId: user.userId, month } },
            { $group: { _id: null, total: { $sum: "$dailyCount" } } },
          ]),
        ]);

        const dailyQueryCount = dailyUsage ? dailyUsage.dailyCount : 0;
        const countFromMonthlyField = monthlyUsageDoc?.monthlyCount || 0;
        const countFromAggregation =
          monthlyAggregation.length > 0 ? monthlyAggregation[0].total : 0;
        const monthlyQueryCount = Math.max(countFromMonthlyField, countFromAggregation);

        return {
          userId: user.userId,
          name: user.name || "N/A",
          phone: user.phoneNumber || "N/A",
          city: user.city || "Not Set",
          level: user.caLevel || "Not Set",
          examMonth: user.examDate
            ? new Date(user.examDate).toLocaleString("default", {
                month: "long",
                year: "numeric",
              })
            : "Not Set",
          sessionCount: sessions.length,
          lastSessionDate: lastSession ? lastSession.createdAt : null,
          totalQuestions: questionCount,
          dailyQueryCount,
          monthlyQueryCount,
        };
      })
    );

    return res.status(200).json(comprehensiveData);
  } catch (error) {
    console.error("Error fetching comprehensive admin data:", error);
    return res.status(500).json({ error: "Failed to fetch admin data" });
  }
};

// ─────────────────────────────────────────────
// CHECK QUERY LIMITS  (middleware)
// ─────────────────────────────────────────────
exports.checkQueryLimits = async (req, res, next) => {
  try {
    const userId = req.user.userId;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const month = `${today.getFullYear()}-${String(
      today.getMonth() + 1
    ).padStart(2, "0")}`;

    // Get or create today's usage record
    let dailyUsage = await QueryUsage.findOne({ userId, date: today });
    if (!dailyUsage) {
      dailyUsage = await QueryUsage.create({
        userId,
        date: today,
        month,
        dailyCount: 0,
      });
    }

    // Aggregate monthly total
    const monthlyAggregation = await QueryUsage.aggregate([
      { $match: { userId, month } },
      { $group: { _id: null, total: { $sum: "$dailyCount" } } },
    ]);
    const monthlyTotal =
      monthlyAggregation.length > 0 ? monthlyAggregation[0].total : 0;

    if (dailyUsage.dailyCount >= DAILY_QUERY_LIMIT) {
      return res.status(429).json({
        error: "Daily query limit exceeded",
        message: `You have reached your daily limit of ${DAILY_QUERY_LIMIT} queries. Please try again tomorrow.`,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT },
          monthly: { used: monthlyTotal, limit: MONTHLY_QUERY_LIMIT },
        },
      });
    }

    if (monthlyTotal >= MONTHLY_QUERY_LIMIT) {
      return res.status(429).json({
        error: "Monthly query limit exceeded",
        message: `You have reached your monthly limit of ${MONTHLY_QUERY_LIMIT} queries. Please wait until next month.`,
        limits: {
          daily: { used: dailyUsage.dailyCount, limit: DAILY_QUERY_LIMIT },
          monthly: { used: monthlyTotal, limit: MONTHLY_QUERY_LIMIT },
        },
      });
    }

    req.queryUsage = { dailyUsage, userId, today, month };
    next();
  } catch (error) {
    console.error("Error checking query limits:", error);
    return res.status(500).json({ error: "Failed to check query limits" });
  }
};