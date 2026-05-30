import type { FeedbackFormSection } from '../types';

export const DEFAULT_FEEDBACK_FORM_TITLE = 'Course Feedback';

export const DEFAULT_FEEDBACK_FORM_SECTIONS: FeedbackFormSection[] = [
  {
    id: 'section-1',
    title: 'Your Details',
    fields: [
      { id: 'course_title', label: 'Course Title', type: 'text', required: true, autofill: 'course_title', readonly: true },
      { id: 'course_code', label: 'Course Code', type: 'text', required: true, autofill: 'course_code', readonly: true },
      { id: 'learner_name', label: "Student's Full Name", type: 'text', required: true },
      { id: 'start_date', label: 'Class Start Date', type: 'date', autofill: 'start_date', readonly: true },
      { id: 'end_date', label: 'Class End Date', type: 'date', autofill: 'end_date', readonly: true },
    ],
  },
  {
    id: 'section-2',
    title: 'Course Evaluation',
    fields: [
      {
        id: 'rate_learning_objectives',
        label: 'Overall, how would you rate the course meeting the learning objectives?',
        type: 'rating1to5',
        required: true,
      },
      {
        id: 'rate_trainer_knowledge',
        label: 'Overall, how would you rate trainer knowledgeable in this subject matter?',
        type: 'rating1to5',
        required: true,
      },
      {
        id: 'rate_training_environment',
        label: 'Overall, how would you rate the training environment?',
        type: 'rating1to5',
        required: true,
      },
      {
        id: 'message',
        label: 'Additional comments (optional)',
        type: 'textarea',
        required: false,
      },
    ],
  },
];
