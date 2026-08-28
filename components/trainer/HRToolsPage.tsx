import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const HR_TOOLS = [
  {
    title: 'MBTI',
    description: 'Myers-Briggs personality type assessment to explore preferences across 16 personality types',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/mbti/#landing',
  },
  {
    title: 'AI Interviewing',
    description: 'Practice interview questions and receive AI-powered feedback to sharpen your responses',
    icon: IconName.Chat,
    href: 'https://alfredang.github.io/AIInterviewing/',
  },
  {
    title: 'HR Interview Gen',
    description: 'Generate tailored HR interview questions to streamline candidate screening and evaluation',
    icon: IconName.Assignment,
    href: 'https://alfredang.github.io/hr-interviewing/',
  },
  {
    title: 'AI Coaching',
    description: 'AI-guided coaching conversations to support staff development, goal setting and performance growth',
    icon: IconName.Chat,
    href: 'https://alfredang.github.io/AICoaching/',
  },
];

const HRToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">HR Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {HR_TOOLS.map(tool => (
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

export default HRToolsPage;
