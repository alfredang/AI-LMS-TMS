import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const CYBER_SECURITY_TOOLS = [
  {
    title: 'CyberLabs',
    description: 'Interactive simulator exploring common cyber threats and attack scenarios',
    icon: IconName.Shield,
    href: 'https://alfredang.github.io/cybersecuritysimulator/',
  },
  {
    title: 'HackLabs',
    description: 'Hands-on ethical hacking labs covering common attack techniques and tools',
    icon: IconName.Shield,
    href: 'https://alfredang.github.io/ethnicalhacking/',
  },
  {
    title: 'Pentest',
    description: 'Hands-on penetration testing playground against a mock vulnerable banking app',
    icon: IconName.Shield,
    href: 'https://pentest-fauxbank.vercel.app/',
  },
];

const CyberSecurityToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Cyber Security Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {CYBER_SECURITY_TOOLS.map(tool => (
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
              <h3 className="font-semibold text-lg mb-1 dark:text-white">{tool.title}</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">{tool.description}</p>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
};

export default CyberSecurityToolsPage;
