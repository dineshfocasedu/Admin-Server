const MCQEvaluation = require('../models/MCQEvaluation');
const MCQProgress = require('../models/MCQProgress');
const MCQGeneration = require('../models/MCQGeneration');
const limitService = require('../services/limitService');
const User = require('../models/User');
const { validatePagination } = require('../utils/validators');
const Subscription = require("../models/Subscription");

const getDashboard = async (req, res) => {
  try {
  const userId = req.user.userId;

     // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"

    // ✅ GET USER
    const user = await User.findOne({ userId });
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

      const subscription = await Subscription.findOne({
                    userId,
                    status: "active",
                    endDate: { $gt: new Date() },
                  }).sort({ createdAt: -1 });
        
        console.log('User Subscription:', subscription);


    // ✅ GET LIMITS
    const limits = await limitService.resetLimitsIfNeeded(userId, subscription?.plan ?? "free");

    // ✅ GET STATS
    const totalEvaluations = await MCQEvaluation.countDocuments({ userId });
    const correctEvaluations = await MCQEvaluation.countDocuments({ userId, isCorrect: true });
    const avgScore = totalEvaluations > 0 ? Math.round((correctEvaluations / totalEvaluations) * 100) : 0;

    // ✅ GET PROGRESS BY SUBJECT/CHAPTER
    const progressBySubject = await MCQProgress.find({ userId }).lean();

    res.json({
      success: true,
      user: {
        userId: user.userId,
        email: user.email,
        name: user.name,
        subscription: subscription?.plan ?? "free",
      },
      stats: {
        totalEvaluations,
        correctAnswers: correctEvaluations,
        averageScore: avgScore,
        accuracyPercentage: avgScore,
      },
      limits: {
        generation: {
          daily: {
            limit: limits.dailyLimit,
            used: limits.generatedToday,
            remaining: limits.dailyLimit - limits.generatedToday,
          },
          monthly: {
            limit: limits.monthlyLimit,
            used: limits.generatedThisMonth,
            remaining: limits.monthlyLimit - limits.generatedThisMonth,
          },
        },
        evaluation: {
          daily: {
            limit: limits.evalDailyLimit,
            used: limits.evaluationsToday,
            remaining: limits.evalDailyLimit - limits.evaluationsToday,
          },
          monthly: {
            limit: limits.evalMonthlyLimit,
            used: limits.evaluationsThisMonth,
            remaining: limits.evalMonthlyLimit - limits.evaluationsThisMonth,
          },
        },
      },
      progress: progressBySubject.map(p => ({
        subject: p.subject,
        chapter: p.chapter,
        unit: p.unit || 'N/A',
        totalAttempted: p.totalAttempted,
        totalCorrect: p.totalCorrect,
        avgScore: p.avgScore,
        lastAttempted: p.lastAttempted,
      })),
    });
  } catch (error) {
    console.error('getDashboard Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getProgressByFilter = async (req, res) => {
  try {
  const userId = req.user.userId;
    // const userId = "ce1530e5-4993-4e1b-8248-a8b5e200dcc5"

    const { subject, chapter, unit, limit = 10, page = 1 } = req.query;

    // ✅ VALIDATE PAGINATION
    const pagination = validatePagination(limit, page);
    if (!pagination.valid) {
      return res.status(400).json({ success: false, error: pagination.error });
    }

    // ✅ BUILD QUERY
    const query = { userId };
    if (subject) query.subject = subject;
    if (chapter) query.chapter = chapter;
    if (unit) query.unit = unit;

    const skip = (pagination.page - 1) * pagination.limit;

    // ✅ GET PROGRESS
    const progress = await MCQProgress.find(query)
      .sort({ lastAttempted: -1 })
      .limit(pagination.limit)
      .skip(skip)
      .lean();

    const total = await MCQProgress.countDocuments(query);

    res.json({
      success: true,
      total,
      page: pagination.page,
      limit: pagination.limit,
      pages: Math.ceil(total / pagination.limit),
      data: progress.map(p => ({
        subject: p.subject,
        chapter: p.chapter,
        unit: p.unit || 'N/A',
        totalAttempted: p.totalAttempted,
        totalCorrect: p.totalCorrect,
        avgScore: p.avgScore,
        successRate: Math.round((p.totalCorrect / p.totalAttempted) * 100),
        firstAttempted: p.firstAttempted,
        lastAttempted: p.lastAttempted,
      })),
    });
  } catch (error) {
    console.error('getProgressByFilter Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getAdminMcqUsers = async (req, res) => {
  try {
    const {
      caLevel,
      phone,
      dateFrom,
      dateTo,
      phoneOnly = 'true',
      limit = 10,
      page = 1,
    } = req.query;

    const pagination = validatePagination(limit, page);
    if (!pagination.valid) {
      return res.status(400).json({ success: false, error: pagination.error });
    }

    const match = {};

    if (phoneOnly === 'true') {
      match.phoneNumber = { $type: 'string', $ne: '' };
    }

    if (phone && typeof phone === 'string') {
      match.phoneNumber = { $regex: phone, $options: 'i' };
    }

    if (caLevel && typeof caLevel === 'string') {
      match.caLevel = caLevel;
    }

    if (dateFrom || dateTo) {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;

      if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
        return res.status(400).json({ success: false, error: 'Invalid date format' });
      }

      match.createdAt = {};
      if (from) match.createdAt.$gte = from;
      if (to) match.createdAt.$lte = to;
    }

    const skip = (pagination.page - 1) * pagination.limit;

    const total = await User.countDocuments(match);

    const users = await User.aggregate([
      { $match: match },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: pagination.limit },
      {
        $lookup: {
          from: 'mcqgenerations',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
            {
              $addFields: {
                genCount: {
                  $ifNull: [
                    '$numGenerated',
                    { $size: { $ifNull: ['$mcqIds', []] } },
                  ],
                },
              },
            },
            { $group: { _id: null, totalGenerated: { $sum: '$genCount' } } },
          ],
          as: 'generationStats',
        },
      },
      {
        $lookup: {
          from: 'mcqevaluations',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
            {
              $group: {
                _id: null,
                totalEvaluated: { $sum: 1 },
                totalCorrect: {
                  $sum: { $cond: [{ $eq: ['$isCorrect', true] }, 1, 0] },
                },
              },
            },
          ],
          as: 'evaluationStats',
        },
      },
      {
        $lookup: {
          from: 'mcqprogresses',
          let: { uid: '$userId' },
          pipeline: [
            { $match: { $expr: { $eq: ['$userId', '$$uid'] } } },
            {
              $group: {
                _id: null,
                totalAttempted: { $sum: '$totalAttempted' },
                totalCorrect: { $sum: '$totalCorrect' },
                avgScore: { $avg: '$avgScore' },
              },
            },
          ],
          as: 'progressStats',
        },
      },
      {
        $addFields: {
          generationStats: {
            $ifNull: [{ $arrayElemAt: ['$generationStats', 0] }, { totalGenerated: 0 }],
          },
          evaluationStats: {
            $ifNull: [
              { $arrayElemAt: ['$evaluationStats', 0] },
              { totalEvaluated: 0, totalCorrect: 0 },
            ],
          },
          progressStats: {
            $ifNull: [
              { $arrayElemAt: ['$progressStats', 0] },
              { totalAttempted: 0, totalCorrect: 0, avgScore: 0 },
            ],
          },
        },
      },
      {
        $addFields: {
          evaluationAccuracy: {
            $cond: [
              { $gt: ['$evaluationStats.totalEvaluated', 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          '$evaluationStats.totalCorrect',
                          '$evaluationStats.totalEvaluated',
                        ],
                      },
                      100,
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },
          progressAccuracy: {
            $cond: [
              { $gt: ['$progressStats.totalAttempted', 0] },
              {
                $round: [
                  {
                    $multiply: [
                      {
                        $divide: [
                          '$progressStats.totalCorrect',
                          '$progressStats.totalAttempted',
                        ],
                      },
                      100,
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $project: {
          userId: 1,
          name: 1,
          phoneNumber: 1,
          caLevel: 1,
          createdAt: 1,
          questionsGenerated: '$generationStats.totalGenerated',
          questionsEvaluated: '$evaluationStats.totalEvaluated',
          correctEvaluations: '$evaluationStats.totalCorrect',
          resultPercentage: '$evaluationAccuracy',
          progress: {
            totalAttempted: '$progressStats.totalAttempted',
            totalCorrect: '$progressStats.totalCorrect',
            avgScore: { $round: ['$progressStats.avgScore', 0] },
            accuracyPercentage: '$progressAccuracy',
          },
        },
      },
    ]);

    res.json({
      success: true,
      total,
      page: pagination.page,
      limit: pagination.limit,
      pages: Math.ceil(total / pagination.limit),
      data: users,
    });
  } catch (error) {
    console.error('getAdminMcqUsers Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getMcqGenerationStats = async (req, res) => {
  try {
    const { date } = req.query;

    // Determine the date range for query
    let startDate, endDate;

    if (date) {
      // If date is provided, use that specific date
      startDate = new Date(date);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(date);
      endDate.setHours(23, 59, 59, 999);
    } else {
      // Default to today
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    }

    // Validate date if provided
    if (date && isNaN(startDate.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Get total MCQs generated for the date range
    const totalMcqs = await MCQGeneration.aggregate([
      {
        $match: {
          generatedAt: { $gte: startDate, $lte: endDate },
          status: 'success'
        }
      },
      {
        $group: {
          _id: null,
          totalCount: {
            $sum: {
              $ifNull: [
                '$numGenerated',
                { $size: { $ifNull: ['$mcqData', []] } }
              ]
            }
          },
          totalGenerations: { $sum: 1 },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          totalCount: 1,
          totalGenerations: 1,
          dailyActiveUsers: { $size: '$uniqueUsers' }
        }
      }
    ]);

    // Get level-wise breakdown
    const levelWiseStats = await MCQGeneration.aggregate([
      {
        $match: {
          generatedAt: { $gte: startDate, $lte: endDate },
          status: 'success'
        }
      },
      {
        $group: {
          _id: '$level',
          totalMcqs: {
            $sum: {
              $ifNull: [
                '$numGenerated',
                { $size: { $ifNull: ['$mcqData', []] } }
              ]
            }
          },
          totalGenerations: { $sum: 1 },
          users: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          level: '$_id',
          totalMcqs: 1,
          totalGenerations: 1,
          uniqueUsers: { $size: '$users' }
        }
      },
      {
        $sort: { level: 1 }
      }
    ]);

    // Get active users details with their generation stats
    const activeUsersStats = await MCQGeneration.aggregate([
      {
        $match: {
          generatedAt: { $gte: startDate, $lte: endDate },
          status: 'success'
        }
      },
      {
        $group: {
          _id: '$userId',
          totalMcqsGenerated: {
            $sum: {
              $ifNull: [
                '$numGenerated',
                { $size: { $ifNull: ['$mcqData', []] } }
              ]
            }
          },
          totalGenerations: { $sum: 1 },
          levels: { $addToSet: '$level' },
          subjects: { $addToSet: '$subject' },
          lastGeneratedAt: { $max: '$generatedAt' }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: 'userId',
          as: 'userInfo'
        }
      },
      {
        $unwind: {
          path: '$userInfo',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          userId: '$_id',
          name: '$userInfo.name',
          email: '$userInfo.email',
          phoneNumber: '$userInfo.phoneNumber',
          caLevel: '$userInfo.caLevel',
          totalMcqsGenerated: 1,
          totalGenerations: 1,
          levels: 1,
          subjects: 1,
          lastGeneratedAt: 1
        }
      },
      {
        $sort: { totalMcqsGenerated: -1 }
      }
    ]);

    // Format the response
    const totalStats = totalMcqs.length > 0 ? totalMcqs[0] : { totalCount: 0, totalGenerations: 0, dailyActiveUsers: 0 };

    res.json({
      success: true,
      date: startDate.toISOString().split('T')[0],
      isToday: !date || new Date().toDateString() === startDate.toDateString(),
      summary: {
        totalMcqsGenerated: totalStats.totalCount,
        totalGenerations: totalStats.totalGenerations,
        dailyActiveUsers: totalStats.dailyActiveUsers
      },
      levelWiseBreakdown: levelWiseStats.map(stat => ({
        level: stat._id || 'Unknown',
        totalMcqs: stat.totalMcqs,
        totalGenerations: stat.totalGenerations,
        uniqueUsers: stat.uniqueUsers
      })),
      activeUsers: activeUsersStats.map(user => ({
        userId: user.userId,
        name: user.name || 'N/A',
        email: user.email || 'N/A',
        phoneNumber: user.phoneNumber || 'N/A',
        caLevel: user.caLevel || 'N/A',
        totalMcqsGenerated: user.totalMcqsGenerated,
        totalGenerations: user.totalGenerations,
        levels: user.levels.filter(Boolean),
        subjects: user.subjects.filter(Boolean),
        lastGeneratedAt: user.lastGeneratedAt
      }))
    });
  } catch (error) {
    console.error('getMcqGenerationStats Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

const getMcqQuestions=async(req,res)=>{
   try {
    const { userId } = req.params;
    const { limit = 50, page = 1 } = req.query;

    const MCQGeneration = require('../models/MCQGeneration');
    const MCQEvaluation = require('../models/MCQEvaluation');

    // Fetch all generated MCQs for this user
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const mcqGenerations = await MCQGeneration.find({ userId })
      .sort({ generatedAt: -1 })
      .limit(parseInt(limit))
      .skip(skip)
      .lean();

    const total = await MCQGeneration.countDocuments({ userId });

    // Flatten all MCQ data from all generations
    const allQuestions = [];
    for (const generation of mcqGenerations) {
      if (generation.mcqData && Array.isArray(generation.mcqData)) {
        for (const mcq of generation.mcqData) {
          // Try to find evaluation for this MCQ
          const evaluation = await MCQEvaluation.findOne({
            userId,
            mcqId: mcq.mcqId
          }).lean();

          allQuestions.push({
            _id: mcq.mcqId,
            mcqId: mcq.mcqId,
            question: mcq.question,
            options: mcq.options,
            correctAnswer: mcq.correctAnswer,
            userAnswer: evaluation?.userAnswer || null,
            isCorrect: evaluation?.isCorrect || null,
            explanation: mcq.explanation,
            level: generation.level,
            subject: mcq.subject || generation.subject,
            chapter: mcq.chapter || generation.chapter,
            unit: mcq.unit || generation.unit,
            difficulty: mcq.difficulty || generation.difficulty,
            topic: mcq.topic,
            score: evaluation?.score || null,
            timeSpent: evaluation?.timeSpent || null,
            submittedAt: evaluation?.submittedAt || null,
            createdAt: generation.generatedAt,
          });
        }
      }
    }

    res.json({
      success: true,
      total: allQuestions.length,
      pages: Math.ceil(total / parseInt(limit)),
      data: allQuestions,
    });
  } catch (error) {
    console.error('Error fetching user questions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

module.exports = { getDashboard, getProgressByFilter, getAdminMcqUsers, getMcqGenerationStats ,getMcqQuestions};