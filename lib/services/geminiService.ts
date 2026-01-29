import { GoogleGenerativeAI } from '@google/generative-ai';
// Note: Image generation with Imagen requires proper Google AI SDK setup
// For now, image generation will fall back to placeholder images
import { Quiz } from '@app-types';
import { CourseDetails } from './courseApiService';

// Cache the API key in memory
let cachedApiKey: string | null = null;

// Function to fetch API key from database (via internal API)
const getDynamicApiKey = async (): Promise<string> => {
  // If we have a cached key, use it
  if (cachedApiKey) return cachedApiKey;

  // Check environment variable first as fallback/override
  // REMOVED: User requested to strictly load from database
  // if (process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY) {
  //   cachedApiKey = process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY;
  //   return cachedApiKey;
  // }

  try {
    const response = await fetch('/api/config/gemini-key');
    const data = await response.json();

    if (data.success && data.apiKey) {
      cachedApiKey = data.apiKey;
      return cachedApiKey as string;
    } else {
      throw new Error(data.error || 'Failed to fetch Gemini API key');
    }
  } catch (error) {
    console.error('Failed to retrieve Gemini API key:', error);
    throw new Error('Gemini API key is missing. Please configuration it in your profile.');
  }
};

// TODO: Implement proper image generation with Google AI Imagen API
// Currently using fallback images from Unsplash
// Image generation requires additional Google Cloud setup beyond basic Gemini API

// Helper function to clean markdown code blocks from AI responses
const cleanMarkdownCodeBlocks = (content: string): string => {
  return content
    .replace(/^```html\s*/i, '') // Remove opening ```html
    .replace(/^```\s*/m, '') // Remove opening ```
    .replace(/\s*```\s*$/m, '') // Remove closing ```
    .trim();
};

// Helper function to generate course context
const generateCourseContext = (courseDetails?: CourseDetails | null): string => {
  if (!courseDetails) return '';

  return `

Course Context:
- Course: ${courseDetails.title}
- TSC Title: ${courseDetails.tscTitle || 'N/A'}
- Knowledge Areas: ${courseDetails.tscKnowledge || 'N/A'}
- Abilities: ${courseDetails.tscAbilities || 'N/A'}
- Learning Outcomes: ${courseDetails.learningOutcomes || 'N/A'}

Please ensure the content aligns with these course requirements and learning outcomes.
`;
};

interface GenerateContentOptions {
  responseFormat?: 'text' | 'json';
  responseSchema?: any;
}

const callGeminiAPI = async (prompt: string, modelName = 'gemini-2.5-flash', options: GenerateContentOptions = {}): Promise<string> => {
  try {
    const apiKey = await getDynamicApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);

    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        // maxOutputTokens: 2048,
        // Configure response format for the model here
        responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
      }
    });

    // Generate content using the prompt
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Only clean markdown if it's NOT a JSON response
    let cleanedText = text;
    if (options.responseFormat !== 'json') {
      cleanedText = cleanMarkdownCodeBlocks(text);
    }

    return cleanedText;
  } catch (error: any) {
    console.error('Error calling Gemini API:', error);

    // Provide more helpful error messages
    if (error.message?.includes('quota')) {
      throw new Error('API quota exceeded. Please wait a moment and try again, or check your billing settings.');
    } else if (error.message?.includes('404')) {
      throw new Error('Model not found. The Gemini model may not be available or you may not have access to it.');
    } else if (error.message?.includes('API key')) {
      throw new Error('Invalid API key. Please check your Google AI API key configuration.');
    }

    throw error;
  }
};

// --- Image Generation ---

export const generateCourseImage = async (courseTitle: string, learningOutcomes: string): Promise<string | null> => {
  try {
    console.log("Generating course image for:", courseTitle);
    console.log("Note: AI image generation not yet implemented, using fallback images");

    // TODO: Implement Google AI Imagen integration when available
    // For now, use curated fallback images from Unsplash
    const fallbackImages = [
      'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=400&h=225&fit=crop',
      'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&h=225&fit=crop',
      'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=400&h=225&fit=crop',
      'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=400&h=225&fit=crop',
      'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&h=225&fit=crop',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&h=225&fit=crop',
    ];

    const randomIndex = Math.floor(Math.random() * fallbackImages.length);
    return fallbackImages[randomIndex];
  } catch (error) {
    console.error("Error generating course image:", error);
    return null;
  }
};

