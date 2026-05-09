import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const PROJECT_MGT_TOOLS = [
  {
    title: 'RACI Matrix',
    description: 'Responsibility assignment matrix (Responsible, Accountable, Consulted, Informed)',
    icon: IconName.ClipboardCheck,
    href: 'https://alfredang.github.io/raci/',
  },
  {
    title: 'Digital/AI Transformation',
    description: 'Plan and assess digital and AI transformation initiatives',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/digitaltransformation/',
  },
  {
    title: 'Agile/Scrum',
    description: 'Agile and Scrum framework toolkit for sprint planning and team workflows',
    icon: IconName.ClipboardCheck,
    href: 'https://alfredang.github.io/scrum/',
  },
];

const ProjectMgtToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Project Mgt Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {PROJECT_MGT_TOOLS.map(tool => (
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

export default ProjectMgtToolsPage;
