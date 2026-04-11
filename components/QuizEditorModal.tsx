import React, { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import Spinner from './ui/Spinner';
import { generateQuizQuestions } from '@lib/services/geminiService';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[]; // 2-4 options
  correctIndex: number;
}

interface QuizEditorModalProps {
  initialTitle: string;
  initialQuestions: QuizQuestion[];
  onClose: () => void;
  onSave: (title: string, questions: QuizQuestion[]) => void;
}

const MAX_QUESTIONS = 10;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 4;

/**
 * Modal UI for authoring a small in-app quiz. Opens from the CourseEditor
 * when a developer clicks "Edit Quiz" on a Quiz-type resource row.
 *
 * Developers can add up to 10 questions, each with 2–4 options and one
 * designated correct answer (radio group). The modal maintains local
 * working state; only on Save does it call back to the parent which
 * persists the result into the resource_link object on the course.
 *
 * Validation on Save:
 *   - at least 1 question
 *   - every question has non-empty text
 *   - every question has at least 2 non-empty options
 *   - every question has a correctIndex pointing at a non-empty option
 */
const QuizEditorModal: React.FC<QuizEditorModalProps> = ({
  initialTitle,
  initialQuestions,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [questions, setQuestions] = useState<QuizQuestion[]>(
    initialQuestions.length > 0 ? initialQuestions : [makeEmptyQuestion()]
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  // --- AI generation state (Gemini 2.5 Flash) ---
  // Developers can describe a topic and auto-generate questions to replace
  // or append to the current set. Key is loaded server-side from
  // Company Setting → Credential Setting via the shared geminiService.
  const [aiTopic, setAiTopic] = useState('');
  const [aiCount, setAiCount] = useState(5);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiMode, setAiMode] = useState<'replace' | 'append'>('replace');
  const [isGenerating, setIsGenerating] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [showAiPanel, setShowAiPanel] = useState(false);

  // Ensure Escape closes the modal and body scroll is locked while it's open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  function makeEmptyQuestion(): QuizQuestion {
    return {
      id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      question: '',
      options: ['', ''],
      correctIndex: 0,
    };
  }

  const addQuestion = () => {
    if (questions.length >= MAX_QUESTIONS) return;
    setQuestions(prev => [...prev, makeEmptyQuestion()]);
  };

  const removeQuestion = (id: string) => {
    if (questions.length <= 1) return; // keep at least 1
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const updateQuestion = (id: string, field: keyof QuizQuestion, value: any) => {
    setQuestions(prev => prev.map(q => (q.id === id ? { ...q, [field]: value } : q)));
  };

  const updateOption = (qid: string, idx: number, value: string) => {
    setQuestions(prev =>
      prev.map(q => {
        if (q.id !== qid) return q;
        const next = [...q.options];
        next[idx] = value;
        return { ...q, options: next };
      })
    );
  };

  const addOption = (qid: string) => {
    setQuestions(prev =>
      prev.map(q => {
        if (q.id !== qid) return q;
        if (q.options.length >= MAX_OPTIONS) return q;
        return { ...q, options: [...q.options, ''] };
      })
    );
  };

  const removeOption = (qid: string, idx: number) => {
    setQuestions(prev =>
      prev.map(q => {
        if (q.id !== qid) return q;
        if (q.options.length <= MIN_OPTIONS) return q;
        const next = q.options.filter((_, i) => i !== idx);
        // Adjust correctIndex if the removed option was the correct one or shifted the index
        let nextCorrect = q.correctIndex;
        if (nextCorrect === idx) nextCorrect = 0;
        else if (nextCorrect > idx) nextCorrect--;
        return { ...q, options: next, correctIndex: nextCorrect };
      })
    );
  };

  const handleGenerateWithAI = async () => {
    if (!aiTopic.trim()) {
      setAiError('Please enter a topic to generate questions about.');
      return;
    }
    setIsGenerating(true);
    setAiError(null);
    try {
      const generated = await generateQuizQuestions(
        aiTopic.trim(),
        aiCount,
        aiInstruction.trim() || undefined
      );
      // Convert to our QuizQuestion shape (add local IDs)
      const nowBase = Date.now();
      const newQuestions: QuizQuestion[] = generated.map((g, i) => ({
        id: `q_${nowBase}_${i}_${Math.random().toString(36).slice(2, 6)}`,
        question: g.question,
        options: g.options,
        correctIndex: g.correctIndex,
      }));
      if (aiMode === 'replace') {
        setQuestions(newQuestions.slice(0, MAX_QUESTIONS));
      } else {
        // Append but cap at MAX_QUESTIONS
        setQuestions(prev => [...prev, ...newQuestions].slice(0, MAX_QUESTIONS));
      }
      // Auto-close the AI panel on success so the developer sees the filled form
      setShowAiPanel(false);
      // Clear any prior validation error — the user will re-validate on Save
      setValidationError(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Failed to generate quiz questions.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSave = () => {
    // Validation
    if (!title.trim()) {
      setValidationError('Please enter a quiz title.');
      return;
    }
    if (questions.length === 0) {
      setValidationError('Please add at least one question.');
      return;
    }
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question.trim()) {
        setValidationError(`Question ${i + 1}: question text is required.`);
        return;
      }
      const nonEmpty = q.options.filter(o => o.trim() !== '');
      if (nonEmpty.length < MIN_OPTIONS) {
        setValidationError(`Question ${i + 1}: at least ${MIN_OPTIONS} non-empty options are required.`);
        return;
      }
      if (q.correctIndex < 0 || q.correctIndex >= q.options.length) {
        setValidationError(`Question ${i + 1}: please select the correct answer.`);
        return;
      }
      if (q.options[q.correctIndex].trim() === '') {
        setValidationError(`Question ${i + 1}: the correct answer points at an empty option.`);
        return;
      }
    }
    setValidationError(null);
    // Trim text and strip trailing empty options before saving
    const cleaned = questions.map(q => ({
      ...q,
      question: q.question.trim(),
      options: q.options.map(o => o.trim()),
    }));
    onSave(title.trim(), cleaned);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
      draggable={false}
      onDragStart={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-3xl w-full my-8 flex flex-col max-h-[90vh]"
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-xl font-bold text-gray-800 dark:text-white">Edit Quiz</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              Up to {MAX_QUESTIONS} questions. Each question can have {MIN_OPTIONS}–{MAX_OPTIONS} options; select the correct answer with the radio button.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1">
          {/* Title */}
          <label className="block text-sm font-semibold text-gray-700 dark:text-gray-200 mb-1">
            Quiz Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Python Basics Quiz"
            className="w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent mb-4"
          />

          {/* --- AI Generation Panel (Gemini 2.5 Flash) --- */}
          <div className="mb-6 rounded-lg border border-purple-200 dark:border-purple-800/60 bg-purple-50/60 dark:bg-purple-900/10">
            <button
              type="button"
              onClick={() => setShowAiPanel(v => !v)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">
                  Generate with AI (Gemini 2.5 Flash)
                </span>
              </div>
              <span className="text-xs text-purple-600 dark:text-purple-400">
                {showAiPanel ? 'Hide ▲' : 'Show ▼'}
              </span>
            </button>

            {showAiPanel && (
              <div className="px-3 pb-3 space-y-3 border-t border-purple-200 dark:border-purple-800/60">
                <div className="pt-3">
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    Topic / Subject
                  </label>
                  <input
                    type="text"
                    value={aiTopic}
                    onChange={(e) => setAiTopic(e.target.value)}
                    placeholder="e.g. Python control structures, React hooks, SQL joins"
                    disabled={isGenerating}
                    className="w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60"
                  />
                </div>

                <div className="flex items-end gap-3">
                  <div className="flex-shrink-0">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                      # Questions
                    </label>
                    <select
                      value={aiCount}
                      onChange={(e) => setAiCount(parseInt(e.target.value, 10))}
                      disabled={isGenerating}
                      className="px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60"
                    >
                      {[3, 5, 7, 10].map(n => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                      Mode
                    </label>
                    <div className="flex gap-2">
                      <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer">
                        <input
                          type="radio"
                          name="ai_mode"
                          value="replace"
                          checked={aiMode === 'replace'}
                          onChange={() => setAiMode('replace')}
                          disabled={isGenerating}
                          className="w-3.5 h-3.5"
                        />
                        Replace existing
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-200 cursor-pointer">
                        <input
                          type="radio"
                          name="ai_mode"
                          value="append"
                          checked={aiMode === 'append'}
                          onChange={() => setAiMode('append')}
                          disabled={isGenerating}
                          className="w-3.5 h-3.5"
                        />
                        Append to list
                      </label>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">
                    Additional Instructions (optional)
                  </label>
                  <textarea
                    value={aiInstruction}
                    onChange={(e) => setAiInstruction(e.target.value)}
                    rows={2}
                    placeholder="e.g. Focus on beginners, include code snippets, avoid trivia"
                    disabled={isGenerating}
                    className="w-full px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 resize-none"
                  />
                </div>

                {aiError && (
                  <div className="p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-300">
                    {aiError}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 flex-1">
                    Uses the Gemini API key from <strong>Company Setting → Credential Setting</strong>.
                  </p>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleGenerateWithAI}
                    disabled={isGenerating || !aiTopic.trim()}
                  >
                    {isGenerating ? (
                      <div className="flex items-center gap-2">
                        <Spinner size="sm" />
                        Generating…
                      </div>
                    ) : (
                      '✨ Generate Questions'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Questions */}
          <div className="space-y-5">
            {questions.map((q, qi) => (
              <div
                key={q.id}
                className="p-4 rounded-lg bg-gray-50 dark:bg-gray-700/40 border border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-start gap-2 mb-3">
                  <span className="flex-shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-bold">
                    {qi + 1}
                  </span>
                  <input
                    type="text"
                    value={q.question}
                    onChange={(e) => updateQuestion(q.id, 'question', e.target.value)}
                    placeholder="Enter the question"
                    className="flex-1 px-3 py-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  {questions.length > 1 && (
                    <button
                      onClick={() => removeQuestion(q.id)}
                      className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                      title="Delete question"
                    >
                      Remove
                    </button>
                  )}
                </div>

                <div className="space-y-2 ml-9">
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`correct_${q.id}`}
                        checked={q.correctIndex === oi}
                        onChange={() => updateQuestion(q.id, 'correctIndex', oi)}
                        className="w-4 h-4 text-green-600 focus:ring-green-500"
                        title="Mark as correct answer"
                      />
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => updateOption(q.id, oi, e.target.value)}
                        placeholder={`Option ${oi + 1}`}
                        className={`flex-1 px-2.5 py-1.5 text-sm rounded-md border focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white ${
                          q.correctIndex === oi
                            ? 'border-green-400 dark:border-green-600 bg-green-50/30 dark:bg-green-900/10'
                            : 'border-gray-300 dark:border-gray-600'
                        }`}
                      />
                      {q.options.length > MIN_OPTIONS && (
                        <button
                          onClick={() => removeOption(q.id, oi)}
                          className="text-xs text-gray-400 hover:text-red-500 px-1"
                          title="Remove option"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                  {q.options.length < MAX_OPTIONS && (
                    <button
                      onClick={() => addOption(q.id)}
                      className="text-xs text-blue-500 hover:text-blue-700 mt-1"
                    >
                      + Add option
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add question */}
          {questions.length < MAX_QUESTIONS && (
            <Button variant="outline" size="sm" onClick={addQuestion} className="mt-4">
              + Add Question ({questions.length}/{MAX_QUESTIONS})
            </Button>
          )}

          {/* Validation error */}
          {validationError && (
            <div className="mt-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {validationError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2 flex-shrink-0">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>Save Quiz</Button>
        </div>
      </div>
    </div>
  );
};

export default QuizEditorModal;
