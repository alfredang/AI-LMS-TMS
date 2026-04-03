import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const SPC_TOOLS = [
  {
    title: 'c Chart',
    description: 'Count of defects per unit with fixed sample size',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#c-chart',
  },
  {
    title: 'u Chart',
    description: 'Defect rate per unit with variable sample sizes',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#u-chart',
  },
  {
    title: 'np Chart',
    description: 'Number of nonconforming units with fixed sample size',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#np-chart',
  },
  {
    title: 'p Chart',
    description: 'Proportion of nonconforming units with variable sample sizes',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#p-chart',
  },
  {
    title: 'X-mR Chart',
    description: 'Individuals and moving range chart for single observations',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#x-mr-chart',
  },
  {
    title: 'X\u0304-R Chart',
    description: 'Sample mean and range chart for subgroup data',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#xbar-r-chart',
  },
  {
    title: 'X\u0304-s Chart',
    description: 'Sample mean and standard deviation chart for larger subgroups',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#xbar-s-chart',
  },
  {
    title: 'Distribution',
    description: 'Analyse process distribution with histogram and normality tests',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#distribution',
  },
  {
    title: 'Process Capability',
    description: 'Calculate Cp, Cpk, Pp, Ppk indices to assess process performance',
    icon: IconName.Analytics,
    href: 'https://alfredang.github.io/novaspc/#process-capability',
  },
];

const SpcToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">SPC Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {SPC_TOOLS.map(tool => (
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

export default SpcToolsPage;
