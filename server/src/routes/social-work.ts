import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler, AppError } from '../middleware/error.js';
import { getSocialWorkStudyStorePath } from '../config/paths.js';
import { isAllowedSocialWorkDisplayName, verifyAllowedSocialWorkUser } from '../social-work/allowed-users.js';
import { SocialWorkStudyStore } from '../social-work/study-store.js';
import { loadSocialWorkQuestionBank } from '../social-work/question-bank.js';

const router = Router();
const store = new SocialWorkStudyStore(getSocialWorkStudyStorePath());

const credentialsSchema = z.object({
  displayName: z.string().min(1).max(32),
  studyCode: z.string().min(4).max(64),
});

const answerSchema = z.object({
  questionId: z.string().min(1),
  knowledgePointId: z.string().min(1),
  questionType: z.enum(['single', 'multiple']),
  selectedAnswer: z.unknown(),
  correctAnswer: z.unknown(),
  isCorrect: z.boolean(),
  answeredAt: z.number().int().positive(),
});

interface SocialWorkRequest extends Request {
  learner?: { id: string; displayName: string };
}

function requireStudySession(req: SocialWorkRequest, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
  if (!token || !token.startsWith('sws_')) {
    next(new AppError(401, '学习会话不存在，请先登录'));
    return;
  }

  const learner = store.getLearnerBySession(token);
  if (!learner) {
    next(new AppError(401, '学习会话已失效，请重新登录'));
    return;
  }
  if (!isAllowedSocialWorkDisplayName(learner.displayName)) {
    next(new AppError(403, '当前用户无权使用社工刷题应用'));
    return;
  }
  req.learner = learner;
  next();
}

function authResponse(learner: { id: string; displayName: string }) {
  const token = store.createSession(learner.id);
  return {
    learner,
    token,
    progress: store.getProgress(learner.id),
  };
}

router.get('/questions', requireStudySession, (_req, res) => {
  res.json({
    success: true,
    data: {
      questions: loadSocialWorkQuestionBank(),
    },
  });
});

router.post('/register', asyncHandler(async (req, res) => {
  throw new AppError(403, '当前应用不开放注册，请使用授权账号登录');
}));

router.post('/login', asyncHandler(async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0].message);
  }
  try {
    const allowedUser = verifyAllowedSocialWorkUser(parsed.data.displayName, parsed.data.studyCode);
    if (!allowedUser) {
      throw new Error('用户名或密码错误');
    }
    const learner = store.ensureLearnerWithHash(allowedUser.displayName, allowedUser.studyCodeHash);
    res.json({ success: true, data: authResponse(learner) });
  } catch (error) {
    throw new AppError(401, error instanceof Error ? error.message : '登录失败');
  }
}));

router.get('/me', requireStudySession, (req: SocialWorkRequest, res) => {
  res.json({
    success: true,
    data: {
      learner: req.learner,
      progress: store.getProgress(req.learner!.id),
    },
  });
});

router.get('/progress', requireStudySession, (req: SocialWorkRequest, res) => {
  res.json({
    success: true,
    data: {
      progress: store.getProgress(req.learner!.id),
    },
  });
});

router.get('/mistakes', requireStudySession, (req: SocialWorkRequest, res) => {
  const bank = loadSocialWorkQuestionBank();
  const questionById = new Map(bank.map((question) => [question.id, question]));
  const questionsByKnowledgePoint = new Map<string, typeof bank>();
  for (const question of bank) {
    const rows = questionsByKnowledgePoint.get(question.knowledgePointId) ?? [];
    rows.push(question);
    questionsByKnowledgePoint.set(question.knowledgePointId, rows);
  }

  const items = store.getMistakeBook(req.learner!.id).map((item) => ({
    ...item,
    question: questionById.get(item.latestQuestionId)
      ?? questionsByKnowledgePoint.get(item.knowledgePointId)?.[0]
      ?? null,
    variants: questionsByKnowledgePoint.get(item.knowledgePointId)?.length ?? 0,
  })).filter((item) => item.question);

  res.json({
    success: true,
    data: {
      mistakes: items,
    },
  });
});

router.post('/answers', requireStudySession, asyncHandler(async (req: SocialWorkRequest, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new AppError(400, parsed.error.issues[0].message);
  }
  store.recordAnswer({
    learnerId: req.learner!.id,
    ...parsed.data,
  });
  res.json({
    success: true,
    data: {
      progress: store.getProgress(req.learner!.id),
    },
  });
}));

export default router;
