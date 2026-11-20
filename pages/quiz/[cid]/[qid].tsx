import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { useLms } from '@contexts/LmsContext';
import LoginScreen from '@components/LoginScreen';
import QuizTakerModal, { QuizQuestion } from '@components/QuizTakerModal';
import { Spinner } from '@components/ui';

// The page behind a quiz QR code (shown full screen by the trainer from a Quiz
// asset on the course page). The learner signs in with their usual account and
// takes the quiz; the score is saved to their course record. On a phone with
// the mobile app installed the same link opens in the app instead (app links).
//
// The route params are `cid`/`qid`, not `courseId`: LmsContext reads
// `courseId` from the URL to select a course in the main app.

interface QuizInfo {
  id: string;
  courseId: string;
  title: string;
  courseTitle: string;
  courseCode: string | null;
  questions: QuizQuestion[];
}

export default function QuizPage() {
  const router = useRouter();
  const { isAuthenticated, isLoading, currentUser, trainingProviderProfile } = useLms();
  const courseId = typeof router.query.cid === 'string' ? router.query.cid : '';
  const quizId = typeof router.query.qid === 'string' ? router.query.qid : '';

  const [quiz, setQuiz] = useState<QuizInfo | null>(null);
  const [last, setLast] = useState<{ score: number; total: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [justFinished, setJustFinished] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !courseId || !quizId) return;
    let stop = false;
    setLoadError(null);
    fetch(`/api/courses/quiz?courseId=${encodeURIComponent(courseId)}&quizId=${encodeURIComponent(quizId)}`)
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => {
        if (stop) return;
        if (!ok || !body?.success) {
          setLoadError(body?.error === 'Quiz not found'
            ? 'This quiz is no longer available. Ask your trainer for the latest QR code.'
            : 'The quiz could not be loaded. Please try again.');
          return;
        }
        setQuiz(body.quiz);
        setLast(body.previous ? { score: body.previous.score, total: body.previous.total } : null);
        // First visit goes straight into the quiz; a learner who has already
        // done it sees their score and chooses whether to retake.
        if (!body.previous && body.quiz.questions.length > 0) setTaking(true);
      })
      .catch(() => { if (!stop) setLoadError('The quiz could not be loaded. Please check your connection and try again.'); });
    return () => { stop = true; };
  }, [isAuthenticated, courseId, quizId]);

  const closeTaker = useCallback(() => setTaking(false), []);
  const appTitle = trainingProviderProfile?.companyShortname || 'LMS TMS';
  const pageTitle = quiz ? `${quiz.title} - ${appTitle}` : `Quiz - ${appTitle}`;

  if (isLoading || !router.isReady) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <>
        <Head><title>{`Sign in to take the quiz - ${appTitle}`}</title></Head>
        <div className="bg-info-bg text-info text-center text-sm font-semibold px-4 py-2">
          Sign in to take the quiz. You will come straight back to it.
        </div>
        <LoginScreen />
      </>
    );
  }

  return (
    <>
      <Head><title>{pageTitle}</title></Head>
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="card w-full max-w-md p-6 text-center">
          {loadError ? (
            <>
              <h1 className="text-xl font-bold text-on-surface mb-2">Quiz unavailable</h1>
              <p className="text-on-surface-secondary mb-5">{loadError}</p>
              <button type="button" className="btn btn-outline" onClick={() => router.reload()}>Try again</button>
            </>
          ) : !quiz ? (
            <div className="py-8 flex justify-center"><Spinner size="lg" /></div>
          ) : (
            <>
              <p className="text-sm text-muted mb-1">{quiz.courseTitle}</p>
              <h1 className="text-2xl font-bold text-on-surface mb-1">{quiz.title}</h1>
              <p className="text-on-surface-secondary mb-5">
                {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'}
                {currentUser?.fullName ? ` · ${currentUser.fullName}` : ''}
              </p>
              {quiz.questions.length === 0 ? (
                <p className="text-on-surface-secondary">This quiz has no questions yet.</p>
              ) : (
                <>
                  {last && (
                    <div className="rounded-lg bg-success-bg text-success font-semibold px-4 py-3 mb-5">
                      {justFinished ? 'Quiz submitted. ' : 'Your last score: '}
                      {last.score} / {last.total}
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    <button type="button" className="btn btn-primary w-full" onClick={() => setTaking(true)}>
                      {last ? 'Retake Quiz' : 'Start Quiz'}
                    </button>
                    <button type="button" className="btn btn-outline w-full" onClick={() => router.push('/')}>
                      Go to my courses
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      {taking && quiz && currentUser?.id && (
        <QuizTakerModal
          title={quiz.title}
          questions={quiz.questions}
          userId={currentUser.id}
          courseId={quiz.courseId}
          quizId={quiz.id}
          previousScore={last}
          onClose={closeTaker}
          onSubmitted={(result) => { setLast(result); setJustFinished(true); }}
        />
      )}
    </>
  );
}
