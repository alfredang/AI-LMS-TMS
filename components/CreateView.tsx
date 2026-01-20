import React, { useState } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { useLms } from '@contexts/LmsContext';
import { useAllCourses, useCourseDetails } from '../hooks/useCourses';
import { Course, UserRole, View } from '@app-types';
import Spinner from './ui/Spinner';
import QuizGenerator from './QuizGenerator';
import { CourseDetails } from '@lib/services/courseApiService';
import {
    generateLessonPlan,
    generateCourseContent,
    generateCaseStudy,
    generateRolePlayScenario,
    generateWrittenAssessment,
    generateOralQuestioning,
    generateInteractivePollSurvey,
    generateEscapeRoomGame,
    generateLearningOutcomes,
    generateRationaleOfSequencing,
    generateBackgroundResearch,
    generatePerformanceGapAnalysis,
    generateInstructionMethods,
    generateAssessmentMethods,
    generatePracticalLab,
    generateMindMap,
} from '@lib/services/geminiService';

type AiTool = {
    title: string;
    description: string;
    buttonText: string;
    buttonColor?: 'primary' | 'secondary';
    generatorFn?: (topic: string, instruction?: string, courseDetails?: CourseDetails | null) => Promise<string>;
    specialComponent?: 'NewCourse' | 'Quiz' | 'LessonPlan';
};

// --- Tool-specific Generator Components ---

