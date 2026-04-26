// Default prompt templates for the CP Generator.
// Ported verbatim from the Streamlit original (alfredang/wsq-casl-cp-generator,
// app/ai_generator.py) so every section mirrors the supervisor-approved output.
// Supervisor edits are upserted into the `cp_prompt_template` table and
// override these defaults at generation time — see lib/cp-generate flow.
//
// When a Streamlit template used the bare variable `{course}`, it is preserved
// verbatim here (the handler maps both `{course}` and `{course_title}` to the
// course title). `{industry}` on the validation template maps to '' when the
// UI has no industry input.

export type CpPromptSection =
  | 'suggest_titles'
  | 'generate_topics'
  | 'about_course'
  | 'what_youll_learn'
  | 'background_a'
  | 'background_b'
  | 'learning_outcomes'
  | 'instructional_methods'
  | 'assessment_methods'
  | 'lu_sequencing'
  | 'course_outline'
  | 'entry_requirements'
  | 'job_roles'
  | 'lesson_plan'
  | 'validation';

const SUGGEST_TITLES_PROMPT = `You are an expert course naming strategist for professional training and continuing education programmes. Brainstorm 20 course titles for the following course topic.

Course Topic: {course}

Guidelines:
- Generate exactly 20 course titles
- Titles should be appealing and engaging for potential learners
- Titles should be optimized for search engine visibility (SEO-friendly)
- Include relevant keywords that learners would search for
- Mix different title styles: descriptive, action-oriented, outcome-focused, and benefit-driven
- Titles should be concise (3-10 words each)
- Titles should sound professional and suitable for WSQ/CASL course listings
- Number each title from 1 to 20
- Do NOT use markdown formatting
- Do NOT include descriptions or explanations — titles only

Example (Course Topic: Digital Marketing):

1. Digital Marketing Essentials
2. Mastering Digital Marketing Strategies
3. Digital Marketing for Business Growth
4. Strategic Digital Marketing and Analytics
5. Digital Marketing Campaign Management
6. Online Marketing and Social Media Mastery
7. Data-Driven Digital Marketing
8. Digital Marketing in the Age of AI
9. Fundamentals of Digital Marketing
10. Digital Marketing and Brand Strategy
11. Advanced Digital Marketing Techniques
12. Digital Marketing for Professionals
13. Effective Digital Marketing Campaigns
14. Digital Marketing and Customer Engagement
15. Modern Digital Marketing Practices
16. Digital Marketing Strategy and Execution
17. Applied Digital Marketing Skills
18. Digital Marketing and E-Commerce
19. Digital Marketing for Career Advancement
20. Integrated Digital Marketing Solutions

Respond with ONLY the numbered list of titles, nothing else.`;

