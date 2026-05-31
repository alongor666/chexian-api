import bcrypt from 'bcrypt';
import crypto from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StudyLearner {
  id: string;
  displayName: string;
}

export interface ProgressRow {
  attempts: number;
  correct: number;
  wrong: number;
  streakCorrect: number;
  lastAnsweredAt: number;
}

export interface MistakeBookItem {
  knowledgePointId: string;
  latestQuestionId: string;
  wrong: number;
  correct: number;
  attempts: number;
  streakCorrect: number;
  lastAnsweredAt: number;
  lastWrongAt: number;
}

export interface AnswerInput {
  learnerId: string;
  questionId: string;
  knowledgePointId: string;
  questionType: string;
  selectedAnswer: unknown;
  correctAnswer: unknown;
  isCorrect: boolean;
  answeredAt: number;
}

interface StoredLearner extends StudyLearner {
  studyCodeHash: string;
  createdAt: string;
  updatedAt: string;
}

interface StoredSession {
  token: string;
  learnerId: string;
  createdAt: string;
  lastSeenAt: string;
}

interface StoreData {
  learners: StoredLearner[];
  sessions: StoredSession[];
  answerHistory: AnswerInput[];
  progress: Record<string, Record<string, ProgressRow>>;
}

export class SocialWorkStudyStore {
  private data: StoreData;

  constructor(private readonly storePath: string) {
    mkdirSync(dirname(storePath), { recursive: true });
    this.data = this.load();
  }