const AiToolPage: React.FC<{
    tool: AiTool;
    onBack: () => void;
    role: UserRole;
}> = ({ tool, onBack, role }) => {
    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [topic, setTopic] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedContent, setGeneratedContent] = useState<string | null>(null);
    const [promptTemplate, setPromptTemplate] = useState('');
    
    // Use database course data
    const { courses: allCourses, loading: coursesLoading } = useAllCourses();
    const { courseDetails } = useCourseDetails(selectedCourseId || null);

    const handleGenerate = async () => {
        if (!tool.generatorFn) {
            setError("This tool does not have a generator function configured.");
            return;
        }
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
        setGeneratedContent(null);

        const course = allCourses.find(c => c.id === selectedCourseId);
        let processedPrompt = promptTemplate;
        if (course) {
            processedPrompt = processedPrompt
                .replace(/\{\{course\.title\}\}/g, course.title);
        }
        processedPrompt = processedPrompt.replace(/\{\{topic\}\}/g, topic);

        try {
            const content = await tool.generatorFn(topic, processedPrompt, courseDetails);
            if (content) {
                console.log('Generated Content applehaha:', content);
                setGeneratedContent(content);
            } else {
                setError(`Failed to generate content for ${tool.title}. The AI model might be unavailable.`);
            }
        } catch (err) {
            setError('An unexpected error occurred. Please try again.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div>
            <Button variant="ghost" onClick={onBack} className="mb-4">
                &larr; Back to Authoring Tools
            </Button>
            <h2 className="text-3xl font-bold mb-6">{tool.title}</h2>
            <Card className="p-6">
                <div className="space-y-6">
                    <div>
                        <label htmlFor="course-select" className="block text-lg font-medium text-gray-700">1. Select Course</label>
                        <select
                            id="course-select"
                            value={selectedCourseId}
                            onChange={e => setSelectedCourseId(e.target.value)}
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        >
                            <option value="" disabled>-- Choose a course --</option>
                            {allCourses.map(course => (
                                <option key={course.id} value={course.id}>{course.title} ({course.courseCode})</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="topic" className="block text-lg font-medium text-gray-700">2. Topic / Subject</label>
                        <input
                            type="text"
                            id="topic"
                            value={topic}
                            onChange={e => setTopic(e.target.value)}
                            placeholder={`e.g., 'React Hooks' for ${tool.title}`}
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                     <div>
                        <label htmlFor="prompt-template" className="block text-lg font-medium text-gray-700">3. Prompt Template / Instruction (Optional)</label>
                        <textarea
                            id="prompt-template"
                            value={promptTemplate}
                            onChange={e => setPromptTemplate(e.target.value)}
                            placeholder="e.g., 'Keep the tone formal.' or 'Explain it like I'm five.'"
                            className="mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm h-24 focus:outline-none focus:ring-2 focus:ring-primary"
                        />
                    </div>
                    <Button onClick={handleGenerate} disabled={isLoading || !selectedCourseId || !topic.trim()}>
                        {isLoading ? 'Generating...' : tool.buttonText}
                    </Button>
                    {error && <p className="text-red-500 mt-2">{error}</p>}
                </div>
            </Card>

            {isLoading && (
                <div className="mt-8 flex justify-center">
                    <Spinner text={`The AI is creating your ${tool.title}...`} size="lg" />
                </div>
            )}

            {generatedContent && (
                <Card className="mt-8 p-6">
                    <h3 className="text-2xl font-bold mb-4">Generated Result</h3>
                    <div className="prose max-w-none bg-gray-50 p-4 rounded-md" dangerouslySetInnerHTML={{ __html: generatedContent }} />
                </Card>
            )}
        </div>
    );
};

const LessonPlanGenerator: React.FC<{ tool: AiTool, onBack: () => void }> = ({ tool, onBack }) => {
    const [selectedCourseId, setSelectedCourseId] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [generatedContent, setGeneratedContent] = useState<string | null>(null);
    const [keyTopics, setKeyTopics] = useState('');
    const [trainingHours, setTrainingHours] = useState(6);
    const [assessmentHours, setAssessmentHours] = useState(2);
    const [startTime, setStartTime] = useState('09:00');
    const [endTime, setEndTime] = useState('18:00');
    const [includeMorningBreak, setIncludeMorningBreak] = useState(true);
    const [includeLunchBreak, setIncludeLunchBreak] = useState(true);
    const [includeAfternoonBreak, setIncludeAfternoonBreak] = useState(true);
    const [instruction, setInstruction] = useState('');
    
    // Use database course data
    const { courses: allCourses, loading: coursesLoading } = useAllCourses();
    const { courseDetails } = useCourseDetails(selectedCourseId || null);

    const handleGenerate = async () => {
        if (!selectedCourseId || !keyTopics.trim()) {
            setError('Please select a course and enter key topics.');
            return;
        }
        setIsLoading(true);
        setError(null);
        setGeneratedContent(null);

        const course = allCourses.find(c => c.id === selectedCourseId);
        let processedInstruction = instruction;
        if (course) {
            processedInstruction = processedInstruction.replace(/\{\{course\.title\}\}/g, course.title);
        }
        processedInstruction = processedInstruction.replace(/\{\{keyTopics\}\}/g, keyTopics);

        try {
            const content = await generateLessonPlan({ 
                keyTopics, 
                trainingHours, 
                assessmentHours, 
                startTime, 
                endTime, 
                includeMorningBreak, 
                includeLunchBreak, 
                includeAfternoonBreak, 
                instruction: processedInstruction,
                courseDetails
            });
            if (content) setGeneratedContent(content);
            else setError('Failed to generate lesson plan.');
        } catch (err) {
            setError('An unexpected error occurred.');
        } finally {
            setIsLoading(false);
        }
    };
    
    const inputClasses = "mt-1 block w-full px-4 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary";
    const labelClasses = "block text-lg font-medium text-gray-700";
    const subLabelClasses = "block text-sm font-medium text-gray-700";

    return (
        <div>
            <Button variant="ghost" onClick={onBack} className="mb-4">&larr; Back to Authoring Tools</Button>
            <h2 className="text-3xl font-bold mb-6">{tool.title}</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
                <div className="lg:col-span-1 space-y-6">
                    <Card className="p-6 space-y-6">
                        <div>
                            <label htmlFor="course-select-lp" className={labelClasses}>1. Select Course</label>
                            <select id="course-select-lp" value={selectedCourseId} onChange={e => setSelectedCourseId(e.target.value)} className={inputClasses}>
                                <option value="" disabled>-- Choose a course --</option>
                                {allCourses.map(course => <option key={course.id} value={course.id}>{course.title} ({course.courseCode})</option>)}
                            </select>
                        </div>
                        <div>
                            <label htmlFor="key-topics" className={labelClasses}>2. Key Topics</label>
                            <textarea id="key-topics" value={keyTopics} onChange={e => setKeyTopics(e.target.value)} placeholder="Enter key topics, one per line..." className={`${inputClasses} h-32`}/>
                        </div>
                        <div>
                            <label className={labelClasses}>3. Duration</label>
                            <div className="grid grid-cols-2 gap-4 mt-1">
                                <div>
                                    <label htmlFor="training-hours" className={subLabelClasses}>Training (Hrs)</label>
                                    <input type="number" id="training-hours" value={trainingHours} onChange={e => setTrainingHours(Number(e.target.value))} className={inputClasses} />
                                </div>
                                <div>
                                    <label htmlFor="assessment-hours" className={subLabelClasses}>Assessment (Hrs)</label>
                                    <input type="number" id="assessment-hours" value={assessmentHours} onChange={e => setAssessmentHours(Number(e.target.value))} className={inputClasses} />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className={labelClasses}>4. Daily Schedule</label>
                            <div className="grid grid-cols-2 gap-4 mt-1">
                                <div>
                                    <label htmlFor="start-time" className={subLabelClasses}>Start Time</label>
                                    <input type="time" id="start-time" value={startTime} onChange={e => setStartTime(e.target.value)} className={inputClasses} />
                                </div>
                                <div>
                                    <label htmlFor="end-time" className={subLabelClasses}>End Time</label>
                                    <input type="time" id="end-time" value={endTime} onChange={e => setEndTime(e.target.value)} className={inputClasses} />
                                </div>
                            </div>
                        </div>
                        <div>
                            <label className={labelClasses}>5. Breaks</label>
                            <div className="space-y-2 mt-2">
                                <div className="flex items-center"><input type="checkbox" id="morning-break" checked={includeMorningBreak} onChange={e => setIncludeMorningBreak(e.target.checked)} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" /><label htmlFor="morning-break" className="ml-2 text-sm">Morning Break</label></div>
                                <div className="flex items-center"><input type="checkbox" id="lunch-break" checked={includeLunchBreak} onChange={e => setIncludeLunchBreak(e.target.checked)} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" /><label htmlFor="lunch-break" className="ml-2 text-sm">Lunch Break</label></div>
                                <div className="flex items-center"><input type="checkbox" id="afternoon-break" checked={includeAfternoonBreak} onChange={e => setIncludeAfternoonBreak(e.target.checked)} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 rounded" /><label htmlFor="afternoon-break" className="ml-2 text-sm">Afternoon Break</label></div>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="instruction" className={labelClasses}>6. Additional Instructions (Optional)</label>
                            <textarea id="instruction" value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="e.g., 'Focus more on hands-on activities.' or 'Include a 5-minute summary at the end of each unit.'" className={`${inputClasses} h-24`}/>
                        </div>
                        <Button onClick={handleGenerate} disabled={isLoading || !selectedCourseId || !keyTopics.trim()}>
                            {isLoading ? 'Generating...' : tool.buttonText}
                        </Button>
                        {error && <p className="text-red-500 mt-2">{error}</p>}
                    </Card>
                </div>
                <div className="lg:col-span-2">
                    {isLoading && <div className="flex justify-center"><Spinner text="The AI is creating your lesson plan..." size="lg" /></div>}
                    {generatedContent && (
                        <Card className="p-6">
                            <h3 className="text-2xl font-bold mb-4">Generated Lesson Plan</h3>
                            <div className="prose max-w-none bg-gray-50 p-4 rounded-md" dangerouslySetInnerHTML={{ __html: generatedContent }} />
                        </Card>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- Main Component ---

const AuthoringToolCard: React.FC<{ tool: AiTool; onClick: () => void }> = ({ tool, onClick }) => (
    <Card className="p-6 flex flex-col text-center items-center">
        <h3 className="text-xl font-bold mb-2">{tool.title}</h3>
        <p className="text-gray-600 text-sm mb-4 flex-grow">{tool.description}</p>
        <Button onClick={onClick} variant="primary">
            {tool.buttonText}
        </Button>
    </Card>
);

const CreateView: React.FC = () => {
    const { role, setEditingCourse, setCourseEditMode } = useLms();
    const [activeTool, setActiveTool] = useState<string | null>(null);

    const handleCreateNewCourse = () => {
        const startDate = new Date();
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 3);

        const newCourse: Course = {
            id: `course_${Date.now()}`,
            title: '',
            courseCode: '',
            courseDuration: 24,
            trainingHours: 20,
            assessmentHours: 4,
            courseType: 'Non-WSQ',
            modeOfLearning: [], // Start with empty array so user must select
            enrollmentStatus: 'not-enrolled',
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            classStatus: 'Draft',
            paymentStatus: 'Pending',
            courseRunId: `CRN-${new Date().getFullYear()}-${Date.now()}`,
            topics: [],
            assessments: []
        };
        
        // Set the course as editing and mark as create mode
        setEditingCourse(newCourse);
        setCourseEditMode('create');
        console.log('🆕 CreateView: Set course edit mode to CREATE');
    };

    const developerTools: AiTool[] = [
        { title: 'Create a New Course', description: 'Build a new course from scratch with topics, subtopics, and AI-generated content.', buttonText: 'Start Building', buttonColor: 'primary', specialComponent: 'NewCourse' },
        { title: 'Create Lesson Plan', description: 'Generate a structured lesson plan for an entire course or a specific topic.', buttonText: 'Create Plan', specialComponent: 'LessonPlan' },
        { title: 'Create Course Content', description: 'Generate detailed content, explanations, and examples for any given topic.', buttonText: 'Create Content', generatorFn: generateCourseContent },
        { title: 'Create Learning Outcomes', description: 'Define clear, measurable learning outcomes based on a topic and TSC.', buttonText: 'Create Outcomes', generatorFn: generateLearningOutcomes },
        { title: 'Create Rationale of Sequencing', description: 'Generate a pedagogical rationale for the sequence of your topics.', buttonText: 'Create Rationale', generatorFn: generateRationaleOfSequencing },
        { title: 'Create Background Research', description: 'Compile background research and industry trends for a course topic.', buttonText: 'Create Research', generatorFn: generateBackgroundResearch },
        { title: 'Performance Gap Analysis', description: 'Analyze the gap between current and desired learner performance.', buttonText: 'Create Analysis', generatorFn: generatePerformanceGapAnalysis },
        { title: 'Create Instruction Methods', description: 'Suggest and justify various instruction methods for a topic.', buttonText: 'Create Methods', generatorFn: generateInstructionMethods },
        { title: 'Create Assessment Methods', description: 'Propose formative and summative assessment methods for a topic.', buttonText: 'Create Methods', generatorFn: generateAssessmentMethods },
        { title: 'Create Interactive Quiz', description: 'Generate a multiple-choice quiz using AI for any existing course topic.', buttonText: 'Create Quiz', specialComponent: 'Quiz' },
        { title: 'Create Case Study', description: 'Generate a realistic case study to help learners apply their knowledge.', buttonText: 'Create Case Study', generatorFn: generateCaseStudy },
        { title: 'Create Role Play', description: 'Design a role-playing scenario for interactive, skill-based learning.', buttonText: 'Create Scenario', generatorFn: generateRolePlayScenario },
        { title: 'Create Escape Room Game', description: 'Generate a text-based digital escape room with puzzles and clues based on a course topic.', buttonText: 'Create Game', generatorFn: generateEscapeRoomGame },
        { title: 'Create Written Assessment', description: 'Generate written assessment questions, such as essays or short answers.', buttonText: 'Create Assessment', generatorFn: generateWrittenAssessment },
        { title: 'Create Oral Questioning', description: 'Generate a set of questions for an oral examination or knowledge check.', buttonText: 'Create Questions', generatorFn: generateOralQuestioning },
    ];
    
    const trainerTools: AiTool[] = [
        { title: 'Create Quiz', description: 'Generate a multiple-choice quiz using AI for any existing course topic.', buttonText: 'Create Quiz', specialComponent: 'Quiz' },
        { title: 'Create Interactive Poll', description: 'Generate a quick poll to gauge understanding or gather opinions.', buttonText: 'Create Poll', generatorFn: generateInteractivePollSurvey },
        { title: 'Create Case Study', description: 'Generate a realistic case study to help learners apply their knowledge.', buttonText: 'Create Case Study', generatorFn: generateCaseStudy },
        { title: 'Create Role Play', description: 'Design a role-playing scenario for interactive, skill-based learning.', buttonText: 'Create Scenario', generatorFn: generateRolePlayScenario },
        { title: 'Create Practical Lab', description: 'Generate hands-on, step-by-step lab exercises for practical skill application.', buttonText: 'Create Lab', generatorFn: generatePracticalLab },
        { title: 'Create Mind Maps', description: 'Generate a hierarchical mind map to visualize concepts and their relationships.', buttonText: 'Create Mind Map', generatorFn: generateMindMap },
    ];

    const tools = role === UserRole.Trainer ? trainerTools : developerTools;
    const activeToolData = tools.find(t => t.title === activeTool);

    if (activeTool && activeToolData) {
        if (activeToolData.specialComponent === 'Quiz') {
            return (
                <div>
                     <Button variant="ghost" onClick={() => setActiveTool(null)} className="mb-4">&larr; Back to Authoring Tools</Button>
                     <QuizGenerator />
                </div>
            );
        }
        if (activeToolData.specialComponent === 'LessonPlan') {
            return <LessonPlanGenerator tool={activeToolData} onBack={() => setActiveTool(null)} />;
        }
        return <AiToolPage tool={activeToolData} onBack={() => setActiveTool(null)} role={role} />;
    }

    const title = role === UserRole.Trainer ? "Trainer GenAI Authoring" : "Developer GenAI Authoring";
    const gridCols = role === UserRole.Trainer ? 'lg:grid-cols-3' : 'lg:grid-cols-4';

    return (
        <div>
            <h2 className="text-3xl font-bold mb-6">{title}</h2>
            <div className={`grid grid-cols-1 md:grid-cols-2 ${gridCols} gap-6`}>
                {tools.map(tool => (
                    <AuthoringToolCard
                        key={tool.title}
                        tool={tool}
                        onClick={() => {
                            if (tool.specialComponent === 'NewCourse') {
                                handleCreateNewCourse();
                            } else {
                                setActiveTool(tool.title);
                            }
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default CreateView;