import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { useLms } from '@contexts/LmsContext';
import { useCourses, useAllCourses, useCourseDetails } from '../hooks/useCourses';
import { Quiz } from '@app-types';
import Spinner from './ui/Spinner';
import { generateQuiz } from '@lib/services/geminiService';
import { CourseDetails } from '@lib/services/courseApiService';

interface QuizGeneratorProps {
    // No props needed - component will manage its own course selection
}

const QuizGenerator: React.FC<QuizGeneratorProps> = () => {
    const { role } = useLms();
    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [topic, setTopic] = useState('');
    const [instruction, setInstruction] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedQuiz, setGeneratedQuiz] = useState<Quiz | null>(null);

    // Use database course data
    const { courses: allCourses, loading: coursesLoading } = useAllCourses();
    const { courseDetails } = useCourseDetails(selectedCourseId || null);

    const handleGenerate = async () => {
        if (!selectedCourseId) {
            setError('Please select a course.');
            return;
        }
        if (!topic.trim()) {
            setError('Please enter a topic.');
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedQuiz(null);

        try {
            const quiz = await generateQuiz(topic, instruction);
            if (quiz) {
                setGeneratedQuiz(quiz);
            } else {
                setError('Failed to generate quiz. The AI model might be unavailable.');
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    // const handleSaveQuiz = async () => {
    //     if (!generatedQuiz || !selectedCourseId) {
    //         setError('No quiz to save or course not selected.');
    //         return;
    //     }

    //     try {
    //         // Here you would typically save the quiz to the database
    //         // For now, we'll just show a success message
    //         alert('Quiz saved successfully!');
    //         setGeneratedQuiz(null);
    //         setTopic('');
    //         setInstruction('');
    //         setSelectedCourseId('');
    //     } catch (err) {
    //         setError('Failed to save quiz. Please try again.');
    //     }
    // };

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6 dark:text-white">Create Interactive Quiz</h2>

            <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                <div className="space-y-6">
                    <div>
                        <label htmlFor="course-select" className="block text-lg font-medium text-gray-700 dark:text-gray-300">
                            1. Select Course
                        </label>
                        <select
                            id="course-select"
                            value={selectedCourseId}
                            onChange={e => setSelectedCourseId(e.target.value)}
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600"
                        >
                            <option value="" disabled>-- Choose a course --</option>
                            {allCourses.map(course => (
                                <option key={course.id} value={course.id}>{course.title} ({course.courseCode})</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label htmlFor="topic" className="block text-lg font-medium text-gray-700 dark:text-gray-300">
                            2. Quiz Topic
                        </label>
                        <input
                            type="text"
                            id="topic"
                            value={topic}
                            onChange={e => setTopic(e.target.value)}
                            placeholder="e.g., 'React Hooks', 'JavaScript Arrays', 'Database Design'"
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-400"
                        />
                    </div>

                    <div>
                        <label htmlFor="instruction" className="block text-lg font-medium text-gray-700 dark:text-gray-300">
                            3. Additional Instructions (Optional)
                        </label>
                        <textarea
                            id="instruction"
                            value={instruction}
                            onChange={e => setInstruction(e.target.value)}
                            placeholder="e.g., 'Focus on practical examples', 'Include beginner-friendly questions', 'Make it challenging'"
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm h-24 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-400"
                        />
                    </div>

                    <Button
                        onClick={handleGenerate}
                        disabled={isLoading || !selectedCourseId || !topic.trim()}
                        className="w-full"
                    >
                        {isLoading ? 'Generating Quiz...' : 'Generate Quiz'}
                    </Button>

                    {error && <p className="text-red-500 mt-2">{error}</p>}
                </div>
            </Card>

            {isLoading && (
                <div className="mt-8 flex justify-center">
                    <Spinner text="The AI is creating your quiz..." size="lg" />
                </div>
            )}

            {generatedQuiz && (
                <Card className="mt-8 p-6 dark:bg-gray-800 dark:border-gray-700">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-2xl font-bold dark:text-white">Generated Quiz: {generatedQuiz.topic}</h3>
                        {/* <Button onClick={handleSaveQuiz} variant="primary">
                            Save Quiz
                        </Button> */}
                    </div>

                    <div className="space-y-6">
                        {generatedQuiz.questions.map((question, index) => (
                            <div key={index} className="border-l-4 border-blue-500 pl-4">
                                <h4 className="text-lg font-semibold mb-3 dark:text-white">
                                    Question {index + 1}: {question.question}
                                </h4>
                                <div className="space-y-2">
                                    {question.options.map((option, optionIndex) => (
                                        <div
                                            key={optionIndex}
                                            className={`p-3 rounded-md border ${option === question.correctAnswer
                                                    ? 'bg-green-50 border-green-300 text-green-800 dark:bg-green-900/30 dark:border-green-600 dark:text-green-300'
                                                    : 'bg-gray-50 border-gray-200 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300'
                                                }`}
                                        >
                                            <span className="font-medium">
                                                {String.fromCharCode(65 + optionIndex)}.
                                            </span>
                                            {option}
                                            {option === question.correctAnswer && (
                                                <span className="ml-2 text-green-600 font-semibold">✓ Correct</span>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </Card>
            )}
        </div>
    );
};

export default QuizGenerator;