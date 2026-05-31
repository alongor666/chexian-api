export const QUESTION_COUNTS = {
  single: 35,
  multiple: 15,
} as const;

export type QuestionType = keyof typeof QUESTION_COUNTS;
export type SubjectCategory = 'law' | 'practice' | 'comprehensive';

export const SUBJECT_CATEGORIES: Array<{ id: SubjectCategory; label: string; subject?: string }> = [
  { id: 'law', label: '法律法规', subject: '社会工作法规与政策' },
  { id: 'practice', label: '实务', subject: '社会工作实务' },
  { id: 'comprehensive', label: '综合' },
];

export interface QuestionOption {
  id: string | boolean;
  text: string;
}

export interface SocialWorkQuestion {
  id: string;
  knowledgePointId: string;
  variantId?: string;
  subject: string;
  title: string;
  questionType: QuestionType;
  questionStyle?: string;
  difficulty?: '基础' | '提高' | '易错' | '案例';
  question: string;
  options: QuestionOption[];
  answer: string | string[] | boolean;
  explanation: string;
  source: string;
  sourcePage: number;
  sourceExcerpt: string;
  caseAnalysis?: boolean;
  examCategory?: string;
  sourceAuthority?: string;
  sourceUrl?: string;
  evidenceNote?: string;
  practiceFocus?: string;
}

export interface ProgressRow {
  attempts: number;
  correct: number;
  wrong: number;
  streakCorrect: number;
  lastAnsweredAt: number;
}

export type ProgressMap = Record<string, ProgressRow>;

export function calculateWeight(progress?: ProgressRow, now = Date.now()): number {
  if (!progress) return 1;
  const wrongBoost = progress.wrong * 0.8;
  const streakReduction = Math.min(progress.streakCorrect * 0.18, 0.72);
  const accuracyPenalty = progress.attempts > 0 ? (progress.correct / progress.attempts) * 0.35 : 0;
  const baseWeight = Math.max(0.35, 1 + wrongBoost - streakReduction - accuracyPenalty);
  const ageMs = Math.max(0, now - progress.lastAnsweredAt);
  const dayMs = 24 * 60 * 60 * 1000;
  if (progress.wrong > 0 && progress.streakCorrect < 2) return baseWeight;
  if (ageMs < dayMs) return Math.max(0.12, baseWeight * 0.2);
  if (ageMs < 3 * dayMs) return Math.max(0.2, baseWeight * 0.45);
  if (ageMs < 7 * dayMs) return Math.max(0.28, baseWeight * 0.75);
  return baseWeight;
}

export function createSession(
  bank: SocialWorkQuestion[],
  progress: ProgressMap,
  random: () => number = Math.random,
  category: SubjectCategory = 'comprehensive',
): SocialWorkQuestion[] {
  const scopedBank = filterQuestionsByCategory(bank, category);
  return createFixedCountSession(scopedBank, progress, random);
}

export function filterQuestionsByCategory(
  bank: SocialWorkQuestion[],
  category: SubjectCategory,
): SocialWorkQuestion[] {
  const subject = SUBJECT_CATEGORIES.find((item) => item.id === category)?.subject;
  if (!subject) return bank;
  return bank.filter((question) => question.subject === subject);
}

export function getCategoryLabel(category: SubjectCategory): string {
  return SUBJECT_CATEGORIES.find((item) => item.id === category)?.label ?? '全科';
}

export function gradeAnswer(
  question: Pick<SocialWorkQuestion, 'questionType' | 'answer'> & Partial<Pick<SocialWorkQuestion, 'options'>>,
  selectedAnswer: unknown,
): boolean {
  if (question.questionType === 'multiple') {
    if (!Array.isArray(question.answer) || !Array.isArray(selectedAnswer)) return false;
    const expected = [...question.answer].map((item) => normalizeAnswerValue(question, item)).sort();
    const actual = [...selectedAnswer].map((item) => normalizeAnswerValue(question, item)).sort();
    return expected.length === actual.length && expected.every((item, index) => item === actual[index]);
  }
  return normalizeAnswerValue(question, selectedAnswer) === normalizeAnswerValue(question, question.answer);
}

export function updateProgressAfterAnswer(
  current: ProgressRow | undefined,
  isCorrect: boolean,
  answeredAt = Date.now(),
): ProgressRow {
  const previous = current ?? {
    attempts: 0,
    correct: 0,
    wrong: 0,
    streakCorrect: 0,
    lastAnsweredAt: 0,
  };
  return {
    attempts: previous.attempts + 1,
    correct: previous.correct + (isCorrect ? 1 : 0),
    wrong: previous.wrong + (isCorrect ? 0 : 1),
    streakCorrect: isCorrect ? previous.streakCorrect + 1 : 0,
    lastAnsweredAt: answeredAt,
  };
}

function pickWeightedKnowledgePoint(
  groups: Map<string, SocialWorkQuestion[]>,
  count: number,
  progress: ProgressMap,
  random: () => number,
  now = Date.now(),
): SocialWorkQuestion[] {
  const pool = [...groups.entries()];
  const selected: SocialWorkQuestion[] = [];

  while (selected.length < count) {
    const totalWeight = pool.reduce((sum, [knowledgePointId]) => (
      sum + calculateWeight(progress[knowledgePointId], now)
    ), 0);
    let cursor = random() * totalWeight;
    let pickedIndex = pool.length - 1;

    for (let index = 0; index < pool.length; index += 1) {
      cursor -= calculateWeight(progress[pool[index][0]], now);
      if (cursor <= 0) {
        pickedIndex = index;
        break;
      }
    }
    const [, questions] = pool.splice(pickedIndex, 1)[0];
    selected.push(pickQuestionVariant(questions, random));
  }

  return selected;
}

function createFixedCountSession(
  bank: SocialWorkQuestion[],
  progress: ProgressMap,
  random: () => number,
): SocialWorkQuestion[] {
  if (bank.length === 0) {
    throw new Error('该大类暂无题目');
  }
  const selectedKnowledgePoints = new Set<string>();
  const session: SocialWorkQuestion[] = [];

  for (const [type, count] of Object.entries(QUESTION_COUNTS) as Array<[QuestionType, number]>) {
    const groups = groupQuestionsByKnowledgePoint(
      bank.filter((question) => question.questionType === type && !selectedKnowledgePoints.has(question.knowledgePointId)),
    );
    if (groups.size < count) {
      throw new Error(`题库中 ${typeLabelForError(type)} 类型的独立知识点不足`);
    }

    const picked = pickWeightedKnowledgePoint(groups, count, progress, random);
    for (const question of picked) {
      selectedKnowledgePoints.add(question.knowledgePointId);
      session.push(question);
    }
  }

  return shuffle(session, random);
}

function groupQuestionsByKnowledgePoint(candidates: SocialWorkQuestion[]): Map<string, SocialWorkQuestion[]> {
  const groups = new Map<string, SocialWorkQuestion[]>();
  for (const question of candidates) {
    const rows = groups.get(question.knowledgePointId) ?? [];
    rows.push(question);
    groups.set(question.knowledgePointId, rows);
  }
  return groups;
}

function pickQuestionVariant(questions: SocialWorkQuestion[], random: () => number): SocialWorkQuestion {
  const index = Math.floor(random() * questions.length);
  return questions[index];
}

function typeLabelForError(type: QuestionType): string {
  return type === 'single' ? '单选' : '多选';
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function normalizeAnswerValue(
  question: Partial<Pick<SocialWorkQuestion, 'options'>>,
  value: unknown,
): string {
  const option = question.options?.find((item) => String(item.id) === String(value));
  return option ? String(option.text) : String(value);
}
