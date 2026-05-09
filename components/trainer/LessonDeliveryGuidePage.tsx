import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

interface Step {
  title: string;
  description: string;
  actor: 'trainer' | 'learner' | 'system';
  icon: IconName;
}

export type LessonDeliveryVariant = 'physical' | 'virtual';

const PHOTO_REMARK = 'All learners must turn on their camera and show their face at all times.';

const BASE_STEPS: Step[] = [
  {
    title: 'E-Attendance in AM for Learners and Trainer',
    description: 'Take electronic attendance in the morning for both learners and trainer to record participation.',
    actor: 'trainer',
    icon: IconName.ClipboardCheck,
  },
  {
    title: 'Ice Breaker and Self Introduction',
    description: 'Conduct an ice breaker activity and facilitate self introductions to build rapport among learners.',
    actor: 'trainer',
    icon: IconName.Users,
  },
  {
    title: 'Follow the Lesson Plan to Deliver the Lesson',
    description: 'Follow the lesson plan to deliver the lesson. Always contextualize the delivery to learners profile.',
    actor: 'trainer',
    icon: IconName.BookOpen,
  },
  {
    title: 'E-Attendance in PM for Learners and Trainer',
    description: 'Take electronic attendance in the afternoon for both learners and trainer to record participation.',
    actor: 'trainer',
    icon: IconName.ClipboardCheck,
  },
  {
    title: 'Get Learners to Fill Up Cert Delivery Form',
    description: 'Have learners complete the Certificate Delivery Form to ensure certificates are sent to the correct address.',
    actor: 'learner',
    icon: IconName.FileText,
  },
  {
    title: 'Get Learners to Fill Up TRAQOM Survey',
    description: 'Have learners complete the TRAQOM survey to provide feedback on the training quality.',
    actor: 'learner',
    icon: IconName.Edit,
  },
  {
    title: 'E-Attendance for Assessment',
    description: 'Take electronic attendance for the assessment session.',
    actor: 'trainer',
    icon: IconName.ClipboardCheck,
  },
  {
    title: 'Start the Assessment',
    description: 'Begin the assessment. Refer to the Assessment Guide for the detailed assessment workflow.',
    actor: 'trainer',
    icon: IconName.Award,
  },
  {
    title: 'Class Ended',
    description: 'The class has concluded. Ensure all administrative tasks are completed.',
    actor: 'system',
    icon: IconName.CheckCircle,
  },
];

const buildSteps = (variant: LessonDeliveryVariant): (Step & { number: number })[] => {
  const steps = [...BASE_STEPS];
  if (variant === 'virtual') {
    const photoStep = (after: string): Step => ({
      title: `Take Class Photo after ${after}`,
      description: `Take a class photo and upload to the assessment folder. ${PHOTO_REMARK}`,
      actor: 'trainer',
      icon: IconName.ClipboardCheck,
    });
    const insertAfter = (title: string, step: Step) => {
      const idx = steps.findIndex((s) => s.title === title);
      steps.splice(idx + 1, 0, step);
    };
    insertAfter('E-Attendance in AM for Learners and Trainer', photoStep('E-Attendance in AM'));
    insertAfter('E-Attendance in PM for Learners and Trainer', photoStep('E-Attendance in PM'));
    insertAfter('E-Attendance for Assessment', photoStep('E-Attendance for Assessment'));
  }
  return steps.map((s, i) => ({ ...s, number: i + 1 }));
};

const actorColors = {
  trainer: {
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800',
    badge: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    iconBg: 'bg-blue-100 dark:bg-blue-900/40',
    iconText: 'text-blue-600 dark:text-blue-400',
    connector: 'border-blue-300 dark:border-blue-700',
    number: 'bg-blue-600 dark:bg-blue-500',
  },
  learner: {
    bg: 'bg-green-50 dark:bg-green-900/20',
    border: 'border-green-200 dark:border-green-800',
    badge: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300',
    iconBg: 'bg-green-100 dark:bg-green-900/40',
    iconText: 'text-green-600 dark:text-green-400',
    connector: 'border-green-300 dark:border-green-700',
    number: 'bg-green-600 dark:bg-green-500',
  },
  system: {
    bg: 'bg-purple-50 dark:bg-purple-900/20',
    border: 'border-purple-200 dark:border-purple-800',
    badge: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    iconBg: 'bg-purple-100 dark:bg-purple-900/40',
    iconText: 'text-purple-600 dark:text-purple-400',
    connector: 'border-purple-300 dark:border-purple-700',
    number: 'bg-purple-600 dark:bg-purple-500',
  },
};

const actorLabels = { trainer: 'Trainer', learner: 'Learner', system: 'System' };

interface LessonDeliveryGuidePageProps {
  variant?: LessonDeliveryVariant;
}

const LessonDeliveryGuidePage: React.FC<LessonDeliveryGuidePageProps> = ({ variant = 'physical' }) => {
  const STEPS = buildSteps(variant);
  const heading = variant === 'virtual' ? 'Virtual Class Lesson Delivery Guide' : 'Physical Class Lesson Delivery Guide';
  const subheading = variant === 'virtual'
    ? 'Step-by-step visual guide on how lessons are delivered in a virtual classroom.'
    : 'Step-by-step visual guide on how lessons are delivered in the classroom.';
  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 dark:border-gray-700 pb-5">
        <h3 className="text-2xl font-bold leading-6 text-gray-900 dark:text-white flex items-center gap-2">
          <Icon name={IconName.BookOpen} className="w-7 h-7" />
          {heading}
        </h3>
        <p className="mt-2 max-w-4xl text-sm text-gray-500 dark:text-gray-400">
          {subheading}
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {(['trainer', 'learner', 'system'] as const).map((actor) => (
          <div key={actor} className="flex items-center gap-2">
            <span className={`inline-block w-3 h-3 rounded-full ${actorColors[actor].number}`} />
            <span className="text-sm text-gray-600 dark:text-gray-400">{actorLabels[actor]}</span>
          </div>
        ))}
      </div>

      {/* Flow Steps */}
      <div className="relative">
        {STEPS.map((step, index) => {
          const colors = actorColors[step.actor];
          const isLast = index === STEPS.length - 1;

          return (
            <div key={step.number} className="relative flex gap-4">
              {/* Vertical connector line + step number */}
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full ${colors.number} text-white flex items-center justify-center text-sm font-bold flex-shrink-0 z-10`}>
                  {step.number}
                </div>
                {!isLast && (
                  <div className="w-0.5 flex-1 bg-gray-200 dark:bg-gray-700 my-1" />
                )}
              </div>

              {/* Step card */}
              <div className={`flex-1 mb-4 rounded-lg border ${colors.border} ${colors.bg} p-4`}>
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-lg ${colors.iconBg} flex-shrink-0`}>
                    <Icon name={step.icon} className={`w-5 h-5 ${colors.iconText}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">{step.title}</h4>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${colors.badge}`}>
                        {actorLabels[step.actor]}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{step.description}</p>
                  </div>
                </div>

                {/* Arrow indicator for flow direction */}
                {!isLast && (
                  <div className="flex justify-center mt-2">
                    <Icon name={IconName.ChevronDown} className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LessonDeliveryGuidePage;
