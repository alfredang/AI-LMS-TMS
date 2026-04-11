import React, { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import Spinner from './ui/Spinner';

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
}

interface QuizTakerModalProps {
  title: string;
  questions: QuizQuestion[];
  userId: string;
  courseId: string;
  quizId: string;
  // Optional previous best score for this learner on this quiz, shown at
  // the top of the modal so they can see what they're aiming to beat.
  previousScore?: { score: number; total: number } | null;
  onClose: () => void;
  // Called after a successful submission so the parent can refresh its
  // local "latest attempt" state and re-render the score label on the card.
  onSubmitted?: (result: { score: number; total: number }) => void;
}

type BreakdownItem = {
  questionId: string;
  correct: boolean;
  correctIndex: number;
  selectedIndex: number | null;
};

/**
 * Learner-facing quiz dialog. Opens when the learner clicks "Take Quiz"
 * on a Quiz-type resource link in the Course Detail view.
 *
 * Flow:
 *   1. Show each question with its options. Learner picks one per question.
 *   2. Submit button disabled until every question has an answer.
 *   3. On submit, POST to /api/courses/submit-quiz which scores server-side
 *      and inserts a row into quiz_attempt. The response contains the final
 *      score + a per-question breakdown.
 *   4. Show a result screen with the score and which questions were right/
 *      wrong, with the correct answer highlighted on wrong ones.
 *   5. Closing the result screen bubbles the final score up to the parent
 *      so the course card can show "last score: 7/10" without a refetch.
 */
