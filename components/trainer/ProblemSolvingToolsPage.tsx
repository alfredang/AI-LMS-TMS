import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const PROBLEM_SOLVING_TOOLS = [
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
];

const ProblemSolvingToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Problem Solving Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PROBLEM_SOLVING_TOOLS.map(tool => (
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

export default ProblemSolvingToolsPage;