export const generateAvatarImage = async (userName?: string): Promise<string | null> => {
  try {
    console.log("Generating avatar image for:", userName || "user");
    console.log("Note: AI avatar generation not yet implemented, using fallback images");

    // TODO: Implement Google AI Imagen integration when available
    // For now, use curated fallback avatars from Unsplash
    const fallbackAvatars = [
      'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=150&h=150&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&h=150&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1494790108755-2616b612b601?w=150&h=150&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&h=150&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&h=150&fit=crop&crop=face',
      'https://images.unsplash.com/photo-1519345182560-3f2917c472ef?w=150&h=150&fit=crop&crop=face',
    ];

    const randomIndex = Math.floor(Math.random() * fallbackAvatars.length);
    return fallbackAvatars[randomIndex];
  } catch (error) {
    console.error("Error generating avatar image:", error);
    return null;
  }
};

export const generateCompanyLogo = async (companyName: string): Promise<string | null> => {
  try {
    console.log(`Generating company logo for: ${companyName}`);
    console.log("Note: AI logo generation not yet implemented, returning null for manual upload");

    // TODO: Implement Google AI Imagen integration when available
    // For now, return null to allow manual logo upload
    return null;
  } catch (error) {
    console.error("Error generating company logo:", error);
    return null;
  }
};

// --- Quiz and Content Generation ---

export const generateQuiz = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<Quiz | null> => {
  try {
    let courseContext = '';
    if (courseDetails) {
      courseContext = `
Course Context:
- Course: ${courseDetails.title}
- TSC Title: ${courseDetails.tscTitle || 'N/A'}
- Knowledge Areas: ${courseDetails.tscKnowledge || 'N/A'}
- Abilities: ${courseDetails.tscAbilities || 'N/A'}
- Learning Outcomes: ${courseDetails.learningOutcomes || 'N/A'}

Please create the quiz to align with these course requirements.
`;
    }

    const prompt = `Generate a 5-question multiple-choice quiz about ${topic}. Each question should have 4 options and one correct answer. ${instruction || ''}

${courseContext}

Return the response in the following JSON format:
{
  "topic": "${topic}",
  "questions": [
    {
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctAnswer": "Option A"
    }
  ]
}`;

    const response = await callGeminiAPI(prompt, 'gemini-2.5-flash', {
      responseFormat: 'json'
    });

    // Additional JSON cleaning in case of any remaining issues
    let cleanJsonResponse = response.trim();

    // Remove any potential JSON code block markers that might have been missed
    if (cleanJsonResponse.startsWith('```json')) {
      cleanJsonResponse = cleanJsonResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    }
    if (cleanJsonResponse.startsWith('json')) {
      cleanJsonResponse = cleanJsonResponse.replace(/^json\s*/, '');
    }

    const quizData = JSON.parse(cleanJsonResponse);
    return quizData as Quiz;
  } catch (error) {
    console.error("Error generating quiz:", error);
    return null;
  }
};