const GENERATE_TOPICS_PROMPT = `You are an expert curriculum designer for professional training and continuing education programmes. Generate a structured list of course topics with learning outcomes for the following course.

Course Title: {course_title}
Course Duration: {num_days} day(s)
Maximum Topics: {max_topics} (max 3 per day)
{skill_context}{special_requirements}
Guidelines:
- Generate the appropriate number of topics to comprehensively cover the subject matter{skill_guideline}
- You decide how many topics are needed — do NOT exceed {max_topics} topics (max 3 per day for {num_days} day(s))
- Each topic should represent a distinct, teachable module or unit
- Topics should follow a logical learning progression (foundational to advanced)
- Use concise, professional topic names (3-8 words each)
- Each topic must include 3-5 specific learning outcomes as bullet points
- Learning outcomes should start with action verbs (Explain, Describe, Identify, Recognise, Differentiate, Develop, Apply, Analyse, Evaluate)
- Topics should be suitable for WSQ/CASL course proposals
- Use the exact markdown format shown in the example below
- Use ## for topic headings with numbering (## Topic 1: ...)
- Use - for learning outcome bullet points
- Add two trailing spaces after each bullet point line for line breaks

Example (Course: Business Innovation with Agentic AI, 6 topics):

## Topic 1: Business Innovation in the Age of Agentic AI
- Explain the evolution of business innovation in relation to artificial intelligence
- Describe the key characteristics of Agentic AI
- Identify potential applications of Agentic AI across different industries
- Recognise opportunities for business innovation enabled by Agentic AI

## Topic 2: Agentic Vibe Coding for Business Innovation
- Describe the concept and purpose of Agentic Vibe Coding
- Explain intent-driven approaches to coding and system design
- Identify the roles, goals, and constraints of AI agents in business contexts
- Recognise the use of low-code and no-code platforms for agentic solutions

## Topic 3: Agentic Workflow Design for Business Processes
- Differentiate between single-agent and multi-agent systems
- Explain how agents collaborate and coordinate within workflows
- Identify business processes suitable for agentic workflow implementation
- Describe human-AI collaboration models within agentic systems

## Topic 4: Building an Agentic AI Workforce
- Explain the concept of AI agents as digital workers
- Identify role-based designs for an Agentic AI workforce
- Describe approaches to scaling agentic teams within organisations
- Explain methods for managing and monitoring AI workforce performance

## Topic 5: Governance, Risk, and Ethics in Agentic AI
- Explain governance frameworks applicable to Agentic AI systems
- Identify risks associated with autonomous and semi-autonomous AI systems
- Describe ethical considerations in the deployment of Agentic AI
- Recognise regulatory and compliance considerations relevant to Agentic AI

## Topic 6: Measuring Innovation and Business Impact
- Identify performance indicators for Agentic AI initiatives
- Explain methods for measuring business value and return on investment
- Describe change management considerations for AI adoption
- Develop a roadmap for enterprise-scale deployment of Agentic AI solutions

Respond with ONLY the formatted topics and learning outcomes, nothing else.`;

const ABOUT_COURSE_PROMPT = `You are an expert course description writer for professional training and continuing education programmes. Write an "About the Course" section for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- Write in second person ("you") or third person ("learners", "professionals", "participants")
- Provide a clear overview of what the course covers
- Highlight practical benefits: skills gained, competencies developed, and professional needs the course addresses
- Explain industry relevance and career impact (employment opportunities, job upgrading, professional development)
- The target learner level is generally beginner to intermediate; reflect this in the description
- Keep the tone professional, engaging, and encouraging
- Write exactly 2 cohesive paragraphs of 350 words
-Give a high level overview of your course
-Highlight the benefits your course offers including skills, competencies and needs that the course will address
-Explain how the course is relevant to the industry and how it may impact the learner's career in terms of employment/job upgrading opportunities
-Indicate if the course is for beginner, intermediate or advanced learners
- Do NOT use bullet points, numbered lists, or headings
- Do NOT include the course title in the opening words; weave it in naturally or refer to "this course"
- Do NOT use markdown formatting
- IMPORTANT: The entire response must NOT exceed 2000 characters`;

const WHAT_YOULL_LEARN_PROMPT = `You are an expert course description writer for professional training and continuing education programmes. Write a "What You'll Learn" section for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- Write one bullet point per major course topic or learning outcome
- Each bullet should describe a specific skill or knowledge the learner will gain
- Start each bullet with "Participants will" or "Learners will"
- Each bullet should be 40-60 words, written as a single cohesive sentence
- Include action verbs like: apply, analyse, demonstrate, evaluate, design, implement, interpret, develop, execute, monitor, assess
- Include keywords relevant to the course to help with search discoverability
- Describe practical, real-world application of the skills where possible
- Keep the tone professional, specific, and outcome-focused
- Write 3-5 bullet points depending on the number of topics
- Use a bullet character (•) at the start of each point
- Do NOT use markdown formatting, numbering, or headings
- Separate each bullet point with a blank line
- IMPORTANT: The entire response must NOT exceed 2000 characters

Examples of good "What You'll Learn" bullet points:

Example 1:
• Participants will be able to conduct user research and usability testing to identify user needs and preferences and use this information to design more user-friendly products and services.
• Participants will be able to apply the principles of design thinking to identify and solve complex problems in their work context.
• Participants will be able to implement agile methodologies to manage projects and teams more effectively, resulting in increased productivity and better outcomes.

Example 2:
• Learners will demonstrate their ability to apply strategic marketing principles by analysing market trends, identifying target segments, and developing effective marketing strategies. They will translate theoretical concepts into actionable plans that encompass product positioning, pricing, distribution, and promotion, showcasing their proficiency in devising comprehensive marketing campaigns.
• Learners will showcase their sales acumen by executing a variety of sales techniques such as consultative selling and objection handling. Through role-play scenarios, they will demonstrate their ability to adapt their approaches based on customer needs, effectively communicate product value, and navigate the sales process to achieve successful outcomes.
• Learners will interpret consumer behaviour data sourced from multiple touchpoints, such as CRM systems and e-commerce platforms. They will demonstrate their skills in translating raw data into meaningful insights, identifying trends, and presenting findings that guide marketing decisions aimed at enhancing customer experiences and driving sales growth.

Respond with ONLY the bullet points, nothing else.`;

