import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SocialWorkStudyStore } from '../study-store.js';

function createStore(): SocialWorkStudyStore {
  const dir = mkdtempSync(join(tmpdir(), 'sw-study-'));
  return new SocialWorkStudyStore(join(dir, 'study.db'));
}

describe('SocialWorkStudyStore', () => {
  it('registers a learner and logs in with the study code', () => {
    const store = createStore();

    const registered = store.registerLearner('张三', '123456');
    const loggedIn = store.loginLearner('张三', '123456');

    expect(registered.displayName).toBe('张三');
    expect(loggedIn.id).toBe(registered.id);
    expect(loggedIn.displayName).toBe('张三');
    expect(() => store.loginLearner('张三', 'wrong')).toThrow(/学习码错误/);
    store.close();
  });

  it('persists answer history and per-knowledge-point progress', () => {
    const store = createStore();
    const learner = store.registerLearner('李四', 'abcdef');

    store.recordAnswer({
      learnerId: learner.id,
      questionId: 'q-1',
      knowledgePointId: 'kp-1',
      questionType: 'single',
      selectedAnswer: 'A',
      correctAnswer: 'B',
      isCorrect: false,
      answeredAt: 1700000000000,
    });
    store.recordAnswer({
      learnerId: learner.id,
      questionId: 'q-1',
      knowledgePointId: 'kp-1',
      questionType: 'single',
      selectedAnswer: 'B',
      correctAnswer: 'B',
      isCorrect: true,
      answeredAt: 1700000100000,
    });

    const progress = store.getProgress(learner.id);
    expect(progress['kp-1']).toEqual({
      attempts: 2,
      correct: 1,
      wrong: 1,
      streakCorrect: 1,
      lastAnsweredAt: 1700000100000,
    });
    expect(store.getAnswerHistory(learner.id)).toHaveLength(2);
    store.close();
  });

  it('creates allowed learners without resetting existing progress', () => {
    const store = createStore();
    const learner = store.ensureLearnerWithHash('zouwenjun', 'hash-v1');

    store.recordAnswer({
      learnerId: learner.id,
      questionId: 'q-1',
      knowledgePointId: 'kp-1',
      questionType: 'single',
      selectedAnswer: '答案',
      correctAnswer: '答案',
      isCorrect: true,
      answeredAt: 1700000000000,
    });

    const sameLearner = store.ensureLearnerWithHash('zouwenjun', 'hash-v2');

    expect(sameLearner.id).toBe(learner.id);
    expect(store.getProgress(learner.id)['kp-1'].attempts).toBe(1);
    store.close();
  });
});