export const generateCourseContent = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    let courseContext = '';
    if (courseDetails) {
      courseContext = `
      
Course Context:
- Course: ${courseDetails.title}
- TSC Title: ${courseDetails.tscTitle || 'N/A'}
- Knowledge Areas: ${courseDetails.tscKnowledge || 'N/A'}
- Abilities: ${courseDetails.tscAbilities || 'N/A'}
- Learning Outcomes: ${courseDetails.learningOutcomes || 'N/A'}

Please ensure the content aligns with these course requirements and learning outcomes.
`;
    }

    const prompt = `Generate a concise and informative educational text for a subtopic titled "${topic}". The content should be suitable for an online course. Explain the concept clearly. Use paragraphs for readability. Format the output as clean, semantic HTML using tags like <p>, <strong>, and <ul> for key points. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating course content:", error);
    return "<p>Failed to generate content. Please try again.</p>";
  }
};

export interface LessonPlanOptions {
  keyTopics: string;
  trainingHours: number;
  assessmentHours: number;
  startTime: string;
  endTime: string;
  includeMorningBreak: boolean;
  includeLunchBreak: boolean;
  includeAfternoonBreak: boolean;
  instruction?: string;
  courseDetails?: CourseDetails | null;
}

export const generateLessonPlan = async (options: LessonPlanOptions): Promise<string> => {
  const { keyTopics, trainingHours, assessmentHours, startTime, endTime, includeMorningBreak, includeLunchBreak, includeAfternoonBreak, instruction, courseDetails } = options;

  const totalDuration = trainingHours + assessmentHours;

  let breakInstructions = 'The schedule should include';
  const breaks = [];
  if (includeMorningBreak) breaks.push('a morning break (approx. 15 minutes)');
  if (includeLunchBreak) breaks.push('a lunch break (approx. 1 hour)');
  if (includeAfternoonBreak) breaks.push('an afternoon break (approx. 15 minutes)');

  if (breaks.length > 0) {
    breakInstructions += ` ${breaks.join(', ')}.`;
  } else {
    breakInstructions = 'No breaks are scheduled.';
  }

  try {
    let courseContext = '';
    if (courseDetails) {
      courseContext = `
    
    **Course Context:**
    - **Course**: ${courseDetails.title}
    - **TSC Title**: ${courseDetails.tscTitle || 'N/A'}
    - **Knowledge Areas**: ${courseDetails.tscKnowledge || 'N/A'}
    - **Abilities**: ${courseDetails.tscAbilities || 'N/A'}
    - **Learning Outcomes**: ${courseDetails.learningOutcomes || 'N/A'}
    
    Please ensure the lesson plan aligns with these course requirements and learning outcomes.`;
    }

    const prompt = `
    Generate a structured and detailed lesson plan in the form of an HTML table. The output must be a single, well-formed <table> element with a <thead> and <tbody>. Do not include <html>, <body>, or <style> tags. The table should have a clean design with classes "min-w-full divide-y divide-gray-200".

    **Lesson Plan Parameters:**
    - **Key Topics to Cover**: 
    ${keyTopics}
    - **Total Duration**: ${totalDuration} hours
    - **Training Duration**: ${trainingHours} hours
    - **Assessment Duration**: ${assessmentHours} hours
    - **Daily Schedule**: The plan should fit within a daily schedule starting at ${startTime} and ending at ${endTime}.
    - **Breaks**: ${breakInstructions}

    **Table Structure:**
    The table must have a header (<thead>) and a body (<tbody>) with the following columns in this exact order:
    1.  **Duration**: The time allocated for the activity (e.g., "1 hour", "30 mins").
    2.  **Learning Unit**: The overarching module or unit name.
    3.  **Topics and Activities**: A detailed description of the specific topic being covered and the corresponding learning activities.
    4.  **Instruction Methods**: Choose ONE of the following options:
        - Interactive Presentation
        - Demonstration
        - Practice and Drill
        - Concept Formation
        - Role Play
        - Simulation
        - Case Study
        - Reflection Journaling
    5.  **Assessment Methods**: Choose ONE of the following options:
        - Written Exam
        - Practical Exam
        - Case Study
        - Reflection Journaling
        - Oral Questioning
        - Role Play

    **Instructions:**
    - Create a timed agenda that logically sequences the key topics, activities, assessments, and specified breaks.
    - The total time for all activities, breaks, and assessments must sum up to the total duration and fit within the daily schedule.
    - Fill the table rows (<tr> with <td> elements) accordingly. Be specific and practical in the "Topics and Activities" column.
    - For "Instruction Methods" and "Assessment Methods" columns, you MUST use one of the provided options from the lists above. If an activity like a break does not have one, leave the cell empty or use 'N/A'.
    - **User Instructions**: ${instruction || 'N/A'}
    `;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating lesson plan:", error);
    return "<p>Failed to generate lesson plan. Please try again.</p>";
  }
};

export const generateCaseStudy = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Create a realistic and engaging case study based on the topic "${topic}". The case study should include:
    
    1. A clear scenario description
    2. Relevant background information
    3. Key challenges or problems to solve
    4. Discussion questions
    5. Learning objectives
    
    Format the output as clean HTML using appropriate tags like <h3>, <p>, <ul>, <li>, <strong>. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating case study:", error);
    return "<p>Failed to generate case study. Please try again.</p>";
  }
};

export const generateRolePlayScenario = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Design a role-playing scenario for the topic "${topic}". Include:
    
    1. Scenario setup and context
    2. Character roles and their objectives
    3. Instructions for each participant
    4. Learning goals and outcomes
    5. Debrief questions
    
    Format the output as clean HTML using appropriate tags. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating role play scenario:", error);
    return "<p>Failed to generate role play scenario. Please try again.</p>";
  }
};

export const generateWrittenAssessment = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Create a comprehensive written assessment for the topic "${topic}". Include:
    
    1. A mix of question types (short answer, essay, multiple choice)
    2. Clear instructions for students
    3. Grading criteria or rubric
    4. Time allocation guidelines
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating written assessment:", error);
    return "<p>Failed to generate written assessment. Please try again.</p>";
  }
};

export const generateOralQuestioning = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Generate a set of oral questioning guidelines for the topic "${topic}". Include:
    
    1. A variety of question types (factual, analytical, evaluative)
    2. Follow-up questions
    3. Assessment criteria
    4. Tips for conducting the oral assessment
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating oral questioning:", error);
    return "<p>Failed to generate oral questioning. Please try again.</p>";
  }
};

export const generateInteractivePollSurvey = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Create an interactive poll or survey for the topic "${topic}". Include:
    
    1. Engaging poll questions
    2. Multiple choice options
    3. Instructions for implementation
    4. Discussion points based on results
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating interactive poll survey:", error);
    return "<p>Failed to generate interactive poll survey. Please try again.</p>";
  }
};

export const generateEscapeRoomGame = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Design a text-based digital escape room game for the topic "${topic}". Include:
    
    1. Game narrative and setting
    2. Puzzles and clues related to the topic
    3. Step-by-step solution guide
    4. Learning objectives achieved through gameplay
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating escape room game:", error);
    return "<p>Failed to generate escape room game. Please try again.</p>";
  }
};

export const generateLearningOutcomes = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Define clear, measurable learning outcomes for the topic "${topic}". Include:
    
    1. Knowledge-based outcomes (what students will know)
    2. Skill-based outcomes (what students will be able to do)
    3. Application outcomes (how students will apply knowledge)
    4. Assessment criteria for each outcome
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating learning outcomes:", error);
    return "<p>Failed to generate learning outcomes. Please try again.</p>";
  }
};

export const generateRationaleOfSequencing = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Generate a pedagogical rationale for sequencing topics in "${topic}". Include:
    
    1. Logical progression of concepts
    2. Prerequisites and dependencies
    3. Learning theory justification
    4. Student engagement considerations
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating rationale of sequencing:", error);
    return "<p>Failed to generate rationale of sequencing. Please try again.</p>";
  }
};

export const generateBackgroundResearch = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Compile background research and industry trends for "${topic}". Include:
    
    1. Current state of the field
    2. Recent developments and trends
    3. Key research findings
    4. Implications for learning and practice
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating background research:", error);
    return "<p>Failed to generate background research. Please try again.</p>";
  }
};

export const generatePerformanceGapAnalysis = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Analyze the performance gap for "${topic}". Include:
    
    1. Current performance state
    2. Desired performance state
    3. Gap identification and analysis
    4. Recommended interventions
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating performance gap analysis:", error);
    return "<p>Failed to generate performance gap analysis. Please try again.</p>";
  }
};

export const generateInstructionMethods = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Suggest and justify various instruction methods for "${topic}". Include:
    
    1. Multiple teaching approaches
    2. Rationale for each method
    3. Implementation guidelines
    4. Effectiveness considerations
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating instruction methods:", error);
    return "<p>Failed to generate instruction methods. Please try again.</p>";
  }
};

export const generateAssessmentMethods = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Propose formative and summative assessment methods for "${topic}". Include:
    
    1. Formative assessment strategies
    2. Summative assessment options
    3. Alignment with learning objectives
    4. Implementation guidelines
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating assessment methods:", error);
    return "<p>Failed to generate assessment methods. Please try again.</p>";
  }
};

export const generatePracticalLab = async (topic: string, instruction?: string, courseDetails?: CourseDetails | null): Promise<string> => {
  try {
    const courseContext = generateCourseContext(courseDetails);
    const prompt = `Generate hands-on, step-by-step lab exercises for "${topic}". Include:
    
    1. Lab objectives and prerequisites
    2. Required materials and setup
    3. Detailed step-by-step instructions
    4. Expected outcomes and verification
    
    Format the output as clean HTML. Do not include <html> or <body> tags. ${instruction || ''}${courseContext}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating practical lab:", error);
    return "<p>Failed to generate practical lab. Please try again.</p>";
  }
};

