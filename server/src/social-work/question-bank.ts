import { readFileSync } from 'node:fs';
import { getSocialWorkQuestionBankPath } from '../config/paths.js';

export interface SocialWorkQuestion {
  id: string;
  knowledgePointId: string;
  variantId?: string;
  subject: string;
  title: string;
  questionType: 'single' | 'multiple';
  questionStyle?: string;
  difficulty?: '基础' | '提高' | '易错' | '案例';
  question: string;
  options: Array<{ id: string | boolean; text: string }>;
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

let cachedBank: SocialWorkQuestion[] | null = null;

export function loadSocialWorkQuestionBank(): SocialWorkQuestion[] {
  if (cachedBank) {
    return cachedBank;
  }
  cachedBank = JSON.parse(readFileSync(getSocialWorkQuestionBankPath(), 'utf8')) as SocialWorkQuestion[];
  return cachedBank;
}
