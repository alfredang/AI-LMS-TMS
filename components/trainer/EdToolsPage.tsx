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
    title: 'Flash Cards',
    description: 'Interactive flash cards for learner review and memorisation',
    icon: IconName.FileText,
    href: 'https://alfredang.github.io/flashcard/',
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
    title: 'Collaborative Flow',
    description: 'Visual workflow and flowchart collaboration tool',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/collabflow/',
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
    title: 'MindMaps',
    description: 'Create and collaborate on mind maps in real time',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/mindmapping/',
  },
  {
    title: 'Spinning Wheel',
    description: 'Random selection spinner for classroom activities',
    icon: IconName.Spinner,
    href: 'https://alfredang.github.io/spinning-wheel/',
  },
  {
    title: '5 Whys',
    description: 'Root cause analysis tool using the 5 Whys technique',
    icon: IconName.Help,
    href: 'https://alfredang.github.io/5whys/',
  },
  {
    title: 'Fishbone Diagram',
    description: 'Cause-and-effect fishbone (Ishikawa) diagram for root cause analysis',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/fishbone/',
  },
  {
    title: 'Pareto Chart',
    description: 'Pareto chart for identifying the most significant factors',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/paretochart/',
  },
  {
    title: 'System Thinking',
    description: 'Visualise cause-and-effect feedback loops for systems analysis',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/systemloop/',
  },
  {
    title: 'Mock Data Generator',
    description: 'Generate realistic mock data for testing and demonstrations',
    icon: IconName.FileText,
    href: 'https://alfredang.github.io/mockdatagen/',
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
