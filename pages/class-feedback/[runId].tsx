import React from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { ClassFeedbackView } from '@components/trainer/ClassFeedbackView';

/**
 * Standalone Post Course Feedback page (/class-feedback/<course_run uuid>), opened from the class
 * page by staff views. Trainers see the same view inside the app, with Back to Class.
 */
export default function ClassFeedbackPage() {
  const router = useRouter();
  const runId = typeof router.query.runId === 'string' ? router.query.runId : '';
  return (
    <div className="min-h-screen bg-background text-on-surface">
      <Head>
        <title>Post Course Feedback</title>
      </Head>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <ClassFeedbackView runId={runId} ready={router.isReady} />
      </div>
    </div>
  );
}