export const generateMindMap = async (topic: string, instruction?: string): Promise<string> => {
  try {
    const prompt = `Generate a hierarchical mind map to visualize concepts and relationships for "${topic}". Include:
    
    1. Central concept identification
    2. Main branches and sub-branches
    3. Connections and relationships
    4. Text-based visual representation
    
    Format the output as clean HTML with nested lists. Do not include <html> or <body> tags. ${instruction || ''}`;

    return await callGeminiAPI(prompt);
  } catch (error) {
    console.error("Error generating mind map:", error);
    return "<p>Failed to generate mind map. Please try again.</p>";
  }
};

// --- Chatbot Functions ---

interface ChatSession {
  messages: Array<{ role: 'user' | 'model'; content: string }>;
}

let tutorChatSession: ChatSession | null = null;
let advisorChatSession: ChatSession | null = null;

// Context-Aware AI Tutor for Logged-In Users
const createTutorSystemPrompt = (courses: any[], calendarEvents: any[]): string => {
  const courseInfo = courses.map(c => `- ${c.title} (Status: ${c.enrollmentStatus || 'unknown'})`).join('\n');
  const assignmentInfo = calendarEvents
    .filter(e => e.type === 'assignment')
    .map(a => `- ${a.title} (Due: ${a.date})`)
    .join('\n');

  return `You are Tertiary, a helpful and friendly AI tutor for an online learning platform.
Your user is currently enrolled in the following courses:
${courseInfo || 'None'}

They have the following upcoming assignments:
${assignmentInfo || 'None'}

Use this context to answer questions about their pending assignments or to explain concepts related to their courses. 
If asked a general question, answer it clearly and concisely. Keep your tone encouraging and positive.
Provide helpful, educational responses that support their learning journey.`;
};