const BACKGROUND_A_PROMPT = `You are an expert course description writer for professional training and continuing education programmes. Write a "Background Part A" section for the following course. This section covers the targeted sector(s) background, target audience / job role(s), and needs for the training.

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- Identify the specific industry sectors or domains that the course targets, naming concrete sub-sectors, organisation types, or market segments where applicable
- Describe in depth the current pressures, regulatory shifts, technology trends, market dynamics, or structural challenges facing these sectors that create the need for this training — reference Singapore's industry context where it strengthens the argument
- Identify the target audience precisely: list specific job roles, professional designations, or practitioner categories who would benefit, and explain the responsibilities those roles carry
- Explain why there is a skills gap or training need: cover both the workforce-readiness angle (what practitioners struggle with today) and the organisational angle (capability gaps holding teams back)
- Use a substantive, evidence-grounded tone suitable for an SSG / WSQ course proposal — concrete enough that an industry reviewer would recognise the sector accurately
- Write exactly 3 cohesive paragraphs totalling 280-400 words. Paragraph 1: sector context and pressures. Paragraph 2: target audience and the work they do. Paragraph 3: skills gap, training need, and how this course closes it.
- Do NOT use bullet points, numbered lists, or headings
- Do NOT use markdown formatting

Examples:

Example 1:
• This course is targeted at sectors that are significantly impacted by decarbonisation, sustainability, and ESG requirements, including but not limited to:
Manufacturing and Industrial Services
Energy and Utilities
Built Environment, Construction, and Facilities Management
Logistics, Transportation, and Supply Chain Management
Professional Services and Consulting
Financial Services and Corporate Functions supporting ESG reporting

These sectors face increasing pressure from regulatory requirements, corporate sustainability commitments, investor expectations, and customer demand to measure, manage, and reduce carbon emissions. As a result, there is a growing need for professionals who can support carbon accounting, emissions reduction planning, and decarbonisation strategy development.

Respond with ONLY the paragraph text, nothing else.`;

const BACKGROUND_B_PROMPT = `You are an expert course description writer for professional training and continuing education programmes. Write a "Background Part B" section for the following course. This section covers:
1. Performance gaps that the course will address
2. How the performance gaps were identified (e.g., market research, focus group discussions, surveys, Skills Frameworks, etc.)
3. How the attributes gained post training would benefit learners

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- First paragraph: Describe the observable performance gaps in the workforce related to the course topics — what skills or competencies are lacking
- Second paragraph: Explain how these gaps were identified — reference specific methodologies such as Skills Frameworks (SFw), Singapore Jobs-Skills Portal, industry consultations, employer feedback, market research, focus groups, or surveys
- Third section: List 3-5 bullet points describing how learners will benefit post-training — each bullet should start with a verb phrase and describe a specific benefit (closing skills gaps, enhancing career readiness, improving performance, strengthening adaptability)
- Write in a professional, factual tone suitable for a course proposal document
- Use a dash (- ) at the start of each benefit bullet point
- Do NOT use markdown formatting or headings

Examples:

Example 1:
• Organisations across multiple sectors have been navigating rapid changes in business processes, technology integration, and performance expectations. While many professionals are familiar with routine operational tasks, there is an observable performance gap in strategic productivity and innovation capabilities—including the ability to systematically analyse productivity challenges, develop aligned strategies, and evaluate results effectively. Workers often lack structured skills in productivity management, innovation tools implementation, performance measurement, and continuous improvement frameworks, limiting their impact on organisational transformation initiatives.

These performance gaps have been identified through analysis of the Skills Frameworks (SFw) developed under the Singapore Jobs-Skills Portal. The Skills Frameworks map job roles with essential skills and competencies based on industry insights from employers, industry associations, professional bodies, and government partners. Analysis of this framework reveals that roles involved in operations, business improvement, and strategic leadership demand enhanced competencies in productivity strategy, innovation management, performance monitoring, and results evaluation to meet emerging job requirements and support organisational performance growth. The Skills Frameworks are updated regularly to reflect current and future skill needs across sectors, enabling training providers and learners to identify gaps between existing competencies and those required for career progression and business impact.

By attending this course, learners will benefit in several key ways:
- Close the skills gap in productivity strategy and innovation management by acquiring structured methodologies and tools that align with industry-recognised skills and competencies outlined in the Skills Frameworks.
- Enhance career readiness by gaining capabilities that are increasingly valued in roles related to productivity improvement, operations, and business transformation, improving prospects for job upgrading and broader career opportunities.
- Improve individual and organisational performance by learning how to implement frameworks that generate measurable outcomes, enabling learners to contribute to strategic decision-making, performance evaluation, and continuous improvement practices.
- Strengthen adaptability to workplace change by building confidence in applying productivity and innovation concepts to real organisational challenges, fostering both professional growth and organisational competitiveness.

Respond with ONLY the text, nothing else.`;

