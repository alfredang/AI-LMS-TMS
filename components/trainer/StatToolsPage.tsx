import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const STAT_TOOLS = [
  {
    title: 'Probability',
    description: 'Explore probability distributions and calculate probabilities for common scenarios',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#probability',
  },
  {
    title: 'Descriptive',
    description: 'Summary statistics including mean, median, mode, standard deviation and more',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#/descriptive',
  },
  {
    title: 'Correlation',
    description: 'Analyse relationships between variables with correlation coefficients',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#/correlation',
  },
  {
    title: 'Regression',
    description: 'Build and evaluate regression models to predict outcomes',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#/regression',
  },
  {
    title: 'Hypothesis',
    description: 'Conduct hypothesis tests including t-tests and z-tests',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#/hypothesis',
  },
  {
    title: 'Confidence Interval',
    description: 'Estimate population parameters with confidence intervals for means and proportions',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#confidence',
  },
  {
    title: 'Bayesian Inference',
    description: 'Apply Bayes theorem to update beliefs with evidence and explore posterior distributions',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novastats/#bayesian',
  },
];

const StatToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Statistical Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {STAT_TOOLS.map(tool => (
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

export default StatToolsPage;
