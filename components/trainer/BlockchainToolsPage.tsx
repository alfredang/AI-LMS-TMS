import React from 'react';
import { Card } from '../ui/Card';
import { Icon, IconName } from '../ui/Icon';

const BLOCKCHAIN_TOOLS = [
  {
    title: 'Certify NFT',
    description: 'Issue and verify blockchain-based certificates as NFTs for course completions',
    icon: IconName.Award,
    href: 'https://alfredang.github.io/certifynft/',
  },
  {
    title: 'Supply Verify',
    description: 'Track and verify supply chain provenance on the blockchain',
    icon: IconName.Link,
    href: 'https://alfredang.github.io/supplyverify/',
  },
  {
    title: 'Hashing Tool',
    description: 'Generate and verify cryptographic hashes for blockchain data integrity',
    icon: IconName.Shield,
    href: 'https://alfredang.github.io/hashgenerator/',
  },
];

const BlockchainToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Blockchain Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {BLOCKCHAIN_TOOLS.map(tool => (
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

export default BlockchainToolsPage;