const LEARNING_OUTCOMES_PROMPT = `You are an expert instructional designer for professional training and continuing education programmes. Generate learning outcomes for each topic of the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- Generate exactly ONE learning outcome for EACH topic
- Each learning outcome MUST summarise the entire topic — it should capture the overall knowledge and skills covered in that topic in a single sentence
- Each learning outcome MUST start with an action verb (e.g., Apply, Analyse, Demonstrate, Evaluate, Design, Implement, Interpret, Develop, Execute, Monitor, Assess, Explain, Describe, Identify, Recognise, Differentiate)
- Each learning outcome MUST be less than 25 words
- Learning outcomes should be specific, measurable, and achievable
- Number topics as T1, T2, T3, etc.
- Number learning outcomes to match: T1 gets LO1, T2 gets LO2, etc.
- Use the exact format shown in the example below

Example:

T1: Business Innovation in the Age of Agentic AI
LO1: Explain core AI-driven business innovation concepts, Agentic AI characteristics, industry applications, and emerging opportunities for transformation.

T2: Agentic Vibe Coding for Business Innovation
LO2: Apply intent-driven coding approaches to design, build, and evaluate agentic solutions using low-code and no-code platforms.

T3: Agentic Workflow Design for Business Processes
LO3: Design agentic workflows by differentiating agent architectures, coordinating multi-agent collaboration, and integrating human-AI models.

T4: Building an Agentic AI Workforce
LO4: Develop an Agentic AI workforce strategy covering role-based design, team scaling, and performance monitoring approaches.

Respond with ONLY the formatted topics and learning outcomes, nothing else.`;

const INSTRUCTION_METHOD_PROMPT = `You are an expert instructional designer for professional training and continuing education programmes. Write an elaboration on the appropriateness of the given instructional method to achieve the learning outcomes for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Instructional Method: {method_name}

Guidelines:
- Explain why this instructional method is highly suitable for this course
- Describe how the method supports the learning of the specific course topics
- Reference adult learning principles where applicable
- Explain how the method enables learners to contextualise concepts and relate them to their own organisational challenges
- Describe how the method supports knowledge retention and practical application
- Explain how the method allows adaptation to different industries and job roles
- Write 4-5 cohesive paragraphs totalling 250-400 words
- Write in a professional, factual tone suitable for a course proposal document
- Do NOT use bullet points, numbered lists, or headings
- Do NOT use markdown formatting

Examples:

Example 1 (Interactive presentation):
• An interactive presentation approach is highly suitable for the Productivity and Innovation Strategy course as the subject matter requires learners to not only understand conceptual frameworks, but also to actively apply strategic thinking, analysis, and problem-solving skills in a workplace context. Productivity and innovation concepts are best learned through engagement, discussion, and practical reflection, rather than passive content delivery.

This course involves topics such as productivity strategy formulation, innovation tools, performance measurement, and continuous improvement systems, which benefit from two-way interaction between the trainer and learners. Through interactive presentations, learners are encouraged to participate in discussions, ask questions, share workplace experiences, and analyse real-world scenarios. This enables learners to contextualise abstract concepts and relate them directly to their own organisational challenges.

Interactive presentations also support adult learning principles, where working professionals bring prior experience and diverse perspectives to the learning environment. Activities such as guided discussions, scenario analysis, short exercises, and knowledge checks allow learners to validate their understanding, clarify misconceptions, and reinforce learning outcomes in real time. This approach enhances comprehension of complex productivity and innovation frameworks and improves knowledge retention.

In addition, productivity and innovation strategies often vary across industries and job roles. An interactive presentation format allows the trainer to adapt examples and discussions dynamically based on learners' sectors and roles, ensuring relevance and applicability. Learners gain exposure to different viewpoints and best practices, which supports cross-functional learning and innovation thinking.

Overall, the use of interactive presentation facilitates active engagement, practical understanding, and immediate application of productivity and innovation concepts, making it an effective and appropriate delivery mode for achieving the course learning outcomes and supporting learners' workplace performance.

Respond with ONLY the paragraph text, nothing else.`;

