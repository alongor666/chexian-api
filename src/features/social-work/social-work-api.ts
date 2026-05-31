import { API_BASE } from '../../shared/api/client';
import type { ProgressMap, SocialWorkQuestion } from './quiz-engine';

const TOKEN_KEY = 'sw-study-token-v1';
const LEARNER_KEY = 'sw-study-learner-v1';

export interface StudyLearner {
  id: string;
  displayName: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

interface AuthPayload {
  learner: StudyLearner;
  token: string;
  progress: ProgressMap;
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
  variants: number;
  question: SocialWorkQuestion;
}

export function loadStoredAuth(): { token: string; learner: StudyLearner } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  const learnerRaw = localStorage.getItem(LEARNER_KEY);
  if (!token || !learnerRaw) return null;
  try {
    return { token, learner: JSON.parse(learnerRaw) as StudyLearner };
  } catch {
    clearStoredAuth();
    return null;
  }
}

export function saveStoredAuth(token: string, learner: StudyLearner): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(LEARNER_KEY, JSON.stringify(learner));
}

export function clearStoredAuth(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(LEARNER_KEY);
}

export async function fetchQuestions(token: string): Promise<SocialWorkQuestion[]> {
  const payload = await request<{ questions: SocialWorkQuestion[] }>('/social-work/questions', {}, token);
  return payload.questions;
}

export async function loginLearner(displayName: string, studyCode: string): Promise<AuthPayload> {
  return request<AuthPayload>('/social-work/login', {
    method: 'POST',
    body: JSON.stringify({ displayName, studyCode }),
  });
}

export async function fetchProgress(token: string): Promise<ProgressMap> {
  const payload = await request<{ progress: ProgressMap }>('/social-work/progress', {}, token);
  return payload.progress;
}

export async function fetchMistakes(token: string): Promise<MistakeBookItem[]> {
  const payload = await request<{ mistakes: MistakeBookItem[] }>('/social-work/mistakes', {}, token);
  return payload.mistakes;
}

export async function recordAnswer(
  token: string,
  body: {
    questionId: string;
    knowledgePointId: string;
    questionType: string;
    selectedAnswer: unknown;
    correctAnswer: unknown;
    isCorrect: boolean;
    answeredAt: number;
  },
): Promise<ProgressMap> {
  const payload = await request<{ progress: ProgressMap }>('/social-work/answers', {
    method: 'POST',
    body: JSON.stringify(body),
  }, token);
  return payload.progress;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const payload = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error?.message ?? '请求失败');
  }
  return payload.data;
}