  registerLearner(displayName: string, studyCode: string): StudyLearner {
    const normalizedName = normalizeDisplayName(displayName);
    if (studyCode.length < 4) {
      throw new Error('学习码至少需要4位');
    }
    if (this.findStoredLearnerByName(normalizedName)) {
      throw new Error('这个昵称已被使用，请直接登录或换一个昵称');
    }

    const learner: StoredLearner = {
      id: crypto.randomUUID(),
      displayName: normalizedName,
      studyCodeHash: bcrypt.hashSync(studyCode, 10),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.learners.push(learner);
    this.flush();
    return toPublicLearner(learner);
  }

  ensureLearnerWithHash(displayName: string, studyCodeHash: string): StudyLearner {
    const normalizedName = normalizeDisplayName(displayName);
    const existingLearner = this.findStoredLearnerByName(normalizedName);
    if (existingLearner) {
      if (existingLearner.studyCodeHash !== studyCodeHash) {
        existingLearner.studyCodeHash = studyCodeHash;
        existingLearner.updatedAt = nowIso();
        this.flush();
      }
      return toPublicLearner(existingLearner);
    }

    const learner: StoredLearner = {
      id: crypto.randomUUID(),
      displayName: normalizedName,
      studyCodeHash,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.data.learners.push(learner);
    this.flush();
    return toPublicLearner(learner);
  }

  loginLearner(displayName: string, studyCode: string): StudyLearner {
    const normalizedName = normalizeDisplayName(displayName);
    const learner = this.findStoredLearnerByName(normalizedName);
    if (!learner || !bcrypt.compareSync(studyCode, learner.studyCodeHash)) {
      throw new Error('昵称或学习码错误');
    }
    return toPublicLearner(learner);
  }

  createSession(learnerId: string): string {
    this.ensureLearner(learnerId);
    const token = `sws_${crypto.randomBytes(32).toString('hex')}`;
    this.data.sessions.push({
      token,
      learnerId,
      createdAt: nowIso(),
      lastSeenAt: nowIso(),
    });
    this.flush();
    return token;
  }

  getLearnerBySession(token: string): StudyLearner | null {
    const session = this.data.sessions.find((item) => item.token === token);
    if (!session) return null;
    const learner = this.data.learners.find((item) => item.id === session.learnerId);
    if (!learner) return null;
    session.lastSeenAt = nowIso();
    this.flush();
    return toPublicLearner(learner);
  }

  recordAnswer(input: AnswerInput): void {
    this.ensureLearner(input.learnerId);
    this.data.answerHistory.push({
      ...input,
      selectedAnswer: cloneJson(input.selectedAnswer),
      correctAnswer: cloneJson(input.correctAnswer),
    });

    const learnerProgress = this.data.progress[input.learnerId] ?? {};
    const current = learnerProgress[input.knowledgePointId];
    learnerProgress[input.knowledgePointId] = {
      attempts: (current?.attempts ?? 0) + 1,
      correct: (current?.correct ?? 0) + (input.isCorrect ? 1 : 0),
      wrong: (current?.wrong ?? 0) + (input.isCorrect ? 0 : 1),
      streakCorrect: input.isCorrect ? (current?.streakCorrect ?? 0) + 1 : 0,
      lastAnsweredAt: input.answeredAt,
    };
    this.data.progress[input.learnerId] = learnerProgress;
    this.flush();
  }

  getProgress(learnerId: string): Record<string, ProgressRow> {
    this.ensureLearner(learnerId);
    return cloneJson(this.data.progress[learnerId] ?? {});
  }

  getAnswerHistory(learnerId: string): AnswerInput[] {
    this.ensureLearner(learnerId);
    return this.data.answerHistory
      .filter((item) => item.learnerId === learnerId)
      .map(cloneJson);
  }

  getMistakeBook(learnerId: string): MistakeBookItem[] {
    this.ensureLearner(learnerId);
    const progress = this.data.progress[learnerId] ?? {};
    const latestWrongByKnowledgePoint = new Map<string, AnswerInput>();
    for (const answer of this.data.answerHistory) {
      if (answer.learnerId !== learnerId || answer.isCorrect) continue;
      const current = latestWrongByKnowledgePoint.get(answer.knowledgePointId);
      if (!current || current.answeredAt < answer.answeredAt) {
        latestWrongByKnowledgePoint.set(answer.knowledgePointId, answer);
      }
    }

    return [...latestWrongByKnowledgePoint.entries()]
      .map(([knowledgePointId, answer]) => {
        const row = progress[knowledgePointId] ?? {
          attempts: 0,
          correct: 0,
          wrong: 0,
          streakCorrect: 0,
          lastAnsweredAt: 0,
        };
        return {
          knowledgePointId,
          latestQuestionId: answer.questionId,
          wrong: row.wrong,
          correct: row.correct,
          attempts: row.attempts,
          streakCorrect: row.streakCorrect,
          lastAnsweredAt: row.lastAnsweredAt,
          lastWrongAt: answer.answeredAt,
        };
      })
      .filter((item) => item.wrong > 0 && item.streakCorrect < 2)
      .sort((a, b) => b.lastWrongAt - a.lastWrongAt);
  }

  close(): void {
    this.flush();
  }

  private findStoredLearnerByName(displayName: string): StoredLearner | undefined {
    return this.data.learners.find((item) => item.displayName === displayName);
  }

  private ensureLearner(learnerId: string): void {
    if (!this.data.learners.some((item) => item.id === learnerId)) {
      throw new Error('学习用户不存在');
    }
  }

  private load(): StoreData {
    try {
      return JSON.parse(readFileSync(this.storePath, 'utf8')) as StoreData;
    } catch {
      return {
        learners: [],
        sessions: [],
        answerHistory: [],
        progress: {},
      };
    }
  }

  private flush(): void {
    const tmpPath = `${this.storePath}.tmp`;
    writeFileSync(tmpPath, `${JSON.stringify(this.data, null, 2)}\n`, 'utf8');
    renameSync(tmpPath, this.storePath);
  }
}

function normalizeDisplayName(value: string): string {
  const displayName = value.trim();
  if (displayName.length < 1 || displayName.length > 32) {
    throw new Error('昵称长度需为1到32个字符');
  }
  return displayName;
}

function toPublicLearner(learner: StoredLearner): StudyLearner {
  return {
    id: learner.id,
    displayName: learner.displayName,
  };
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nowIso(): string {
  return new Date().toISOString();
}