const QuizTakerModal: React.FC<QuizTakerModalProps> = ({
  title,
  questions,
  userId,
  courseId,
  quizId,
  previousScore,
  onClose,
  onSubmitted,
}) => {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    total: number;
    breakdown: BreakdownItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // One-question-at-a-time navigation state (mirrors Google-Forms style UI).
  // A question is "locked" once the learner clicks Next on it — from then on
  // the options are read-only and the correct/wrong tally badges update.
  // Going Back lets the learner review a locked question but not re-answer.
  const [currentIndex, setCurrentIndex] = useState(0);
  const [lockedResults, setLockedResults] = useState<Record<string, boolean>>({});

  const currentQuestion = questions[currentIndex];
  const currentQid = currentQuestion?.id;
  const currentAnswer = currentQid !== undefined ? answers[currentQid] : undefined;
  const isCurrentLocked = currentQid !== undefined && currentQid in lockedResults;
  const isLastQuestion = currentIndex === questions.length - 1;
  const correctCount = Object.values(lockedResults).filter(Boolean).length;
  const wrongCount = Object.values(lockedResults).filter(v => !v).length;

  // Lock body scroll while modal is open + close on Escape
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

  const handleSelect = (questionId: string, optionIndex: number) => {
    // Selection is only allowed for the currently-visible, not-yet-locked question.
    if (isCurrentLocked) return;
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(i => i - 1);
    }
  };

  // Advance to the next question. Locks the current question's answer into
  // lockedResults (correct/wrong) and bumps the tally badges. If the current
  // question is the last one, trigger submission instead of advancing.
  const handleNext = () => {
    if (!currentQuestion) return;
    // If this question isn't locked yet, lock it now and update the tally.
    if (!isCurrentLocked) {
      const selected = answers[currentQuestion.id];
      if (typeof selected !== 'number') return; // guard
      const wasCorrect = selected === currentQuestion.correctIndex;
      setLockedResults(prev => ({ ...prev, [currentQuestion.id]: wasCorrect }));
    }
    if (isLastQuestion) {
      // Defer submit slightly so the lockedResults state update is visible
      // in the tally before the result screen replaces the card.
      setTimeout(() => { handleSubmit(); }, 0);
      return;
    }
    setCurrentIndex(i => Math.min(i + 1, questions.length - 1));
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/courses/submit-quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, courseId, quizId, answers }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to submit quiz');
      }
      setResult({
        score: data.score,
        total: data.total,
        breakdown: data.breakdown || [],
      });
      onSubmitted?.({ score: data.score, total: data.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit quiz');
    } finally {
      setIsSubmitting(false);
    }
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
        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full my-8 flex flex-col max-h-[90vh]"
        draggable={false}
        onDragStart={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header — quiz title + close */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex-shrink-0 w-8 h-8 rounded-md bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-300 text-sm font-bold">
              ?
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-gray-800 dark:text-white truncate">
                {title || 'Quiz'}
              </h2>
              {previousScore && !result && (
                <p className="text-[11px] text-gray-500 dark:text-gray-400">
                  Previous best: {previousScore.score}/{previousScore.total}
                </p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none p-1 flex-shrink-0"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Progress bar row — segmented progress + counter + tally badges */}
        {!result && (
          <div className="px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex items-center gap-3 flex-shrink-0">
            <div className="flex-1 flex gap-1">
              {questions.map((q, i) => {
                const isLocked = q.id in lockedResults;
                const isCurrent = i === currentIndex;
                return (
                  <div
                    key={q.id}
                    className={`h-1.5 flex-1 rounded-full transition-colors ${
                      isLocked
                        ? 'bg-blue-500 dark:bg-blue-400'
                        : isCurrent
                          ? 'bg-blue-300 dark:bg-blue-700'
                          : 'bg-gray-200 dark:bg-gray-700'
                    }`}
                  />
                );
              })}
            </div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {currentIndex + 1} / {questions.length}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
              <span>×</span>
              <span>{wrongCount}</span>
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
              <span>✓</span>
              <span>{correctCount}</span>
            </span>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 overflow-y-auto flex-1">
          {/* Result screen */}
          {result ? (
            <div>
              <div className="text-center mb-6">
                <div className={`inline-flex items-center justify-center w-20 h-20 rounded-full mb-3 ${
                  result.score === result.total
                    ? 'bg-green-100 dark:bg-green-900/40'
                    : result.score >= Math.ceil(result.total * 0.5)
                      ? 'bg-yellow-100 dark:bg-yellow-900/40'
                      : 'bg-red-100 dark:bg-red-900/40'
                }`}>
                  <span className={`text-2xl font-bold ${
                    result.score === result.total
                      ? 'text-green-700 dark:text-green-300'
                      : result.score >= Math.ceil(result.total * 0.5)
                        ? 'text-yellow-700 dark:text-yellow-300'
                        : 'text-red-700 dark:text-red-300'
                  }`}>
                    {result.score}/{result.total}
                  </span>
                </div>
                <p className="text-base font-semibold text-gray-800 dark:text-white">
                  {result.score === result.total
                    ? '🎉 Perfect score!'
                    : result.score >= Math.ceil(result.total * 0.5)
                      ? 'Good effort!'
                      : 'Keep learning and try again'}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  Your score has been saved.
                </p>
              </div>

              {/* Per-question breakdown */}
              <div className="space-y-3">
                {questions.map((q, qi) => {
                  const b = result.breakdown.find(x => x.questionId === q.id);
                  const wasCorrect = b?.correct;
                  const selectedIdx = b?.selectedIndex ?? null;
                  const correctIdx = b?.correctIndex ?? q.correctIndex;
                  return (
                    <div
                      key={q.id}
                      className={`p-3 rounded-lg border ${
                        wasCorrect
                          ? 'border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-900/10'
                          : 'border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/10'
                      }`}
                    >
                      <div className="flex items-start gap-2 mb-2">
                        <span className={`flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                          wasCorrect
                            ? 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
                            : 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                        }`}>
                          {wasCorrect ? '✓' : '✗'}
                        </span>
                        <p className="text-sm font-semibold text-gray-800 dark:text-white">
                          {qi + 1}. {q.question}
                        </p>
                      </div>
                      <div className="ml-8 space-y-1 text-xs">
                        {q.options.map((opt, oi) => {
                          const isCorrect = oi === correctIdx;
                          const isSelected = oi === selectedIdx;
                          return (
                            <div
                              key={oi}
                              className={`px-2 py-1 rounded ${
                                isCorrect
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 font-semibold'
                                  : isSelected
                                    ? 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 line-through'
                                    : 'text-gray-600 dark:text-gray-400'
                              }`}
                            >
                              {isCorrect && '✓ '}
                              {isSelected && !isCorrect && '✗ '}
                              {opt}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : currentQuestion ? (
            // Single-question view (Google-Forms style)
            <div>
              <div className="flex items-start gap-3 mb-6">
                <span className="flex-shrink-0 text-base font-semibold text-gray-500 dark:text-gray-400">
                  {currentIndex + 1}.
                </span>
                <p className="text-base font-medium text-gray-800 dark:text-white flex-1 leading-relaxed">
                  {currentQuestion.question}
                </p>
              </div>
              <div className="space-y-3">
                {currentQuestion.options.map((opt, oi) => {
                  const isSelected = currentAnswer === oi;
                  const letter = String.fromCharCode(65 + oi); // A, B, C, D
                  return (
                    <button
                      key={oi}
                      type="button"
                      onClick={() => handleSelect(currentQuestion.id, oi)}
                      disabled={isCurrentLocked}
                      className={`w-full text-left flex items-center gap-4 px-4 py-3.5 rounded-xl border transition-all ${
                        isSelected
                          ? 'border-blue-500 dark:border-blue-500 bg-blue-50 dark:bg-blue-900/20 ring-2 ring-blue-200 dark:ring-blue-900/40'
                          : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40 hover:border-gray-400 dark:hover:border-gray-500'
                      } ${isCurrentLocked ? 'cursor-default opacity-90' : 'cursor-pointer'}`}
                    >
                      <span
                        className={`flex-shrink-0 text-sm font-bold w-6 ${
                          isSelected
                            ? 'text-blue-600 dark:text-blue-300'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {letter}.
                      </span>
                      <span className="text-sm text-gray-800 dark:text-gray-200 flex-1">
                        {opt}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {error && (
            <div className="mt-4 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}
        </div>

        {/* Footer — Back / Cancel / Next or Submit */}
        <div className="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between gap-2 flex-shrink-0">
          {result ? (
            <div className="w-full flex justify-end">
              <Button variant="primary" onClick={onClose}>Close</Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={handleBack}
                disabled={currentIndex === 0 || isSubmitting}
              >
                Back
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleNext}
                  disabled={
                    isSubmitting ||
                    (!isCurrentLocked && typeof currentAnswer !== 'number')
                  }
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      Submitting…
                    </div>
                  ) : isLastQuestion ? (
                    'Submit'
                  ) : (
                    'Next'
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default QuizTakerModal;
