import React, { useEffect, useMemo, useState } from 'react';
import { BookMarked, BookOpen, CheckCircle2, LogOut, XCircle } from 'lucide-react';
import {
  QUESTION_COUNTS,
  SUBJECT_CATEGORIES,
  createSession,
  filterQuestionsByCategory,
  getCategoryLabel,
  gradeAnswer,
  updateProgressAfterAnswer,
  type ProgressMap,
  type SocialWorkQuestion,
  type SubjectCategory,
} from './quiz-engine';
import {
  clearStoredAuth,
  fetchMistakes,
  fetchProgress,
  fetchQuestions,
  loadStoredAuth,
  loginLearner,
  recordAnswer,
  saveStoredAuth,
  type MistakeBookItem,
  type StudyLearner,
} from './social-work-api';

type Mode = 'home' | 'quiz' | 'result' | 'mistakes';

interface AnswerRecord {
  question: SocialWorkQuestion;
  selectedAnswer: unknown;
  isCorrect: boolean;
}

export const SocialWorkStudyPage: React.FC = () => {
  const [questions, setQuestions] = useState<SocialWorkQuestion[]>([]);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [mistakes, setMistakes] = useState<MistakeBookItem[]>([]);
  const [learner, setLearner] = useState<StudyLearner | null>(null);
  const [token, setToken] = useState('');
  const [mode, setMode] = useState<Mode>('home');
  const [session, setSession] = useState<SocialWorkQuestion[]>([]);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selected, setSelected] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const [lastResult, setLastResult] = useState<AnswerRecord | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<SubjectCategory>('comprehensive');
  const [activeCategory, setActiveCategory] = useState<SubjectCategory>('comprehensive');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function bootstrap() {
      try {
        const stored = loadStoredAuth();
        if (!active) return;
        if (stored) {
          const [questionRows, progressRows] = await Promise.all([
            fetchQuestions(stored.token),
            fetchProgress(stored.token),
          ]);
          const mistakeRows = await fetchMistakes(stored.token);
          if (!active) return;
          setQuestions(questionRows);
          setLearner(stored.learner);
          setToken(stored.token);
          setProgress(progressRows);
          setMistakes(mistakeRows);
        }
      } catch (err) {
        clearStoredAuth();
        setError(err instanceof Error ? err.message : '加载失败');
      } finally {
        if (active) setLoading(false);
      }
    }
    bootstrap();
    return () => { active = false; };
  }, []);

  const stats = useMemo(() => {
    const rows = Object.values(progress);
    const attempts = rows.reduce((sum, item) => sum + item.attempts, 0);
    const correct = rows.reduce((sum, item) => sum + item.correct, 0);
    const weak = rows.filter((item) => item.wrong > 0 && item.streakCorrect < 2).length;
    return {
      attempts,
      accuracy: attempts === 0 ? 0 : Math.round((correct / attempts) * 100),
      weak,
    };
  }, [progress]);

  async function handleAuth(displayName: string, studyCode: string) {
    setError('');
    const payload = await loginLearner(displayName, studyCode);
    const questionRows = await fetchQuestions(payload.token);
    const mistakeRows = await fetchMistakes(payload.token);
    setQuestions(questionRows);
    setLearner(payload.learner);
    setToken(payload.token);
    setProgress(payload.progress);
    setMistakes(mistakeRows);
    saveStoredAuth(payload.token, payload.learner);
  }

  function startQuiz(category = selectedCategory, nextSession?: SocialWorkQuestion[]) {
    const sessionRows = nextSession ?? createSession(questions, progress, Math.random, category);
    setSession(sessionRows);
    setAnswers([]);
    setCurrentIndex(0);
    setSelected(null);
    setSubmitted(false);
    setLastResult(null);
    setActiveCategory(category);
    setMode('quiz');
  }

  async function submitAnswer() {
    const question = session[currentIndex];
    if (!question || !hasSelection(question, selected)) return;

    const isCorrect = gradeAnswer(question, selected);
    const answeredAt = Date.now();
    const localProgress = {
      ...progress,
      [question.knowledgePointId]: updateProgressAfterAnswer(progress[question.knowledgePointId], isCorrect, answeredAt),
    };
    const result = { question, selectedAnswer: selected, isCorrect };

    setProgress(localProgress);
    setLastResult(result);
    setAnswers((items) => [...items, result]);
    setSubmitted(true);
    try {
      setProgress(await recordAnswer(token, {
        questionId: question.id,
        knowledgePointId: question.knowledgePointId,
        questionType: question.questionType,
        selectedAnswer: selected,
        correctAnswer: question.answer,
        isCorrect,
        answeredAt,
      }));
      setMistakes(await fetchMistakes(token));
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存答题记录失败');
    }
  }

  function nextQuestion() {
    if (currentIndex >= session.length - 1) {
      setMode('result');
      return;
    }
    setCurrentIndex((value) => value + 1);
    setSelected(null);
    setSubmitted(false);
    setLastResult(null);
  }

  function toggleOption(question: SocialWorkQuestion, optionId: string | boolean) {
    if (submitted) return;
    if (question.questionType === 'multiple') {
      const selectedSet = new Set(Array.isArray(selected) ? selected.map(String) : []);
      const key = String(optionId);
      if (selectedSet.has(key)) selectedSet.delete(key);
      else selectedSet.add(key);
      setSelected([...selectedSet]);
      return;
    }
    setSelected(optionId);
  }

  if (loading) {
    return <PageFrame><div className="p-6 text-neutral-600">题库加载中...</div></PageFrame>;
  }

  return (
    <PageFrame>
      {error && (
        <div className="mx-auto mt-4 max-w-3xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}
      {!learner ? (
        <AuthPanel onSubmit={handleAuth} />
      ) : mode === 'quiz' ? (
        <QuizPanel
          question={session[currentIndex]}
          currentIndex={currentIndex}
          total={session.length}
          selected={selected}
          submitted={submitted}
          lastResult={lastResult}
          onSelect={toggleOption}
          onSubmit={submitAnswer}
          onNext={nextQuestion}
          onQuit={() => setMode('home')}
        />
      ) : mode === 'result' ? (
        <ResultPanel
          answers={answers}
          onRestart={() => startQuiz()}
          onRetryWrong={(wrongQuestions) => startQuiz(activeCategory, wrongQuestions)}
          onHome={() => setMode('home')}
          category={activeCategory}
        />
      ) : mode === 'mistakes' ? (
        <MistakesPanel
          mistakes={mistakes}
          onPractice={(wrongQuestions) => startQuiz(selectedCategory, wrongQuestions)}
          onHome={() => setMode('home')}
        />
      ) : (
        <HomePanel
          learner={learner}
          questions={questions}
          stats={stats}
          mistakeCount={mistakes.length}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          onStart={() => startQuiz()}
          onOpenMistakes={() => setMode('mistakes')}
          onLogout={() => {
            clearStoredAuth();
            setLearner(null);
            setToken('');
            setProgress({});
            setMistakes([]);
          }}
        />
      )}
    </PageFrame>
  );
};

const PageFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-[#f6f7f2] text-neutral-900">
    {children}
  </div>
);

const AuthPanel: React.FC<{
  onSubmit: (displayName: string, studyCode: string) => Promise<void>;
}> = ({ onSubmit }) => {
  const [displayName, setDisplayName] = useState('');
  const [studyCode, setStudyCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  async function submit() {
    setBusy(true);
    setAuthError('');
    try {
      await onSubmit(displayName, studyCode);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-8">
      <section className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-6 shadow-sm">
        <p className="mb-2 text-sm font-bold text-emerald-700">社工中级</p>
        <h1 className="text-3xl font-black tracking-normal">记忆刷题</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          仅限授权用户使用。登录后答题记录会保存到服务器，换设备也能继续。
        </p>
        <div className="mt-6 space-y-3">
          {authError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {authError}
            </div>
          )}
          <input
            className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-base"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="用户名"
          />
          <input
            className="h-12 w-full rounded-lg border border-neutral-300 px-3 text-base"
            value={studyCode}
            onChange={(event) => setStudyCode(event.target.value)}
            placeholder="密码"
            type="password"
          />
          <button
            type="button"
            className="h-12 w-full rounded-lg bg-emerald-700 font-bold text-white disabled:opacity-50"
            disabled={busy || !displayName || studyCode.length < 4}
            onClick={submit}
          >
            登录
          </button>
        </div>
      </section>
    </main>
  );
};

const HomePanel: React.FC<{
  learner: StudyLearner;
  questions: SocialWorkQuestion[];
  stats: { attempts: number; accuracy: number; weak: number };
  mistakeCount: number;
  selectedCategory: SubjectCategory;
  onSelectCategory: (category: SubjectCategory) => void;
  onStart: () => void;
  onOpenMistakes: () => void;
  onLogout: () => void;
}> = ({ learner, questions, stats, mistakeCount, selectedCategory, onSelectCategory, onStart, onOpenMistakes, onLogout }) => {
  const scopedQuestions = filterQuestionsByCategory(questions, selectedCategory);
  const knowledgePointCount = new Set(scopedQuestions.map((question) => question.knowledgePointId)).size;
  const roundTitle = `${getCategoryLabel(selectedCategory)}练习 50 题`;
  const roundMeta = `${QUESTION_COUNTS.single} 单选 · ${QUESTION_COUNTS.multiple} 多选 · ${knowledgePointCount} 个知识点 · ${scopedQuestions.length} 道题`;

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6">
      <section className="flex items-center justify-between rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
        <div>
          <p className="text-sm font-bold text-emerald-700">{learner.displayName}</p>
          <h1 className="mt-1 text-3xl font-black tracking-normal">社工记忆刷题</h1>
        </div>
        <button type="button" className="rounded-lg border border-neutral-300 p-3" onClick={onLogout} aria-label="退出登录">
          <LogOut size={18} />
        </button>
      </section>
      <section className="mt-4 grid grid-cols-3 gap-2">
        <StatCard value={stats.attempts} label="已答" />
        <StatCard value={`${stats.accuracy}%`} label="正确率" />
        <StatCard value={mistakeCount} label="错题本" />
      </section>
      <section className="mt-4 rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
        <p className="text-sm font-bold text-emerald-700">选择大类</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {SUBJECT_CATEGORIES.map((category) => {
            const rows = filterQuestionsByCategory(questions, category.id);
            const selected = selectedCategory === category.id;
            return (
              <button
                key={category.id}
                type="button"
                className={[
                  'min-h-14 rounded-lg border px-2 py-2 text-center',
                  selected ? 'border-emerald-700 bg-emerald-50 text-emerald-800' : 'border-neutral-200 bg-white dark:bg-neutral-800 text-neutral-700',
                ].join(' ')}
                onClick={() => onSelectCategory(category.id)}
              >
                <strong className="block text-base">{category.label}</strong>
                <span className="mt-1 block text-xs">{rows.length} 题</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="mt-4 rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <BookMarked className="text-amber-700" size={24} />
          <div>
            <h2 className="text-lg font-black">自动错题本</h2>
            <p className="text-sm text-neutral-600">{mistakeCount} 个知识点需要回炉，连续答对两次后自动移出</p>
          </div>
        </div>
        <button
          type="button"
          className="mt-5 h-12 w-full rounded-lg border border-neutral-300 bg-white dark:bg-neutral-800 font-bold disabled:opacity-50"
          disabled={mistakeCount === 0}
          onClick={onOpenMistakes}
        >
          查看错题本
        </button>
      </section>
      <section className="mt-4 rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <BookOpen className="text-emerald-700" size={24} />
          <div>
            <h2 className="text-lg font-black">{roundTitle}</h2>
            <p className="text-sm text-neutral-600">{roundMeta}</p>
          </div>
        </div>
        <button
          type="button"
          className="mt-5 h-12 w-full rounded-lg bg-emerald-700 font-bold text-white disabled:opacity-50"
          disabled={scopedQuestions.length === 0}
          onClick={onStart}
        >
          开始练习
        </button>
      </section>
    </main>
  );
};

const MistakesPanel: React.FC<{
  mistakes: MistakeBookItem[];
  onPractice: (wrongQuestions: SocialWorkQuestion[]) => void;
  onHome: () => void;
}> = ({ mistakes, onPractice, onHome }) => {
  const wrongQuestions = mistakes.map((item) => item.question);
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6">
      <section className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-6 shadow-sm">
        <p className="text-sm font-bold text-amber-700">自动错题本</p>
        <h1 className="mt-1 text-3xl font-black tracking-normal">待巩固知识点</h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          答错后自动进入错题本，后续练习会提高抽中权重；同一知识点连续答对两次后自动移出。
        </p>
        <button
          type="button"
          className="mt-5 h-12 w-full rounded-lg bg-emerald-700 font-bold text-white disabled:opacity-50"
          disabled={wrongQuestions.length === 0}
          onClick={() => onPractice(wrongQuestions)}
        >
          重练错题
        </button>
      </section>
      <section className="mt-4 space-y-3">
        {mistakes.length === 0 ? (
          <div className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 text-sm text-neutral-600">
            暂无错题。
          </div>
        ) : mistakes.map((item) => (
          <article key={item.knowledgePointId} className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold text-amber-700">{item.question.examCategory ?? item.question.subject}</p>
                <h2 className="mt-1 text-lg font-black">{item.question.title}</h2>
              </div>
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-bold text-amber-800">
                错 {item.wrong} 次
              </span>
            </div>
            <p className="mt-2 text-sm leading-6 text-neutral-700">{item.question.explanation}</p>
            <p className="mt-2 text-xs text-neutral-500">
              {formatTrainingFocus(item.question)} · {item.variants} 种问法 · 连对 {item.streakCorrect} 次
            </p>
          </article>
        ))}
      </section>
      <button type="button" className="mt-4 h-12 w-full rounded-lg border border-neutral-300 bg-white dark:bg-neutral-800 font-bold" onClick={onHome}>返回首页</button>
    </main>
  );
};

const QuizPanel: React.FC<{
  question: SocialWorkQuestion;
  currentIndex: number;
  total: number;
  selected: unknown;
  submitted: boolean;
  lastResult: AnswerRecord | null;
  onSelect: (question: SocialWorkQuestion, optionId: string | boolean) => void;
  onSubmit: () => void;
  onNext: () => void;
  onQuit: () => void;
}> = ({ question, currentIndex, total, selected, submitted, lastResult, onSelect, onSubmit, onNext, onQuit }) => (
  <main className="mx-auto min-h-screen w-full max-w-3xl px-4 pb-24 pt-4">
    <header className="sticky top-0 z-10 flex items-center gap-3 bg-[#f6f7f2] py-3">
      <button type="button" className="h-10 w-10 rounded-full border border-neutral-300 bg-white dark:bg-neutral-800" onClick={onQuit}>×</button>
      <div className="flex-1">
        <div className="mb-2 flex justify-between text-sm">
          <span>{typeLabel(question.questionType)} · {question.practiceFocus ?? (question.caseAnalysis ? '案例分析' : '基础能力')}</span>
          <strong>{currentIndex + 1} / {total}</strong>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-200">
          <span className="block h-full bg-emerald-700" style={{ width: `${(currentIndex / total) * 100}%` }} />
        </div>
      </div>
    </header>
    <section className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
      <p className="text-sm font-bold text-emerald-700">{question.subject}</p>
      <h1 className="mt-2 text-2xl font-black leading-snug tracking-normal">{question.question}</h1>
      <p className="mt-3 text-sm text-neutral-600">{question.title}</p>
    </section>
    <section className="mt-3 space-y-2">
      {question.options.map((option) => {
        const selectedThis = isSelected(question, selected, option.id);
        const correctThis = submitted && isCorrectOption(question, option.id);
        const wrongThis = submitted && selectedThis && !correctThis;
        return (
          <button
            type="button"
            key={String(option.id)}
            className={[
              'grid min-h-[56px] w-full grid-cols-[36px_1fr] items-center gap-3 rounded-lg border bg-white dark:bg-neutral-800 p-3 text-left',
              selectedThis ? 'border-blue-600 ring-1 ring-blue-600' : 'border-neutral-200',
              correctThis ? 'border-emerald-600 bg-emerald-50' : '',
              wrongThis ? 'border-red-500 bg-red-50' : '',
            ].join(' ')}
            disabled={submitted}
            onClick={() => onSelect(question, option.id)}
          >
            <span className={[
              'grid h-9 w-9 place-items-center rounded-full border font-black',
              selectedThis ? 'border-blue-600 bg-blue-600 text-white' : 'border-neutral-200 bg-neutral-100 text-neutral-700',
              correctThis ? 'border-emerald-600 bg-emerald-600 text-white' : '',
              wrongThis ? 'border-red-500 bg-red-500 text-white' : '',
            ].join(' ')}>
              {formatOptionMarker(option.id)}
            </span>
            <strong className="leading-snug">{option.text}</strong>
          </button>
        );
      })}
    </section>
    {submitted && lastResult && (
      <section className="mt-3 rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-4 shadow-sm">
        <div className="flex items-center gap-2">
          {lastResult.isCorrect ? <CheckCircle2 className="text-emerald-700" /> : <XCircle className="text-red-600" />}
          <h2 className="text-lg font-black">{lastResult.isCorrect ? '答对了' : '答错了'}</h2>
        </div>
        <p className="mt-3 text-sm font-bold text-neutral-800">正确答案：{formatAnswer(question)}</p>
        <p className="mt-3 text-sm leading-6 text-neutral-700">{question.explanation}</p>
        <div className="mt-3 space-y-1 text-xs leading-5 text-neutral-500">
          <p>训练定位：{formatTrainingFocus(question)}</p>
          <p>权威依据：{question.sourceAuthority ?? formatLegacySource(question)}</p>
          {question.evidenceNote && <p>{question.evidenceNote}</p>}
        </div>
      </section>
    )}
    <footer className="sticky bottom-0 -mx-4 mt-4 border-t border-neutral-200 bg-[#f6f7f2]/95 px-4 py-3">
      <button
        type="button"
        className="mx-auto block h-12 w-full max-w-3xl rounded-lg bg-emerald-700 font-bold text-white disabled:opacity-50"
        disabled={!submitted && !hasSelection(question, selected)}
        onClick={submitted ? onNext : onSubmit}
      >
        {submitted ? '下一题' : '提交答案'}
      </button>
    </footer>
  </main>
);

const ResultPanel: React.FC<{
  answers: AnswerRecord[];
  onRestart: () => void;
  onRetryWrong: (wrongQuestions: SocialWorkQuestion[]) => void;
  onHome: () => void;
  category: SubjectCategory;
}> = ({ answers, onRestart, onRetryWrong, onHome, category }) => {
  const correct = answers.filter((item) => item.isCorrect).length;
  const accuracy = answers.length === 0 ? 0 : Math.round((correct / answers.length) * 100);
  const wrongRecords = answers.filter((item) => !item.isCorrect);
  const wrongItems = wrongRecords.slice(0, 12);
  const typeStats = (Object.keys(QUESTION_COUNTS) as Array<keyof typeof QUESTION_COUNTS>).map((type) => {
    const rows = answers.filter((item) => item.question.questionType === type);
    const typeCorrect = rows.filter((item) => item.isCorrect).length;
    return { type, total: rows.length, correct: typeCorrect };
  });
  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-6">
      <section className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-6 text-center shadow-sm">
        <p className="text-sm font-bold text-emerald-700">本轮完成</p>
        <h1 className="mt-2 text-6xl font-black text-emerald-700">{accuracy}%</h1>
        <p className="mt-2 text-neutral-600">{getCategoryLabel(category)} · {correct} / {answers.length} 答对</p>
      </section>
      <section className="mt-4 grid grid-cols-2 gap-2">
        {typeStats.map((item) => (
          <StatCard key={item.type} value={`${item.correct}/${item.total}`} label={typeLabel(item.type)} />
        ))}
      </section>
      <section className="mt-4 rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-5 shadow-sm">
        <h2 className="text-lg font-black">错题知识点</h2>
        {wrongItems.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-600">本轮没有错题。</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {wrongItems.map(({ question }) => (
              <li key={question.id} className="rounded-lg border border-neutral-200 p-3">
                <strong>{question.title}</strong>
                <p className="mt-1 text-xs text-neutral-500">{question.subject} · {question.sourceAuthority ?? formatLegacySource(question)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="mt-4 space-y-2">
        <button type="button" className="h-12 w-full rounded-lg bg-emerald-700 font-bold text-white" onClick={onRestart}>再来一轮</button>
        <button
          type="button"
          className="h-12 w-full rounded-lg border border-neutral-300 bg-white dark:bg-neutral-800 font-bold disabled:opacity-50"
          disabled={wrongRecords.length === 0}
          onClick={() => onRetryWrong(wrongRecords.map((item) => item.question))}
        >
          重练错题
        </button>
        <button type="button" className="h-12 w-full rounded-lg border border-neutral-300 bg-white dark:bg-neutral-800 font-bold" onClick={onHome}>返回首页</button>
      </div>
    </main>
  );
};

const StatCard: React.FC<{ value: React.ReactNode; label: string }> = ({ value, label }) => (
  <article className="rounded-lg border border-neutral-200 bg-white dark:bg-neutral-800 p-4 shadow-sm">
    <strong className="block text-2xl font-black">{value}</strong>
    <span className="mt-1 block text-sm text-neutral-600">{label}</span>
  </article>
);

function hasSelection(question: SocialWorkQuestion, selected: unknown): boolean {
  if (question.questionType === 'multiple') return Array.isArray(selected) && selected.length > 0;
  return selected !== null && selected !== undefined;
}

function isSelected(question: SocialWorkQuestion, selected: unknown, optionId: string | boolean): boolean {
  if (question.questionType === 'multiple') {
    return Array.isArray(selected) && selected.map(String).includes(String(optionId));
  }
  return String(selected) === String(optionId);
}

function isCorrectOption(question: SocialWorkQuestion, optionId: string | boolean): boolean {
  const answer = Array.isArray(question.answer) ? question.answer.map(String) : [String(question.answer)];
  const option = question.options.find((item) => String(item.id) === String(optionId));
  return answer.includes(String(optionId)) || (option ? answer.includes(option.text) : false);
}

function formatAnswer(question: SocialWorkQuestion): string {
  const answerValues = Array.isArray(question.answer) ? question.answer : [question.answer];
  return answerValues.map((answer) => {
    const option = question.options.find((item) => String(item.id) === String(answer));
    return option ? option.text : String(answer);
  }).join('；');
}

function formatOptionMarker(optionId: string | boolean): string {
  if (String(optionId) === 'true') return '√';
  if (String(optionId) === 'false') return '×';
  return String(optionId);
}

function typeLabel(type: string): string {
  return {
    single: '单选',
    multiple: '多选',
  }[type] ?? type;
}

function formatTrainingFocus(question: SocialWorkQuestion): string {
  return [question.examCategory, question.practiceFocus].filter(Boolean).join(' · ') || typeLabel(question.questionType);
}

function formatLegacySource(question: SocialWorkQuestion): string {
  return question.sourcePage > 0 ? `${question.source} 第 ${question.sourcePage} 页` : question.source;
}
