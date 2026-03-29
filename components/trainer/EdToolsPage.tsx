import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const ED_TOOLS = [
  {
    title: 'Ice Breaker',
    description: 'Fun ice breaker activities to engage learners',
    icon: IconName.Users,
    href: 'https://alfredang.github.io/ice-breaker/',
  },
  {
    title: 'Pinboard',
    description: 'Collaborative pinboard for sharing ideas and resources',
    icon: IconName.Bookmark,
    href: 'https://alfredang.github.io/pinboard/',
  },
  {
    title: 'Break Timer',
    description: 'Musical countdown timer for class breaks',
    icon: IconName.Clock,
    href: 'https://alfredang.github.io/musical-timer-countdown/',
  },
  {
    title: 'Word Cloud',
    description: 'Generate word clouds from learner responses in real time',
    icon: IconName.Cloud,
    href: 'https://alfredang.github.io/wordcloud/',
  },
  {
    title: 'Live Q&A',
    description: 'Real-time question and answer board for classroom interaction',
    icon: IconName.Help,
    href: 'https://alfredang.github.io/live-qna/',
  },
  {
    title: 'Whiteboard',
    description: 'Interactive whiteboard for drawing and annotations',
    icon: IconName.Edit,
    href: 'https://alfredang.github.io/whiteboard/',
  },
  {
    title: 'Collaborative Note',
    description: 'Shared notes for real-time collaboration in class',
    icon: IconName.FileText,
    href: 'https://alfredang.github.io/collabnote/',
  },
  {
    title: 'Collaborative Kanban',
    description: 'Shared kanban board for organizing tasks and ideas',
    icon: IconName.ClipboardCheck,
    href: 'https://alfredang.github.io/kanban/',
  },
  {
    title: 'Live Poll',
    description: 'Real-time polling and voting for classroom engagement',
    icon: IconName.ClipboardCheck,
    href: 'https://alfredang.github.io/livepoll/',
  },
  {
    title: 'Spinning Wheel',
    description: 'Random selection spinner for classroom activities',
    icon: IconName.Spinner,
    href: 'https://alfredang.github.io/spinning-wheel/',
  },
  {
    title: 'Google Meet',
    description: 'Start or join a video meeting with learners',
    icon: IconName.Video,
    href: 'https://meet.google.com/landing',
  },
];

const EdToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Ed Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {ED_TOOLS.map(tool => (
          <a
            key={tool.title}
            href={tool.href}
            target="_blank"
            rel="noopener noreferrer"
            className="block"
          >
            <Card className="p-6 flex flex-col text-center items-center dark:bg-gray-800 dark:border-gray-700 hover:shadow-lg transition-shadow cursor-pointer h-full">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-3">
                <Icon name={tool.icon} className="w-6 h-6 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2 dark:text-white">{tool.title}</h3>
              <p className="text-gray-600 dark:text-gray-300 text-sm flex-grow">{tool.description}</p>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
};

export default EdToolsPage;
