import React from 'react';
import { useLms } from '@contexts/LmsContext';
import { TrainerPage } from '@app-types';
import { Icon, IconName } from '@components/ui/Icon';

interface GuideCard {
  page: TrainerPage;
  title: string;
  description: string;
  icon: IconName;
}

const CARDS: GuideCard[] = [
  {
    page: TrainerPage.LessonDeliveryGuide,
    title: 'Physical Class Guide',
    description: 'Best practices for delivering in-person classroom training, from preparation to wrap-up.',
    icon: IconName.BookOpen,
  },
  {
    page: TrainerPage.VirtualClassGuide,
    title: 'Virtual Class Guide',
    description: 'Tips and tools for running engaging virtual training sessions over video conferencing.',
    icon: IconName.Video,
  },
  {
    page: TrainerPage.AssessmentGuide,
    title: 'Assessment Guide',
    description: 'How to design, deliver, and grade learner assessments aligned with WSQ/IBF standards.',
    icon: IconName.Award,
  },
];

const TrainerGuidesPage: React.FC = () => {
  const { setTrainerPage } = useLms();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-on-surface">Trainer Guides</h1>
        <p className="mt-1 text-sm text-muted">
          Reference materials to help you deliver high-quality training.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {CARDS.map(({ page, title, description, icon }) => (
          <button
            key={page}
            onClick={() => setTrainerPage(page)}
            className="group text-left bg-surface border border-default rounded-2xl p-5 hover:border-primary/50 hover:shadow-md transition-all duration-150"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                <Icon name={icon} className="w-5 h-5 text-primary" />
              </div>
              <h2 className="text-base font-semibold text-on-surface">{title}</h2>
            </div>
            <p className="text-sm text-muted leading-relaxed">{description}</p>
            <div className="mt-4 flex items-center gap-1 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
              <span>Open guide</span>
              <Icon name={IconName.ChevronDown} className="w-4 h-4 -rotate-90" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default TrainerGuidesPage;