const ASSESSMENT_METHOD_PROMPT = `You are an expert instructional designer for professional training and continuing education programmes. Write an elaboration on the appropriateness of the given mode of assessment for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Assessment Method: {method_name}

Guidelines:
- Explain why this assessment method is appropriate for evaluating learners' understanding and applied knowledge of the course topics
- Describe what the assessment enables learners to demonstrate (comprehension, application of frameworks, articulation of concepts)
- Explain why this format is suitable (structured evaluation, objectivity, consistency, fairness)
- Connect the assessment to the knowledge-based learning outcomes of the course
- Write 2-3 cohesive paragraphs totalling 100-200 words
- Write in a professional, factual tone suitable for a course proposal document
- Do NOT use bullet points, numbered lists, or headings
- Do NOT use markdown formatting

Examples:

Example 1 (Written Examination):
• The Written Examination is an appropriate assessment method for evaluating learners' theoretical understanding and applied knowledge of key productivity and innovation concepts covered in the Productivity and Innovation Strategy course. This assessment method enables learners to demonstrate their comprehension of productivity principles, innovation strategies, productivity management frameworks, continuous improvement concepts, and performance measurement systems, which are essential for effective decision-making and implementation in organisational contexts.

A written format is particularly suitable as it allows for structured and objective evaluation of learners' ability to explain concepts, apply recognised productivity and innovation frameworks, and articulate reasoned responses in a professional and systematic manner. This aligns with the knowledge-based learning outcomes of the course and ensures consistency and fairness in assessment across all learners.

Respond with ONLY the paragraph text, nothing else.`;

