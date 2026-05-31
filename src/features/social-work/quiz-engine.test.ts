import { describe, expect, it } from 'vitest';
import {
  QUESTION_COUNTS,
  createSession,
  filterQuestionsByCategory,
  gradeAnswer,
  updateProgressAfterAnswer,
} from './quiz-engine';

const bank = [
  ...Array.from({ length: 100 }, (_, index) => ({
    id: `single-${index + 1}-a`,
    knowledgePointId: `kp-${index + 1}`,
    subject: index < 50 ? '社会工作综合能力' : '社会工作实务',
    title: `单选知识点${index + 1}`,
    questionType: 'single' as const,
    question: `单选题${index + 1}`,
    options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
    answer: 'A',
    explanation: '解析',
    source: '测试',
    sourcePage: 1,
    sourceExcerpt: '依据',
  })),
  ...Array.from({ length: 100 }, (_, index) => ({
    id: `single-${index + 1}-b`,
    knowledgePointId: `kp-${index + 1}`,
    subject: index < 50 ? '社会工作综合能力' : '社会工作实务',
    title: `单选知识点${index + 1}`,
    questionType: 'single' as const,
    question: `单选变体${index + 1}`,
    options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }],
    answer: 'A',
    explanation: '解析',
    source: '测试',
    sourcePage: 1,
    sourceExcerpt: '依据',
  })),
  ...Array.from({ length: 100 }, (_, index) => ({
    id: `multiple-${index + 1}`,
    knowledgePointId: `kp-${index + 1}`,
    subject: index < 50 ? '社会工作综合能力' : '社会工作实务',
    title: `多选知识点${index + 1}`,
    questionType: 'multiple' as const,
    question: `多选题${index + 1}`,
    options: [{ id: 'A', text: 'A' }, { id: 'B', text: 'B' }, { id: 'C', text: 'C' }],
    answer: ['A', 'C'],
    explanation: '解析',
    source: '测试',
    sourcePage: 1,
    sourceExcerpt: '依据',
  })),
];

describe('social-work quiz engine', () => {
  it('creates a 50-question session with fixed type counts and unique knowledge points', () => {
    const session = createSession(bank, {}, () => 0.3);
    const counts = session.reduce<Record<string, number>>((memo, question) => {
      memo[question.questionType] = (memo[question.questionType] ?? 0) + 1;
      return memo;
    }, {});

    expect(session).toHaveLength(50);
    expect(counts).toEqual(QUESTION_COUNTS);
    expect(new Set(session.map((question) => question.knowledgePointId)).size).toBe(50);
  });

  it('creates a subject-scoped session from the selected category', () => {
    const session = createSession(bank, {}, () => 0.3, 'practice');
    const counts = session.reduce<Record<string, number>>((memo, question) => {
      memo[question.questionType] = (memo[question.questionType] ?? 0) + 1;
      return memo;
    }, {});

    expect(session).toHaveLength(50);
    expect(counts).toEqual(QUESTION_COUNTS);
    expect(session.every((question) => question.subject === '社会工作实务')).toBe(true);
  });

  it('filters questions by the visible category choices', () => {
    expect(filterQuestionsByCategory(bank, 'law')).toHaveLength(0);
    expect(filterQuestionsByCategory(bank, 'practice')).toHaveLength(150);
    expect(filterQuestionsByCategory(bank, 'comprehensive')).toHaveLength(300);
  });

  it('does not pick two variants from the same knowledge point in one session', () => {
    const session = createSession(bank, {}, () => 0);

    expect(session).toHaveLength(50);
    expect(new Set(session.map((question) => question.knowledgePointId)).size).toBe(50);
  });

  it('grades multiple-choice answers independent of order', () => {
    expect(gradeAnswer({ questionType: 'multiple', answer: ['A', 'C'] }, ['C', 'A'])).toBe(true);
    expect(gradeAnswer({ questionType: 'multiple', answer: ['A', 'C'] }, ['A'])).toBe(false);
  });

  it('raises wrong counts and resets streak after an incorrect answer', () => {
    const progress = updateProgressAfterAnswer({ attempts: 1, correct: 1, wrong: 0, streakCorrect: 1, lastAnsweredAt: 1 }, false, 2);

    expect(progress).toEqual({
      attempts: 2,
      correct: 1,
      wrong: 1,
      streakCorrect: 0,
      lastAnsweredAt: 2,
    });
  });
});
