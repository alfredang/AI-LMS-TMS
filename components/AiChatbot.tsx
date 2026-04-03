import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { ChatMessage } from '@app-types';
import { getApiUrl } from '@/lib/urlHelpers';

function getNemoSystemPrompt(companyName: string) {
  return `You are Nemo, an AI operations assistant for ${companyName}'s LMS/TMS platform.
You help admins and training providers manage courses, trainers, learners, enrollments, and class operations.

Key capabilities:
- Search and view course runs, trainers, learners, enrollments
- Assign trainers to course runs
- Create new classes and course runs
- Manage learner enrollments
- View statistics and analytics
- Help with SSG/TPG grant and claim operations

When a user asks you to perform an action (assign trainer, enroll learner, etc.), explain what you'll do and confirm before executing.
Be concise, professional, and proactive in suggesting next steps.
If you don't know something, say so honestly.`;
}

const AiChatbot: React.FC = () => {
    const { isChatOpen, toggleChat, resetInAppChat, trainingProviderProfile, currentUser, role } = useLms();
    const NEMO_SYSTEM_PROMPT = getNemoSystemPrompt(trainingProviderProfile?.companyShortname || trainingProviderProfile?.companyName || 'Training Provider');
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: 'initial', role: 'model', text: 'Hello! I\'m Nemo, your AI operations assistant. I can help you manage courses, trainers, learners, and more. What would you like to do?' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isChatOpen) {
            scrollToBottom();
        } else {
            if (messages.length > 1) {
                setMessages([{ id: 'initial', role: 'model', text: 'Hello! I\'m Nemo, your AI operations assistant. I can help you manage courses, trainers, learners, and more. What would you like to do?' }]);
                resetInAppChat();
            }
        }
    }, [isChatOpen, messages.length, resetInAppChat]);

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim()) return;

        const userMessage: ChatMessage = { id: Date.now().toString(), role: 'user', text: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        const modelMessageId = (Date.now() + 1).toString();
        setMessages(prev => [...prev, { id: modelMessageId, role: 'model', text: '' }]);

        try {
            // Build conversation history for the AI
            const conversationMessages = [...messages.filter(m => m.id !== 'initial'), userMessage].map(m => ({
                role: m.role === 'model' ? 'assistant' : 'user',
                content: m.text
            }));

            const response = await fetch(getApiUrl('/api/ai/nemo'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: conversationMessages,
                    systemPrompt: NEMO_SYSTEM_PROMPT,
                    currentUser: currentUser ? {
                        id: currentUser.id,
                        email: currentUser.email,
                        role,
                        name: currentUser.fullName,
                    } : null,
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                const errorMsg = data?.error || data?.details || `API error: ${response.status}`;
                console.error('Nemo API error:', errorMsg);
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === modelMessageId
                            ? { ...msg, text: `Sorry, I encountered an error: ${errorMsg}` }
                            : msg
                    )
                );
                setIsLoading(false);
                return;
            }

            const responseText = data.text || 'Sorry, I could not generate a response.';

            setMessages(prev =>
                prev.map(msg =>
                    msg.id === modelMessageId
                        ? { ...msg, text: responseText }
                        : msg
                )
            );
        } catch (error) {
            console.error('Nemo AI error:', error);
            setMessages(prev =>
                prev.map(msg =>
                    msg.id === modelMessageId
                        ? { ...msg, text: 'Sorry, I encountered an error. Please check that the OpenClaw gateway is configured and reachable.' }
                        : msg
                )
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="hidden md:block fixed bottom-6 right-6 z-50">
            {/* Chat Window */}
            {isChatOpen && (
                <div className="w-[28rem] h-[65vh] max-h-[750px] bg-surface shadow-2xl rounded-xl flex flex-col transform transition-all duration-300 ease-in-out origin-bottom-right scale-100 opacity-100 dark:bg-gray-800 dark:border dark:border-gray-700">
                    <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm">N</div>
                            <div>
                                <h3 className="text-lg font-bold text-primary dark:text-blue-400">Nemo</h3>
                                <p className="text-[10px] text-gray-500 dark:text-gray-400 -mt-0.5">AI Operations Agent</p>
                            </div>
                        </div>
                        <Button variant="ghost" size="sm" onClick={toggleChat} className="!p-2 rounded-full dark:text-gray-400 dark:hover:bg-gray-700">
                            <Icon name={IconName.Close} className="w-6 h-6" />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                {msg.role === 'model' && (
                                    <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-white font-bold text-[10px] mr-2 mt-1 flex-shrink-0">N</div>
                                )}
                                <div className={`max-w-[80%] px-4 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-primary text-white dark:bg-blue-600' : 'bg-gray-100 !text-black dark:bg-gray-200 dark:!text-black'}`}>
                                    {msg.text ? (
                                        msg.role === 'user' ? (
                                            <p className="whitespace-pre-wrap text-sm">{msg.text}</p>
                                        ) : (
                                            <div className="text-sm prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5 prose-headings:text-black prose-strong:text-black prose-a:text-blue-600 prose-table:text-xs prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-table:border prose-th:border prose-td:border prose-th:bg-gray-200">
                                                <ReactMarkdown>{msg.text}</ReactMarkdown>
                                            </div>
                                        )
                                    ) : (
                                        <div className="flex items-center gap-1.5 py-1">
                                            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                                            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                                            <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                                            <span className="text-xs text-gray-500 ml-1.5">Nemo is thinking...</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        <div ref={messagesEndRef} />
                    </div>

                    <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                        <div className="flex items-center space-x-2">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && !isLoading && handleSend()}
                                placeholder="Ask Nemo anything..."
                                className="flex-1 px-4 py-2 text-on-surface bg-surface border border-gray-300 rounded-full placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400 text-sm"
                                disabled={isLoading}
                            />
                            <Button onClick={handleSend} disabled={isLoading} className="rounded-full !p-3">
                                <Icon name={IconName.Send} className="w-5 h-5" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Action Button */}
            {!isChatOpen && (
                <Button
                    onClick={toggleChat}
                    className="rounded-full !p-0 shadow-lg w-12 h-12 flex items-center justify-center transform hover:scale-110 transition-transform duration-200 overflow-hidden"
                    aria-label="Open Nemo AI Agent"
                    title="Nemo - AI Agent"
                >
                    <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white font-bold text-base leading-none">
                        N
                    </div>
                </Button>
            )}
        </div>
    );
};

export default AiChatbot;