export const getTutorResponseStream = async function* (
  message: string,
  courses: any[],
  calendarEvents: any[]
): AsyncGenerator<{ text: string }, void, unknown> {
  try {
    const systemPrompt = createTutorSystemPrompt(courses, calendarEvents);

    // Initialize session if not exists
    if (!tutorChatSession) {
      tutorChatSession = { messages: [] };
    }

    // Add user message to session
    tutorChatSession.messages.push({ role: 'user', content: message });

    // Create the full prompt with context and conversation history
    const conversationHistory = tutorChatSession.messages
      .slice(-10) // Keep last 10 messages for context
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const fullPrompt = `${systemPrompt}

Conversation History:
${conversationHistory}

Please respond to the latest user message:`;

    const response = await callGeminiAPI(fullPrompt);

    // Add AI response to session
    tutorChatSession.messages.push({ role: 'model', content: response });

    // Simulate streaming by yielding the response
    yield { text: response };

  } catch (error) {
    console.error('Error in getTutorResponseStream:', error);
    yield { text: 'Sorry, I encountered an error. Please try again.' };
  }
};

export const resetTutorChat = () => {
  tutorChatSession = null;
};

// Public Course Advisor for Homepage
const createAdvisorSystemPrompt = (courses: any[]): string => {
  const courseList = courses.map(c => `- ${c.title} (Fee: $${c.courseFee || 'TBA'})`).join('\n');

  return `You are a helpful AI Course Advisor for an online learning platform.
You can help prospective students learn about our available courses:

Available Courses:
${courseList || 'No courses currently available'}

Answer questions about course content, fees, duration, and help users find the right course for their needs.
Be encouraging and informative. If asked about courses not in the list, politely explain you can only provide information about the courses offered by this platform.`;
};

export const getAdvisorResponseStream = async function* (
  message: string,
  courses: any[]
): AsyncGenerator<{ text: string }, void, unknown> {
  try {
    const systemPrompt = createAdvisorSystemPrompt(courses);

    // Initialize session if not exists
    if (!advisorChatSession) {
      advisorChatSession = { messages: [] };
    }

    // Add user message to session
    advisorChatSession.messages.push({ role: 'user', content: message });

    // Create the full prompt with context and conversation history
    const conversationHistory = advisorChatSession.messages
      .slice(-10) // Keep last 10 messages for context
      .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');

    const fullPrompt = `${systemPrompt}

Conversation History:
${conversationHistory}

Please respond to the latest user message:`;

    const response = await callGeminiAPI(fullPrompt);

    // Add AI response to session
    advisorChatSession.messages.push({ role: 'model', content: response });

    // Simulate streaming by yielding the response
    yield { text: response };

  } catch (error) {
    console.error('Error in getAdvisorResponseStream:', error);
    yield { text: 'Sorry, I encountered an error. Please try again.' };
  }
};