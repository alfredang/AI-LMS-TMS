import React from 'react';
import { Card } from '../ui/Card';

const AGENTIC_AI_CATEGORIES = [
  {
    title: 'No Code Platforms',
    description: 'Build AI agents and workflows without writing any code using drag-and-drop interfaces.',
    items: [
      { label: 'AgentX', href: 'https://www.agentx.so/' },
      { label: 'Opal', href: 'https://opal.google/landing/' },
      { label: 'Relevance AI', href: 'https://relevanceai.com/' },
      { label: 'Promptly AI', href: 'https://www.promptly.fyi/' },
    ],
  },
  {
    title: 'Low Code Platforms',
    description: 'Create AI-powered automations and agent workflows with minimal coding using visual builders.',
    items: [
      { label: 'n8n', href: 'https://n8n.io/' },
      { label: 'Langflow', href: 'https://www.langflow.org/' },
      { label: 'Flowise', href: 'https://flowiseai.com/' },
    ],
  },
  {
    title: 'Voice Agents',
    description: 'Build AI-powered voice agents for phone calls, customer support, and conversational interfaces.',
    items: [
      { label: 'ElevenLabs', href: 'https://elevenlabs.io/' },
      { label: 'Retell AI', href: 'https://www.retellai.com/' },
      { label: 'Vapi', href: 'https://vapi.ai/' },
    ],
  },
  {
    title: 'Video Agents',
    description: 'Create AI-generated video avatars and presenters for training, marketing, and communication.',
    items: [
      { label: 'HeyGen', href: 'https://www.heygen.com/' },
      { label: 'Synthesia', href: 'https://www.synthesia.io/' },
    ],
  },
];

const AgenticAIToolsPage: React.FC = () => {
  return (
    <div>
      <h2 className="text-3xl font-bold mb-6 dark:text-white">Agentic AI Tools</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {AGENTIC_AI_CATEGORIES.map(cat => (
          <Card key={cat.title} className="p-6 flex flex-col dark:bg-gray-800 dark:border-gray-700">
            <h3 className="text-xl font-bold mb-2 dark:text-white">{cat.title}</h3>
            <p className="text-gray-600 dark:text-gray-300 text-sm mb-4">{cat.description}</p>
            <div className="flex flex-wrap gap-2 mt-auto">
              {cat.items.map(item => (
                <a
                  key={item.label}
                  href={item.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                >
                  {item.label}
                  <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                </a>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AgenticAIToolsPage;
