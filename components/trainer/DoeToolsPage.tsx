import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const DOE_TOOLS = [
  {
    title: 'Full Factorial',
    description: 'Test all possible combinations of factor levels for complete interaction analysis',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#full-factorial',
  },
  {
    title: 'Fractional Factorial',
    description: 'Efficiently study main effects using a subset of full factorial runs',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#fractional-factorial',
  },
  {
    title: 'Taguchi',
    description: 'Robust design method using orthogonal arrays to minimise variability',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#taguchi',
  },
  {
    title: 'Central Composite',
    description: 'Response surface design with centre and axial points for quadratic modelling',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#central-composite',
  },
  {
    title: 'Box-Behnken',
    description: 'Three-level design for estimating second-order effects without extreme corners',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#box-behnken',
  },
  {
    title: 'Plackett-Burman',
    description: 'Screening design to identify the most important factors with minimal runs',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#plackett-burman',
  },
  {
    title: 'Latin Square',
    description: 'Control two blocking variables while testing one factor across multiple levels',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#latin-square',
  },
  {
    title: 'Response Surface',
    description: 'Optimise response variables by exploring the relationship between factors',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novadoe/#response-surface',
  },
];

const DoeToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">DOE Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {DOE_TOOLS.map(tool => (
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

export default DoeToolsPage;