// Streamlit has 5 separate LU Sequencing templates (step-by-step, simple-to-complex,
// part-to-part-to-part, part-to-whole, spiral). We store a single template with a
// {sequencing_type} placeholder so the supervisor can edit one prompt that works
// across all sequencing types. The worked example below is from the Streamlit
// step-by-step template — the supervisor can override via the editor if they
// want per-type variations.
const LU_SEQUENCING_PROMPT = `Ignore all the previous instructions and start from beginning.
You are an experienced course developer and instructional designer.

Course Title: {course}

Learning Outcomes:
{learning_outcomes}

Course Outline:
{course_outline}

TASK:
You will need to justify the rationale of sequencing using the {sequencing_type} curriculum framework for this course - {course}
Your justification based on the course outline and learning outcomes.

OUTPUT FORMAT:
Output your response in the following format with reference to the learning outcomes and course outline. Start with an introductory paragraph explaining why {sequencing_type} sequencing is appropriate for this course, then provide a justification for each Learning Unit (LU). For example (worked example uses step-by-step sequencing — adapt the structure to {sequencing_type}):

For this course, the step-by-step sequencing is employed to scaffold the learners' comprehension and application of video marketing strategies using AI tools. The methodology is crucial as it systematically breaks down the intricate facets of video marketing, inbound marketing strategies, and AI tools into digestible units. This aids in gradually building the learners' knowledge and skills from fundamental to more complex concepts, ensuring a solid foundation before advancing to the next topic. The progression is designed to foster a deeper understanding and the ability to effectively apply the learned concepts in real-world marketing scenarios.

LU1: Translating Strategy into Action and Fostering a Customer-Centric Culture
LU1 lays the foundational knowledge by introducing learners to the organization's inbound marketing strategies and how they align with the overall marketing strategy. The facilitator will guide learners through translating these strategies into actionable plans and understanding the customer decision journey. This unit sets the stage for fostering a customer-centric culture with a particular focus on adhering to organizational policies and guidelines. The integration of AI tools in these processes is introduced, giving learners a glimpse into the technological aspects they will delve deeper into in subsequent units.

LU2: Improving Inbound Marketing Strategies and Content Management
Building on the foundational knowledge, LU2 dives into the practical aspects of content creation and curation and how AI tools can be utilized for strategy improvement. Learners will be led through exercises to recommend improvements and manage content across various platforms. The hands-on activities in this unit are designed to enhance learners' ability to manage and optimize video content, crucial skills in video marketing with AI tools.

LU3: Leading Customer Decision Processes and Monitoring Inbound Marketing Effectiveness
LU3 escalates to a higher level of complexity where learners delve into lead conversion processes, leading customers through decision processes, and evaluating marketing strategy effectiveness. Under the guidance of the facilitator, learners will engage in monitoring and reviewing inbound marketing strategies, thereby aligning theoretical knowledge with practical skills in a real-world context. The synthesis of previous knowledge with advanced concepts in this unit culminates in a comprehensive understanding of video marketing with AI tools, equipping learners with the requisite skills to excel in the modern marketing landscape.

Respond with ONLY the rationale text, nothing else.`;

const COURSE_OUTLINE_PROMPT = `You are an expert course developer for professional training programmes.
Generate a detailed course outline for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Instructional Methods: {instructional_methods}

Duration per Topic: {duration_per_topic} minutes

Guidelines:
- Section (1): List all topics covered in this course, numbered as T1, T2, etc.
  For each topic, provide a brief 1-2 sentence description of what the topic covers.
- Section (2): List the instructional methods used in this course.
  For each method, provide a brief 1-sentence explanation of how it is applied in the course.
- Section (3): Show the duration allocated for each topic in minutes.
  Present as a simple list with topic name and duration.
- Keep the tone professional and concise
- Do NOT use markdown formatting or headings
- Use plain text with clear section labels
- IMPORTANT: The entire response must NOT exceed 2000 characters

Format your response exactly as follows:

(1) The list of topics covered in this course
T1: [Topic Name] - [Brief description]
T2: [Topic Name] - [Brief description]
...

(2) Instructional methods
[Method 1] - [How it is applied]
[Method 2] - [How it is applied]
...

(3) Duration for each topic
Topic 1: [duration]mins
Topic 2: [duration]mins
...`;

const ENTRY_REQUIREMENTS_PROMPT = `You are an expert course description writer for professional training and continuing education programmes. Write a "Minimum Entry Requirement" section for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}
{special_requirements}
Guidelines:
- Structure the output into these categories: Knowledge and Skills, Attitude, Experience, and Target Age Group
- Under Knowledge and Skills: state educational qualifications (e.g., GCE 'O' Levels, diploma, degree) and any language proficiency requirements
- Under Attitude: describe the learning attitude expected of participants
- Under Experience: state the minimum years of working experience required
- Include a target age group (typically 21-65 years old)
- Use bullet points with a bullet character (•) for each requirement
- The target learner level is generally beginner to intermediate
- Write in a professional, factual tone suitable for a course proposal document
- Do NOT use markdown formatting or headings
- IMPORTANT: The entire response must NOT exceed 2000 characters

Examples:

Example 1:
Knowledge and Skills
• Able to operate using computer functions
• Minimum 3 GCE 'O' Levels Passes including English or WPL Level 5 (Average of Reading, Listening, Speaking & Writing Scores)
Attitude
• Positive Learning Attitude
• Enthusiastic Learner
Experience
• Minimum of 1 year of working experience

Target age group: 21-65 years old

Respond with ONLY the text, nothing else.`;

