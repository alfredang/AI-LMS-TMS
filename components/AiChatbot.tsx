import React, { useState, useEffect, useRef } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { getTutorResponseStream } from '@lib/services/geminiService';
import { ChatMessage, Course } from '@app-types';

const AiChatbot: React.FC = () => {
    const { isChatOpen, toggleChat, courses, calendarEvents, resetInAppChat } = useLms();
    const [messages, setMessages] = useState<ChatMessage[]>([
        { id: 'initial', role: 'model', text: 'Hello! I am Tertiary, your AI tutor. Ask me about your courses or assignments!' }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const enrolledCourses = courses.filter((c: Course) => c.enrollmentStatus === 'enrolled');

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        if (isChatOpen) {
            scrollToBottom();
        } else {
            // Reset chat when closed to ensure context is fresh next time
            if (messages.length > 1) {
                setMessages([{ id: 'initial', role: 'model', text: 'Hello! I am Tertiary, your AI tutor. How can I help you today?' }]);
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
            const stream = await getTutorResponseStream(input, enrolledCourses, calendarEvents);

            for await (const chunk of stream) {
                const chunkText = chunk.text;
                setMessages(prev =>
                    prev.map(msg =>
                        msg.id === modelMessageId
                            ? { ...msg, text: msg.text + chunkText }
                            : msg
                    )
                );
            }
        } catch (error) {
            setMessages(prev =>
                prev.map(msg =>
                    msg.id === modelMessageId
                        ? { ...msg, text: 'Sorry, I encountered an error. Please try again.' }
                        : msg
                )
            );
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50">
            {/* Chat Window */}
            {isChatOpen && (
                <div className="w-96 h-[60vh] max-h-[700px] bg-surface shadow-2xl rounded-xl flex flex-col transform transition-all duration-300 ease-in-out origin-bottom-right scale-100 opacity-100 dark:bg-gray-800 dark:border dark:border-gray-700">
                    <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                        <h3 className="text-xl font-bold text-primary dark:text-blue-400">AI Tutor Chat</h3>
                        <Button variant="ghost" size="sm" onClick={toggleChat} className="!p-2 rounded-full dark:text-gray-400 dark:hover:bg-gray-700">
                            <Icon name={IconName.Close} className="w-6 h-6" />
                        </Button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {messages.map((msg) => (
                            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-xs px-4 py-2 rounded-2xl ${msg.role === 'user' ? 'bg-primary text-white dark:bg-blue-600' : 'bg-gray-100 !text-black dark:bg-gray-200 dark:!text-black'}`}>
                                    <p className="whitespace-pre-wrap">{msg.text || <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-full"></span>}</p>
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
                                placeholder="Ask about your courses..."
                                className="flex-1 px-4 py-2 text-on-surface bg-surface border border-gray-300 rounded-full placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:placeholder-gray-400"
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
                    className="rounded-full !p-4 shadow-lg w-16 h-16 flex items-center justify-center transform hover:scale-110 transition-transform duration-200"
                    aria-label="Open AI Tutor Chat"
                >
                    <Icon name={IconName.Chat} className="w-8 h-8" />
                </Button>
            )}
        </div>
    );
};

export default AiChatbot;