const JOB_ROLES_PROMPT = `You are an expert in Singapore's workforce development ecosystem. Generate 10 relevant job roles for the following course. The job role names must follow the naming conventions used on the SSG Skills Framework and MySkillsFuture Jobs-Skills Portal.

Course Title: {course_title}

Course Topics:
{course_topics}

Guidelines:
- Generate exactly 10 job roles that are directly relevant to the course content
- Each job role name MUST follow the official naming used on the SSG Skills Framework / MySkillsFuture Jobs-Skills Portal
- Use the standard format: Job Title / Designation (e.g., "Marketing Manager", "Business Development Executive", "Digital Marketing Specialist")
- List all 10 job roles in a single comma-separated line
- Do NOT include descriptions, explanations, or numbering
- Do NOT use markdown formatting

Respond with ONLY the comma-separated job roles, nothing else.`;

const LESSON_PLAN_PROMPT = `You are an expert instructional designer for professional training and continuing education programmes. Generate a detailed day-by-day lesson plan for the following course.

Course Title: {course_title}

Course Topics:
{course_topics}

Course Duration: {course_duration} hours ({num_days} day(s))
Instructional Duration: {instructional_duration} hours
Assessment Duration: {assessment_duration} hours
Instructional Methods: {instructional_methods}
Assessment Methods: {assessment_methods}

Guidelines:
- Create a day-by-day lesson plan with time slots from 9:00 AM to 6:00 PM
- Include a 45-minute lunch break at 12:30 PM - 1:15 PM each day
- Each topic gets EQUAL time: {instructional_duration} hours * 60 / number of topics
- Topics can split into 2 sessions across lunch or day boundaries (e.g. "T2 (Cont'd)")
- Assessment: fixed at 4:00 PM - 6:00 PM on last day
- Fill remaining time with breaks to fit exactly 9:00 AM - 6:00 PM
- For each time slot, you MUST include ALL of these fields on separate lines:
  1. Time range and topic name line: "9:00 AM - 10:30 AM | T1: Topic Name"
  2. Duration line: "Duration: 90 mins"
  3. Key learning points: 2-3 bullet points starting with •
  4. Instructional method line: "Instructional Method: method name"
- For Lunch Break and Break slots, only include the time range and name
- Use plain text format with clear headers for each day
- Separate each day with a blank line
- Do NOT use markdown formatting (no #, **, etc.)
- IMPORTANT: Ensure all topics from the course are covered

Example format:

Day 1 (9:00 AM - 6:00 PM)

9:00 AM - 12:30 PM | T1: Introduction to Business Innovation
Duration: 210 mins
• Explain the evolution of business innovation
• Describe key characteristics and applications
• Identify opportunities for transformation
Instructional Method: Interactive presentation

12:30 PM - 1:15 PM | Lunch Break

1:15 PM - 4:00 PM | T2: Agentic Vibe Coding
Duration: 165 mins
• Apply intent-driven coding approaches
• Design agentic solutions using low-code platforms
Instructional Method: Demonstrations / Modelling

4:00 PM - 6:00 PM | T2: Agentic Vibe Coding (Cont'd)
Duration: 120 mins
• Evaluate agent performance metrics
• Build and test agentic workflows
Instructional Method: Demonstrations / Modelling

Day 2 (9:00 AM - 6:00 PM)

9:00 AM - 12:30 PM | T3: Workflow Design
Duration: 210 mins
• Differentiate between agent architectures
• Coordinate multi-agent collaboration
Instructional Method: Case studies

12:30 PM - 1:15 PM | Lunch Break

1:15 PM - 4:00 PM | T4: Building AI Workforce
Duration: 165 mins
• Explain role-based designs for AI workforce
• Describe approaches to scaling agentic teams
Instructional Method: Discussions

4:00 PM - 6:00 PM | Assessment
Duration: 120 mins
• Written Examination covering all topics

Respond with ONLY the lesson plan text, nothing else.`;

const VALIDATION_PROMPT = `As a director in a company, your role is to assist users in determining the relevance and potential impact of various courses for specific industries.

Course Title: {course}
Industry: {industry}
Learning Outcomes:
{learning_outcomes}

TASKS:
You will generate FIVE distinct responses to two survey questions:
1. What are the performance gaps in the industry (1-2 paragraphs are sufficed)
2. Why you think this WSQ course will address the training needs for the industry (1-2 paragraphs are sufficed)

RULES:
1. Do not mention learning outcomes in the response.
2. Do not mention you are the director
3. Do not mention the specific industry by name
4. 1 or 2 paragraphs answers for each question in the survey
5. Each paragraph is less than 120 words
6. Only consider 1 or 2 of the learning outcomes for your response.
7. The response need to related to the course, industry and learning outcomes
8. For each set of response, you will generate the responses use different learning outcomes and different style.

OUTPUT FORMAT:
For each set, use the following format:

Set 1:
1. What are the performance gaps in the industry (1-2 paragraphs are sufficed)

(Enter your answer here)

2. Why you think this WSQ course will address the training needs for the industry (1-2 paragraphs are sufficed)

(Enter your answer here)

Set 2:
...

You will generate FIVE distinct sets of responses for the survey above.

Respond with ONLY the five sets of responses, nothing else.`;

export const DEFAULT_CP_PROMPTS: Record<CpPromptSection, string> = {
  suggest_titles: SUGGEST_TITLES_PROMPT,
  generate_topics: GENERATE_TOPICS_PROMPT,
  about_course: ABOUT_COURSE_PROMPT,
  what_youll_learn: WHAT_YOULL_LEARN_PROMPT,
  background_a: BACKGROUND_A_PROMPT,
  background_b: BACKGROUND_B_PROMPT,
  learning_outcomes: LEARNING_OUTCOMES_PROMPT,
  instructional_methods: INSTRUCTION_METHOD_PROMPT,
  assessment_methods: ASSESSMENT_METHOD_PROMPT,
  lu_sequencing: LU_SEQUENCING_PROMPT,
  course_outline: COURSE_OUTLINE_PROMPT,
  entry_requirements: ENTRY_REQUIREMENTS_PROMPT,
  job_roles: JOB_ROLES_PROMPT,
  lesson_plan: LESSON_PLAN_PROMPT,
  validation: VALIDATION_PROMPT,
};

// Placeholder hints shown in the template editor. Lists every {token} the
// Streamlit template actually references so the supervisor can see what's
// safe to rearrange.
export const CP_PROMPT_PLACEHOLDERS: Record<CpPromptSection, readonly string[]> = {
  suggest_titles: ['course'],
  generate_topics: ['course_title', 'num_days', 'max_topics', 'skill_context', 'skill_guideline', 'special_requirements'],
  about_course: ['course_title', 'course_topics'],
  what_youll_learn: ['course_title', 'course_topics'],
  background_a: ['course_title', 'course_topics'],
  background_b: ['course_title', 'course_topics'],
  learning_outcomes: ['course_title', 'course_topics'],
  instructional_methods: ['method_name', 'course_title', 'course_topics'],
  assessment_methods: ['method_name', 'course_title', 'course_topics'],
  lu_sequencing: ['course', 'learning_outcomes', 'course_outline', 'sequencing_type'],
  course_outline: ['course_title', 'course_topics', 'instructional_methods', 'duration_per_topic'],
  entry_requirements: ['course_title', 'course_topics', 'special_requirements'],
  job_roles: ['course_title', 'course_topics'],
  lesson_plan: ['course_title', 'course_topics', 'course_duration', 'num_days', 'instructional_duration', 'assessment_duration', 'instructional_methods', 'assessment_methods'],
  validation: ['course', 'industry', 'learning_outcomes'],
};

export const CP_PROMPT_SECTION_LABELS: Record<CpPromptSection, string> = {
  suggest_titles: 'Suggest Course Titles',
  generate_topics: 'Generate Topics',
  about_course: 'About This Course',
  what_youll_learn: "What You'll Learn",
  background_a: 'Background Part A',
  background_b: 'Background Part B',
  learning_outcomes: 'Learning Outcomes',
  instructional_methods: 'Instructional Methods',
  assessment_methods: 'Assessment Methods',
  lu_sequencing: 'LU Sequencing',
  course_outline: 'Course Outline',
  entry_requirements: 'Entry Requirements',
  job_roles: 'Job Roles',
  lesson_plan: 'Lesson Plan',
  validation: 'Validation',
};
