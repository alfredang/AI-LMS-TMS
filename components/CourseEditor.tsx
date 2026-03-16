import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Course, Topic, Subtopic, Assessment, AssessmentCategory, ModeOfLearning, UserRole } from '@app-types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import Spinner from './ui/Spinner';
import { generateCourseImage } from '@lib/services/geminiService';
import { extractFilenameFromPath } from '@utils/fileUtils';
import { getCourseImageUrl } from '@utils/imageUtils';
import { getApiUrl } from '@/lib/urlHelpers';

const inputGhostClasses = (isTitle: boolean) =>
    `flex-grow border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 focus:outline-none w-full transition-colors dark:text-white ${isTitle ? 'font-bold text-xl' : 'text-base'}`;

// Helper function to display original filename
const getDisplayFilename = (existingUrl: string | undefined, filename?: string | undefined): string => {
    console.log('🔍 getDisplayFilename called with existingUrl:', existingUrl);
    if (existingUrl) {
        return extractFilenameFromPath(existingUrl);
    } else {
        return filename || 'No file uploaded.';
    }
};

// Sub-component for an editable Learning Unit (Topic)
const EditableTopicAccordion: React.FC<{
    topic: Topic;
    onUpdateTitle: (topicId: string, newTitle: string) => void;
    onDelete: (topicId: string) => void;
    onAddSubtopic: (topicId: string) => void;
    onUpdateSubtopic: (topicId: string, subtopicId: string, newTitle: string) => void;
    onDeleteSubtopic: (topicId: string, subtopicId: string) => void;
    // Drag-and-drop props for subtopics
    draggedSubtopic: { topicId: string; subtopicId: string } | null;
    dropTargetSubtopic: { topicId: string; subtopicId: string } | null;
    onSubtopicDragStart: (e: React.DragEvent, topicId: string, subtopicId: string) => void;
    onSubtopicDrop: (e: React.DragEvent, topicId: string, subtopicId: string) => void;
    onSubtopicDragOver: (e: React.DragEvent, topicId: string, subtopicId: string) => void;
    onSubtopicDragLeave: (e: React.DragEvent) => void;
    onSubtopicDragEnd: (e: React.DragEvent) => void;
    // Drag-and-drop props for the topic itself
    onSelfDragStart: (e: React.DragEvent) => void;
    onSelfDragEnd: (e: React.DragEvent) => void;
}> = ({
    topic, onUpdateTitle, onDelete, onAddSubtopic, onUpdateSubtopic, onDeleteSubtopic,
    draggedSubtopic, dropTargetSubtopic, onSubtopicDragStart, onSubtopicDrop, onSubtopicDragOver, onSubtopicDragLeave, onSubtopicDragEnd,
    onSelfDragStart, onSelfDragEnd
}) => {
        const [isSubtopicsOpen, setSubtopicsOpen] = useState(true);

        return (
            <Card className="p-0 overflow-hidden bg-white dark:bg-gray-800">
                {/* Learning Unit Header */}
                <div className="p-4 flex items-center justify-between gap-2 bg-gray-50 dark:bg-gray-700 border-b dark:border-gray-600">
                    <div
                        draggable
                        onDragStart={onSelfDragStart}
                        onDragEnd={onSelfDragEnd}
                        className="cursor-grab p-1"
                    >
                        <Icon name={IconName.DragHandle} className="w-5 h-5 text-gray-400" />
                    </div>
                    <input
                        type="text"
                        value={topic.title}
                        onChange={e => onUpdateTitle(topic.id, e.target.value)}
                        className={inputGhostClasses(true)}
                        placeholder="Learning Unit Title"
                    />
                    <div className="flex items-center ml-auto flex-shrink-0">
                        <button onClick={() => setSubtopicsOpen(!isSubtopicsOpen)} className="p-1.5 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-full">
                            <Icon name={IconName.ChevronDown} className={`w-5 h-5 transition-transform ${isSubtopicsOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <button onClick={() => onDelete(topic.id)} className="p-1.5 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full">
                            <Icon name={IconName.Delete} className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Subtopics (Topics within Learning Unit) */}
                {isSubtopicsOpen && (
                    <div className="px-4 pb-4">
                        <ul className="pt-2 space-y-2">
                            {topic.subtopics.map(subtopic => (
                                <li
                                    key={subtopic.id}
                                    onDragOver={(e) => onSubtopicDragOver(e, topic.id, subtopic.id)}
                                    onDragLeave={onSubtopicDragLeave}
                                    onDrop={(e) => onSubtopicDrop(e, topic.id, subtopic.id)}
                                    className={`relative flex items-center justify-between p-1 rounded-md group transition-all duration-200 ${draggedSubtopic?.subtopicId === subtopic.id ? 'opacity-30' : 'hover:bg-gray-100/70 dark:hover:bg-gray-700/70'
                                        } ${dropTargetSubtopic?.subtopicId === subtopic.id ? 'pt-2 border-t-2 border-blue-500' : 'border-t-2 border-transparent'
                                        }`}
                                >
                                    <div
                                        draggable
                                        onDragStart={(e) => onSubtopicDragStart(e, topic.id, subtopic.id)}
                                        onDragEnd={onSubtopicDragEnd}
                                        className="cursor-grab p-1"
                                    >
                                        <Icon name={IconName.Menu} className="w-5 h-5 text-gray-400" />
                                    </div>
                                    <Icon name={IconName.FileText} className="w-5 h-5 text-green-500 mr-2 flex-shrink-0" />
                                    <input
                                        type="text"
                                        value={subtopic.title}
                                        onChange={e => onUpdateSubtopic(topic.id, subtopic.id, e.target.value)}
                                        className={inputGhostClasses(false)}
                                        placeholder="Topic title"
                                    />
                                    <button onClick={() => onDeleteSubtopic(topic.id, subtopic.id)} className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Icon name={IconName.Delete} className="w-4 h-4" />
                                    </button>
                                </li>
                            ))}
                            <li className="pt-2">
                                <Button size="sm" variant="ghost" onClick={() => onAddSubtopic(topic.id)} className="text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400">
                                    <Icon name={IconName.Add} className="w-4 h-4 mr-2" />
                                    Add Topic
                                </Button>
                            </li>
                        </ul>
                    </div>
                )}
            </Card>
        );
    };


const CourseEditor: React.FC = () => {
    const { editingCourse, setEditingCourse, role, courseEditMode, setCourseEditMode } = useLms();

    if (!editingCourse) {
        return <div className="flex items-center justify-center h-full"><Spinner text="Loading course editor..." /></div>;
    }

    const [course, setCourse] = useState<Course>({
        ...editingCourse,
        topics: editingCourse.topics || [],
        assessments: editingCourse.assessments || [],
        modeOfLearning: editingCourse.modeOfLearning?.length ? editingCourse.modeOfLearning : [ModeOfLearning.Physical],
        // Ensure imageUrl is set - use existing or generate default
        imageUrl: editingCourse.imageUrl || `https://picsum.photos/seed/${editingCourse.id || 'new'}/400/225`
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);

    // State to track preview URL for cleanup
    const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);


    // State to track deleted assessments for update operations
    const [deletedAssessments, setDeletedAssessments] = useState<string[]>([]);

    // State to track assessment files that need to be deleted
    const [filesToDelete, setFilesToDelete] = useState<string[]>([]);

    // File states for deferred uploads
    const [files, setFiles] = useState<{
        courseImage?: File;
        lessonPlan?: File;
        learnerGuide?: File;
        facilitatorGuide?: File;
        assessmentPlan?: File;
        learnerSlides?: File;
        trainerSlides?: File;
        assessmentFiles: File[];
        // NEW: map uploaded assessment file by assessmentId
        assessmentFilesById?: Record<string, File>;
    }>({
        assessmentFiles: [],
        assessmentFilesById: {}
    });

    // Drag and Drop state for Topics (Learning Units)
    const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
    const [dropTargetTopicId, setDropTargetTopicId] = useState<string | null>(null);

    // Drag and Drop state for Subtopics
    const [draggedSubtopic, setDraggedSubtopic] = useState<{ topicId: string; subtopicId: string } | null>(null);
    const [dropTargetSubtopic, setDropTargetSubtopic] = useState<{ topicId: string; subtopicId: string } | null>(null);

    // Use courseEditMode to determine if this is a new course, with fallback to ID check
    // If course has a real database ID (not starting with 'course_'), it's definitely existing
    const hasRealId = course.id && !course.id.startsWith('course_');
    const isNewCourse = hasRealId ? false : (courseEditMode === 'create' || !course.id || course.id.startsWith('course_'));

    const isTrainerSlidesUrl = course.trainerSlidesUrl && (course.trainerSlidesUrl.startsWith('http://') || course.trainerSlidesUrl.startsWith('https://'));
    const [trainerSlideInputType, setTrainerSlideInputType] = useState<'upload' | 'link'>(isTrainerSlidesUrl ? 'link' : 'upload');

    // Debug logging for mode
    useEffect(() => {
        console.log('📝 CourseEditor: Mode:', courseEditMode, '| isNewCourse:', isNewCourse, '| Course ID:', course.id, '| hasRealId:', hasRealId);
    }, [courseEditMode, isNewCourse, course.id, hasRealId]);

    // Clean up invalid blob URLs from database when editing existing courses
    useEffect(() => {
        if (!isNewCourse && course.imageUrl && course.imageUrl.startsWith('blob:')) {
            console.log('🔧 Detected invalid blob URL in database, falling back to placeholder');
            setCourse(prev => ({
                ...prev,
                imageUrl: `https://picsum.photos/seed/${course.id || 'default'}/400/225`
            }));
        }
    }, [isNewCourse, course.id]); // Don't include course.imageUrl in dependencies to avoid infinite loop

    // Clean up file deletion tracking when editing different courses
    useEffect(() => {
        setFilesToDelete([]);
        setDeletedAssessments([]);
        // Clear file mappings when switching courses
        setFiles(prev => ({
            ...prev,
            assessmentFiles: [],
            assessmentFilesById: {}
        }));
        // Clean up any existing preview URL
        if (previewImageUrl) {
            URL.revokeObjectURL(previewImageUrl);
            setPreviewImageUrl(null);
        }
    }, [editingCourse?.id]);

    // Cleanup preview URL on component unmount
    useEffect(() => {
        return () => {
            if (previewImageUrl) {
                URL.revokeObjectURL(previewImageUrl);
            }
        };
    }, [previewImageUrl]);

    // --- Topic Drag Handlers ---
    const handleTopicDragStart = (e: React.DragEvent, topicId: string) => {
        setDraggedTopicId(topicId);
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleTopicDragOver = (e: React.DragEvent, topicId: string) => {
        e.preventDefault();
        if (topicId !== draggedTopicId) {
            setDropTargetTopicId(topicId);
        }
    };
    const handleTopicDragLeave = () => {
        setDropTargetTopicId(null);
    };
    const handleTopicDrop = (e: React.DragEvent, dropTargetTopicId: string) => {
        e.preventDefault();
        if (!draggedTopicId || draggedTopicId === dropTargetTopicId) return;

        const fromIndex = course.topics.findIndex(t => t.id === draggedTopicId);
        const toIndex = course.topics.findIndex(t => t.id === dropTargetTopicId);

        if (fromIndex !== -1 && toIndex !== -1) {
            const newTopics = [...course.topics];
            const [removed] = newTopics.splice(fromIndex, 1);
            newTopics.splice(toIndex, 0, removed);
            setCourse(prev => ({ ...prev, topics: newTopics }));
        }
    };
    const handleTopicDragEnd = () => {
        setDraggedTopicId(null);
        setDropTargetTopicId(null);
    };

    // --- Subtopic Drag Handlers ---
    const handleSubtopicDragStart = (e: React.DragEvent, topicId: string, subtopicId: string) => {
        e.stopPropagation();
        setDraggedSubtopic({ topicId, subtopicId });
        e.dataTransfer.effectAllowed = 'move';
    };
    const handleSubtopicDragOver = (e: React.DragEvent, topicId: string, subtopicId: string) => {
        e.stopPropagation();
        e.preventDefault();
        if (draggedSubtopic && draggedSubtopic.topicId === topicId && draggedSubtopic.subtopicId !== subtopicId) {
            setDropTargetSubtopic({ topicId, subtopicId });
        }
    };
    const handleSubtopicDragLeave = (e: React.DragEvent) => {
        e.stopPropagation();
        setDropTargetSubtopic(null);
    };
    const handleSubtopicDrop = (e: React.DragEvent, dropTargetTopicId: string, dropTargetSubtopicId: string) => {
        e.stopPropagation();
        e.preventDefault();
        if (!draggedSubtopic || draggedSubtopic.topicId !== dropTargetTopicId || draggedSubtopic.subtopicId === dropTargetSubtopicId) return;

        setCourse(prev => {
            const newTopics = [...prev.topics];
            const topicIndex = newTopics.findIndex(t => t.id === draggedSubtopic.topicId);
            if (topicIndex === -1) return prev;

            const topic = { ...newTopics[topicIndex] };
            const newSubtopics = [...topic.subtopics];

            const fromIndex = newSubtopics.findIndex(st => st.id === draggedSubtopic.subtopicId);
            const toIndex = newSubtopics.findIndex(st => st.id === dropTargetSubtopicId);

            if (fromIndex !== -1 && toIndex !== -1) {
                const [removed] = newSubtopics.splice(fromIndex, 1);
                newSubtopics.splice(toIndex, 0, removed);
                topic.subtopics = newSubtopics;
                newTopics[topicIndex] = topic;
                return { ...prev, topics: newTopics };
            }
            return prev;
        });
    };
    const handleSubtopicDragEnd = (e: React.DragEvent) => {
        e.stopPropagation();
        setDraggedSubtopic(null);
        setDropTargetSubtopic(null);
    };

    const handleCourseChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;

        if (type === 'number') {
            setCourse({ ...course, [name]: parseFloat(value) || 0 });
        } else {
            setCourse({ ...course, [name]: value });
        }
    };

    const handleModeOfLearningChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { value } = e.target;

        setCourse(prev => ({
            ...prev,
            modeOfLearning: [value] // Single selection, stored as array for backward compatibility
        }));
    };

    const handleRegenerateImage = async () => {
        setIsGeneratingImage(true);
        const newImageUrl = await generateCourseImage(course.title, course.learningOutcomes || 'General learning topics');
        if (newImageUrl) {
            setCourse({ ...course, imageUrl: newImageUrl });
        } else {
            alert("Failed to generate a new image. Please try again.");
        }
        setIsGeneratingImage(false);
    };

    // File type validation functions
    const validateFileType = (file: File, allowedTypes: string[], fieldName: string): boolean => {
        const fileExtension = file.name.toLowerCase().split('.').pop();
        const isValidType = allowedTypes.some(type =>
            type.startsWith('.') ? type.slice(1) === fileExtension : fileExtension === type
        );

        if (!isValidType) {
            alert(`Invalid file type for ${fieldName}. Please upload a file with one of these extensions: ${allowedTypes.join(', ')}`);
            return false;
        }
        return true;
    };

    const validateImageFile = (file: File): boolean => {
        return validateFileType(file, ['.jpg', '.jpeg', '.png', '.gif', '.webp'], 'Course Image');
    };

    const validateDocumentFile = (file: File, fieldName: string): boolean => {
        return validateFileType(file, ['.pdf', '.doc', '.docx', '.ppt', '.pptx'], fieldName);
    };

    const validateTrainerSlidesFile = (file: File): boolean => {
        return validateFileType(file, ['.ppt', '.pptx', '.pdf', '.doc', '.docx'], 'Trainer Slides');
    };

    const validateAssessmentFile = (file: File): boolean => {
        return validateFileType(file, ['.pdf', '.doc', '.docx'], 'Assessment File');
    };

    const handleSaveCourse = async () => {
        // Validation for required fields
        const requiredFields = [
            { field: course.title, name: 'Course Title' },
            { field: course.courseCode, name: 'Course Code' },
            { field: course.tscTitle, name: 'TSC Title' },
            { field: course.tscCode, name: 'TSC Code' },
            { field: course.trainingHours, name: 'Training Hours' },
            { field: course.assessmentHours, name: 'Assessment Hours' },
            { field: course.courseType, name: 'Course Type' }
        ];

        const missingFields = requiredFields.filter(({ field }) => !field || field === '').map(({ name }) => name);

        // Mode of Learning — default to Physical if somehow unset
        const selectedMode = course.modeOfLearning?.[0] || ModeOfLearning.Physical;

        // Validate training hours > 0; assessment hours can be 0
        if (course.trainingHours <= 0) {
            alert('Training Hours must be greater than 0');
            return;
        }

        if (course.assessmentHours < 0) {
            alert('Assessment Hours cannot be negative');
            return;
        }

        if (missingFields.length > 0) {
            alert(`Please fill in all required fields:\n${missingFields.join('\n')}`);
            return;
        }

        // Validate that all assessments have files uploaded
        const assessmentsWithoutFiles = (course.assessments || []).filter(assessment => {
            // Check if assessment has a file URL or if there's a file in the upload queue for this assessment
            const hasExistingFile = assessment.fileUrl && assessment.fileUrl !== '';
            const hasUploadedFile = files.assessmentFilesById?.[assessment.id];
            return !hasExistingFile && !hasUploadedFile;
        });

        if (assessmentsWithoutFiles.length > 0) {
            const assessmentTitles = assessmentsWithoutFiles.map(a => a.title || 'Untitled Assessment').join('\n');
            alert(`Please upload files for the following assessments before saving:\n${assessmentTitles}`);
            return;
        }

        // Validate trainer slides URL if link option is selected (optional validation)
        if (trainerSlideInputType === 'link' && course.trainerSlidesUrl && course.trainerSlidesUrl.trim() !== '') {
            // Basic URL validation - only validate if URL is provided
            try {
                new URL(course.trainerSlidesUrl);
            } catch {
                alert('Please provide a valid URL for Trainer Slides (e.g., https://docs.google.com/presentation/...)');
                return;
            }
        }

        setIsSaving(true);
        try {
            // Prepare course data with learning units and assessments
            const courseData = {
                title: course.title,
                // Only include imageUrl if no new image is being uploaded (let backend set the path for new uploads)
                imageUrl: files.courseImage ? undefined : course.imageUrl,
                courseCode: course.courseCode,
                tscTitle: course.tscTitle,
                tscCode: course.tscCode,
                trainingHours: course.trainingHours,
                assessmentHours: course.assessmentHours,
                modeOfLearning: selectedMode, // Use the validated mode
                courseType: course.courseType,
                learningOutcomes: course.learningOutcomes,
                isGamified: course.isLeaderboardEnabled || false, // Use isLeaderboardEnabled as gamification
                courseFee: course.courseFee,
                taxPercent: (course.taxPercent || 0) / 100, // Divide by 100 to convert percentage to decimal
                // Include trainer slides URL if it's a link (not upload)
                trainerSlidesUrl: trainerSlideInputType === 'link' ? course.trainerSlidesUrl : undefined,
                // Convert topics to learning units with position
                learningUnits: course.topics.map((topic, index) => ({
                    id: topic.id,
                    title: topic.title,
                    position: index + 1,
                    subtopics: topic.subtopics.map((subtopic, subIndex) => ({
                        id: subtopic.id,
                        title: subtopic.title,
                        position: subIndex + 1
                    }))
                })),
                // Include assessments data with actions for update mode
                assessments: [
                    // Include existing assessments (create or update)
                    ...(course.assessments || []).map(assessment => ({
                        id: assessment.id,
                        title: assessment.title,
                        category: assessment.category,
                        status: assessment.status || 'Published',
                        fileUrl: assessment.fileUrl,
                        // Determine action based on whether it's new course or existing
                        action: isNewCourse ? 'create' : (assessment.id?.startsWith('asm_') ? 'create' : 'update')
                    })),
                    // Include deleted assessments for update mode
                    ...(!isNewCourse ? deletedAssessments.map(id => ({
                        id,
                        title: '',
                        category: '',
                        status: 'Published',
                        action: 'delete'
                    })) : [])
                ]
            };

            // Create FormData for multipart upload
            const formData = new FormData();
            formData.append('courseData', JSON.stringify(courseData));

            // Collect old file URLs for deletion
            const oldFileUrls: { [key: string]: string } = {};

            // Check if course image changed from uploaded file to AI-generated or new upload
            if (!isNewCourse && editingCourse?.imageUrl && editingCourse.imageUrl.includes('uploads/')) {
                // If user uploaded a new image file, mark old file for deletion
                if (files.courseImage) {
                    oldFileUrls.courseImage = editingCourse.imageUrl;
                    console.log('🗑️ Marking old course image for deletion (new file uploaded):', editingCourse.imageUrl);
                }
                // If user changed to AI-generated image (no new file upload and current imageUrl is different)
                else if (!files.courseImage && course.imageUrl && course.imageUrl !== editingCourse.imageUrl &&
                    (course.imageUrl.includes('picsum.photos') || course.imageUrl.includes('pravatar') || course.imageUrl.startsWith('https://'))) {
                    oldFileUrls.courseImage = editingCourse.imageUrl;
                    console.log('🗑️ Marking old course image for deletion (changed to AI-generated):', editingCourse.imageUrl);
                }
            }

            // Append file uploads and track old files for deletion
            if (files.courseImage) {
                formData.append('courseImage', files.courseImage);
                // Note: Old course image file deletion is already handled above
            }
            if (files.lessonPlan) {
                formData.append('lessonPlan', files.lessonPlan);
                if (editingCourse?.lessonPlanUrl && editingCourse.lessonPlanUrl.includes('uploads/')) {
                    oldFileUrls.lessonPlan = editingCourse.lessonPlanUrl;
                }
            }
            if (files.learnerGuide) {
                formData.append('learnerGuide', files.learnerGuide);
                if (editingCourse?.learnerGuideUrl && editingCourse.learnerGuideUrl.includes('uploads/')) {
                    oldFileUrls.learnerGuide = editingCourse.learnerGuideUrl;
                }
            }
            if (files.facilitatorGuide) {
                formData.append('facilitatorGuide', files.facilitatorGuide);
                if (editingCourse?.facilitatorGuideUrl && editingCourse.facilitatorGuideUrl.includes('uploads/')) {
                    oldFileUrls.facilitatorGuide = editingCourse.facilitatorGuideUrl;
                }
            }
            if (files.assessmentPlan) {
                formData.append('assessmentPlan', files.assessmentPlan);
                if (editingCourse?.assessmentPlanUrl && editingCourse.assessmentPlanUrl.includes('uploads/')) {
                    oldFileUrls.assessmentPlan = editingCourse.assessmentPlanUrl;
                }
            }
            if (files.learnerSlides) {
                formData.append('learnerSlides', files.learnerSlides);
                if (editingCourse?.slidesUrl && editingCourse.slidesUrl.includes('uploads/')) {
                    oldFileUrls.learnerSlides = editingCourse.slidesUrl;
                }
            }
            if (files.trainerSlides && trainerSlideInputType === 'upload') {
                formData.append('trainerSlides', files.trainerSlides);
                if (editingCourse?.trainerSlidesUrl && editingCourse.trainerSlidesUrl.includes('uploads/')) {
                    oldFileUrls.trainerSlides = editingCourse.trainerSlidesUrl;
                }
            } else if (trainerSlideInputType === 'link' && editingCourse?.trainerSlidesUrl && editingCourse.trainerSlidesUrl.includes('uploads/')) {
                // Special case: user changed from file to link, delete the old file
                oldFileUrls.trainerSlides = editingCourse.trainerSlidesUrl;
            }

            // Include old file URLs for deletion
            if (Object.keys(oldFileUrls).length > 0) {
                formData.append('oldFileUrls', JSON.stringify(oldFileUrls));
                console.log('🗑️ Old files marked for deletion:', oldFileUrls);
            }

            // Include assessment files marked for deletion
            if (filesToDelete.length > 0) {
                formData.append('assessmentFilesToDelete', JSON.stringify(filesToDelete));
                console.log('🗑️ Assessment files marked for deletion:', filesToDelete);
            }

            // Append assessment files (keyed by assessmentId so backend can match)
            if (files.assessmentFilesById && Object.keys(files.assessmentFilesById).length > 0) {
                console.log('📁 Uploading assessment files with ID mapping:', Object.keys(files.assessmentFilesById));
                Object.entries(files.assessmentFilesById).forEach(([assessmentId, file]) => {
                    formData.append(`assessmentFile_${assessmentId}`, file);
                    console.log(`  - assessmentFile_${assessmentId}: ${file.name}`);
                });
            } else {
                // Fallback (legacy) – keep for backward compatibility
                console.log('📁 Using legacy assessment file upload (no ID mapping)');
                files.assessmentFiles.forEach(file => {
                    formData.append('assessmentFiles', file);
                });
            }

            console.log('📤 Saving course data:', courseData);
            console.log('🖼️ Image URL being saved:', courseData.imageUrl);
            console.log('🎥 Trainer slides info:', {
                inputType: trainerSlideInputType,
                hasFile: !!files.trainerSlides,
                trainerSlidesUrl: courseData.trainerSlidesUrl,
                courseTrainerSlidesUrl: course.trainerSlidesUrl
            });
            console.log('📁 Uploading files:', {
                courseImage: files.courseImage?.name,
                lessonPlan: files.lessonPlan?.name,
                learnerGuide: files.learnerGuide?.name,
                facilitatorGuide: files.facilitatorGuide?.name,
                assessmentPlan: files.assessmentPlan?.name,
                learnerSlides: files.learnerSlides?.name,
                trainerSlides: files.trainerSlides?.name,
                assessmentFiles: files.assessmentFiles.map(f => f.name),
                assessmentFilesById: files.assessmentFilesById ?
                    Object.entries(files.assessmentFilesById).map(([id, file]) => `${id}: ${file.name}`) : []
            });

            // Determine API endpoint and method based on whether it's a new course
            const apiUrl = isNewCourse
                ? getApiUrl('/api/courses/create-course')
                : getApiUrl(`/api/courses/update-course?courseId=${course.id}`);
            const method = isNewCourse ? 'POST' : 'PUT';

            console.log(`🎯 ${method} request to: ${apiUrl}`);

            // Send to API - call server directly on port 3001
            const response = await fetch(apiUrl, {
                method,
                body: formData
            });

            const result = await response.json();

            if (response.ok && result.success) {
                // Update the editing course context
                setEditingCourse(null);
                setCourseEditMode(null); // Also clear the edit mode

                // Clear the files marked for deletion since they were successfully processed
                setFilesToDelete([]);
                setDeletedAssessments([]);

                // Show success message
                alert(`Course "${courseData.title}" ${isNewCourse ? 'created' : 'updated'} successfully!`);
                console.log('✅ Course saved:', result.data);
            } else {
                throw new Error(result.message || `Failed to ${isNewCourse ? 'create' : 'update'} course`);
            }
        } catch (error) {
            console.error(`❌ Failed to ${isNewCourse ? 'create' : 'update'} course:`, error);
            alert(`Failed to ${isNewCourse ? 'create' : 'update'} course: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsSaving(false);
        }
    };

    const addTopic = () => {
        const newTopic: Topic = { id: `t_${Date.now()}`, title: '', subtopics: [] };
        setCourse({ ...course, topics: [...course.topics, newTopic] });
    };

    const updateTopicTitle = (topicId: string, newTitle: string) => {
        setCourse(prev => ({ ...prev, topics: prev.topics.map(t => t.id === topicId ? { ...t, title: newTitle } : t) }));
    };

    const deleteTopic = (topicId: string) => {
        setCourse(prev => ({ ...prev, topics: prev.topics.filter(t => t.id !== topicId) }));
    };

    const addSubtopic = (topicId: string) => {
        const newSubtopic: Subtopic = { id: `st_${Date.now()}`, title: '', content: '' };
        setCourse(prev => ({
            ...prev,
            topics: prev.topics.map(t => t.id === topicId ? { ...t, subtopics: [...t.subtopics, newSubtopic] } : t)
        }));
    };

    const updateSubtopic = (topicId: string, subtopicId: string, newTitle: string) => {
        setCourse(prev => ({
            ...prev,
            topics: prev.topics.map(t => t.id === topicId ? { ...t, subtopics: t.subtopics.map(st => st.id === subtopicId ? { ...st, title: newTitle } : st) } : t)
        }));
    };

    const deleteSubtopic = (topicId: string, subtopicId: string) => {
        setCourse(prev => ({
            ...prev,
            topics: prev.topics.map(t => t.id === topicId ? { ...t, subtopics: t.subtopics.filter(st => st.id !== subtopicId) } : t)
        }));
    };

    const handleAddAssessment = () => {
        const newAssessment: Assessment = { id: `asm_${Date.now()}`, title: 'New Assessment', category: AssessmentCategory.PracticalExam, status: 'Draft' };
        setCourse(prev => ({ ...prev, assessments: [...(prev.assessments || []), newAssessment] }));
    };

    const handleUpdateAssessment = (id: string, field: 'title' | 'category' | 'fileUrl', value: string) => {
        setCourse(prev => ({ ...prev, assessments: prev.assessments?.map(a => a.id === id ? { ...a, [field]: value } : a) }));
    }

    const handleDeleteAssessment = (assessmentId: string) => {
        // Find the assessment being deleted
        const assessmentToDelete = course.assessments?.find(a => a.id === assessmentId);

        // If the assessment has a file URL that points to an uploaded file, mark it for deletion
        if (assessmentToDelete?.fileUrl &&
            assessmentToDelete.fileUrl.includes('/uploads/') &&
            !assessmentToDelete.fileUrl.startsWith('http')) {
            setFilesToDelete(prev => [...prev, assessmentToDelete.fileUrl!]);
            console.log('📁 Marking assessment file for deletion:', assessmentToDelete.fileUrl);
        }

        // If it's an existing assessment (not a temp ID), track it for deletion
        if (!assessmentId.startsWith('asm_') && !isNewCourse) {
            setDeletedAssessments(prev => [...prev, assessmentId]);
        }
        setCourse(prev => ({ ...prev, assessments: prev.assessments?.filter(a => a.id !== assessmentId) }));
    };

    const handleAssessmentFileChange = (e: React.ChangeEvent<HTMLInputElement>, assessmentId: string) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            // Use the new mapping approach that tracks old files for deletion
            handleAssessmentFileUpload(assessmentId, file);
        }
    };

    // File handling functions for deferred uploads
    const handleFileSelect = (fileType: keyof typeof files, file: File | null) => {
        if (file && fileType !== 'assessmentFiles') {
            // Validate file type based on the field
            let isValid = true;
            switch (fileType) {
                case 'courseImage':
                    isValid = validateImageFile(file);
                    break;
                case 'lessonPlan':
                    isValid = validateDocumentFile(file, 'Lesson Plan');
                    break;
                case 'learnerGuide':
                    isValid = validateDocumentFile(file, 'Learner Guide');
                    break;
                case 'facilitatorGuide':
                    isValid = validateDocumentFile(file, 'Facilitator Guide');
                    break;
                case 'assessmentPlan':
                    isValid = validateDocumentFile(file, 'Assessment Plan');
                    break;
                case 'learnerSlides':
                    isValid = validateDocumentFile(file, 'Learner Slides');
                    break;
                case 'trainerSlides':
                    isValid = validateTrainerSlidesFile(file);
                    break;
                default:
                    break;
            }

            if (isValid) {
                setFiles(prev => ({ ...prev, [fileType]: file }));
                console.log(`📁 ${fileType} file selected:`, file.name);
            } else {
                // Clear the file input if validation fails
                const inputElement = document.getElementById(`${fileType}Upload`) as HTMLInputElement;
                if (inputElement) {
                    inputElement.value = '';
                }
            }
        }
    };

    const handleAssessmentFileAdd = (file: File) => {
        setFiles(prev => ({
            ...prev,
            assessmentFiles: [...prev.assessmentFiles, file]
        }));
        console.log('📁 Assessment file added:', file.name);
    };

    const handleAssessmentFileRemove = (index: number) => {
        setFiles(prev => ({
            ...prev,
            assessmentFiles: prev.assessmentFiles.filter((_, i) => i !== index)
        }));
    };

    // New function to handle assessment file upload with old file cleanup
    const handleAssessmentFileUpload = (assessmentId: string, file: File) => {
        // Validate assessment file type
        if (!validateAssessmentFile(file)) {
            // Clear the file input if validation fails
            const inputElement = document.getElementById(`assessment-upload-${assessmentId}`) as HTMLInputElement;
            if (inputElement) {
                inputElement.value = '';
            }
            return;
        }

        // Find the current assessment
        const currentAssessment = course.assessments?.find(a => a.id === assessmentId);

        // If the assessment already has a file that's uploaded to server, mark it for deletion
        if (currentAssessment?.fileUrl &&
            currentAssessment.fileUrl.includes('/uploads/') &&
            !currentAssessment.fileUrl.startsWith('http')) {
            setFilesToDelete(prev => [...prev, currentAssessment.fileUrl!]);
            console.log('📁 Marking old assessment file for deletion:', currentAssessment.fileUrl);
        }

        // Add the new file to the upload queue and map it by assessmentId
        handleAssessmentFileAdd(file);
        setFiles(prev => ({
            ...prev,
            assessmentFilesById: { ...(prev.assessmentFilesById || {}), [assessmentId]: file }
        }));

        // Update the assessment fileUrl for display (mock)
        const mockUrl = `/assessments/${file.name}`;
        handleUpdateAssessment(assessmentId, 'fileUrl', mockUrl);

        console.log('📁 New assessment file mapped to assessment ID:', assessmentId, 'File:', file.name);
    };


    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, field: 'learnerGuideUrl' | 'slidesUrl' | 'lessonPlanUrl' | 'facilitatorGuideUrl' | 'assessmentPlanUrl' | 'trainerSlidesUrl') => {
        if (e.target.files && e.target.files[0]) {
            // In a real app, you would upload the file and get a URL.
            // For this mock, we'll just store the file name to simulate it.
            const mockUrl = `/mock-data/${e.target.files[0].name}`;
            setCourse(prev => ({ ...prev, [field]: mockUrl }));
        }
    };

    const inputClasses = "block w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:border-gray-600 dark:placeholder-gray-400";

    return (
        <div>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6 pb-4 border-b border-gray-200 dark:border-gray-700">
                <div>
                    <h2 className="text-2xl font-bold dark:text-white">{isNewCourse ? 'Create Course' : 'Edit Course'}</h2>
                    {!isNewCourse && course.courseCode && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{course.courseCode}</p>
                    )}
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                    <Button variant="ghost" onClick={() => {
                        setEditingCourse(null);
                        setCourseEditMode(null);
                    }}>Cancel</Button>
                    <Button variant="primary" onClick={handleSaveCourse} disabled={isSaving}>
                        {isSaving ? <Spinner size="sm" /> : (isNewCourse ? 'Create Course' : 'Save Changes')}
                    </Button>
                </div>
            </div>

            {/* Main two-column layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                {/* Left Column: Course Details */}
                <div className="md:col-span-1 xl:col-span-1 space-y-6 xl:sticky xl:top-6">
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Course Details</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Course Image</label>

                                {/* Image preview */}
                                <div className="relative aspect-video bg-gray-100 dark:bg-gray-700 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 mb-3 shadow-sm">
                                    <img
                                        src={getCourseImageUrl(course.imageUrl, course.id)}
                                        alt={course.title}
                                        className="w-full h-full object-cover"
                                        onError={(e) => {
                                            const target = e.target as HTMLImageElement;
                                            if (target.src !== `https://picsum.photos/seed/${course.id || 'default'}/400/200`) {
                                                target.src = `https://picsum.photos/seed/${course.id || 'default'}/400/200`;
                                            }
                                        }}
                                    />
                                    {isGeneratingImage && (
                                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                                            <Spinner text="Generating image..." />
                                        </div>
                                    )}
                                </div>

                                {/* Image URL input */}
                                <div className="mb-3">
                                    <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                                        Image URL Link
                                    </label>
                                    <div className="relative">
                                        <Icon name={IconName.Link} className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                        <input
                                            type="url"
                                            placeholder="https://example.com/image.jpg"
                                            value={course.imageUrl && !course.imageUrl.startsWith('blob:') ? course.imageUrl : ''}
                                            onChange={(e) => {
                                                const url = e.target.value.trim();
                                                setCourse(prev => ({ ...prev, imageUrl: url || undefined }));
                                            }}
                                            className={`${inputClasses} pl-9 text-sm`}
                                        />
                                    </div>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Paste a direct image URL, or use the options below.</p>
                                </div>

                                {/* Divider */}
                                <div className="flex items-center gap-2 mb-3">
                                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
                                    <span className="text-xs text-gray-400 dark:text-gray-500 font-medium">or</span>
                                    <div className="flex-1 h-px bg-gray-200 dark:bg-gray-600" />
                                </div>

                                {/* Upload & AI buttons */}
                                <div className="flex flex-col gap-2">
                                    <input
                                        type="file"
                                        id="courseImageUpload"
                                        accept="image/*"
                                        onChange={(e) => {
                                            if (e.target.files && e.target.files[0]) {
                                                const file = e.target.files[0];
                                                if (!validateImageFile(file)) {
                                                    e.target.value = '';
                                                    return;
                                                }
                                                if (previewImageUrl) {
                                                    URL.revokeObjectURL(previewImageUrl);
                                                }
                                                handleFileSelect('courseImage', file);
                                                const newPreviewUrl = URL.createObjectURL(file);
                                                setPreviewImageUrl(newPreviewUrl);
                                                setCourse(prev => ({ ...prev, imageUrl: newPreviewUrl }));
                                            }
                                        }}
                                        className="hidden"
                                    />
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex items-center gap-2 justify-center w-full"
                                        onClick={() => document.getElementById('courseImageUpload')?.click()}
                                    >
                                        <Icon name={IconName.Upload} className="w-4 h-4 flex-shrink-0" />
                                        <span>Upload Custom Image</span>
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex items-center gap-2 justify-center w-full"
                                        onClick={handleRegenerateImage}
                                        disabled={isGeneratingImage}
                                    >
                                        <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                        </svg>
                                        <span>{isGeneratingImage ? 'Generating...' : 'Generate with AI'}</span>
                                    </Button>
                                </div>
                            </div>

                            <div>
                                <label htmlFor="title" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Course Title <span className="text-red-500">*</span>
                                </label>
                                <input type="text" id="title" name="title" value={course.title} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. React for Beginners" />
                            </div>
                            <div>
                                <label htmlFor="courseCode" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Course Code <span className="text-red-500">*</span>
                                </label>
                                <input type="text" id="courseCode" name="courseCode" value={course.courseCode} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. CRS-Q-0041188-1" />
                            </div>
                            <div>
                                <label htmlFor="tscTitle" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    TSC Title <span className="text-red-500">*</span>
                                </label>
                                <input type="text" id="tscTitle" name="tscTitle" value={course.tscTitle} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. Web Development" />
                            </div>
                            <div>
                                <label htmlFor="tscCode" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    TSC Code <span className="text-red-500">*</span>
                                </label>
                                <input type="text" id="tscCode" name="tscCode" value={course.tscCode} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. ICT-DIT-3011-1.1" />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Duration <span className="text-red-500">*</span>
                                </label>
                                <div className="space-y-2 border border-gray-200 dark:border-gray-700 p-3 rounded-md bg-gray-50/50 dark:bg-gray-800/50">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="trainingHours" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                Training Hours <span className="text-red-500">*</span>
                                            </label>
                                            <input type="number" id="trainingHours" name="trainingHours" value={course.trainingHours} onChange={handleCourseChange} className={inputClasses} />
                                        </div>
                                        <div>
                                            <label htmlFor="assessmentHours" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                Assessment Hours <span className="text-red-500">*</span>
                                            </label>
                                            <input type="number" id="assessmentHours" name="assessmentHours" value={course.assessmentHours} onChange={handleCourseChange} className={inputClasses} />
                                        </div>
                                    </div>
                                    <div className="pt-2 text-right">
                                        <p className="text-sm font-bold text-gray-800 dark:text-gray-200">
                                            Total Duration: <span className="text-primary font-bold">{Number(course.trainingHours) + Number(course.assessmentHours)} hours</span>
                                        </p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                                    Mode of Learning
                                </label>
                                <div className="flex flex-col space-y-2">
                                    {(Object.values(ModeOfLearning)).map((mode) => (
                                        <div key={mode} className="flex items-center">
                                            <input
                                                type="radio"
                                                id={`mode-${mode}`}
                                                name="modeOfLearning"
                                                value={mode}
                                                checked={course.modeOfLearning.includes(mode)}
                                                onChange={handleModeOfLearningChange}
                                                className="h-4 w-4 text-primary focus:ring-primary border-gray-300 dark:border-gray-600"
                                            />
                                            <label htmlFor={`mode-${mode}`} className="ml-3 block text-sm text-gray-900 dark:text-gray-200">
                                                {mode}
                                            </label>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <label htmlFor="courseType" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">
                                    Course Type <span className="text-red-500">*</span>
                                </label>
                                <select
                                    id="courseType"
                                    name="courseType"
                                    value={course.courseType}
                                    onChange={handleCourseChange}
                                    className={inputClasses}
                                >
                                    <option value="Non-WSQ">Non-WSQ</option>
                                    <option value="WSQ">WSQ</option>
                                    <option value="IBF">IBF</option>
                                </select>
                            </div>
                        </div>
                    </Card>
                </div>

                {/* Right Column: Content Sections */}
                <div className="md:col-span-1 xl:col-span-2 space-y-6">
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Learning Outcomes</h3>
                        <textarea id="learningOutcomes" name="learningOutcomes" value={course.learningOutcomes} onChange={handleCourseChange} className={`${inputClasses} h-32`} placeholder="Describe the key learning outcomes..." />
                    </Card>

                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Lesson Plan</h3>
                        <div>
                            <label htmlFor="lessonPlanUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Lesson Plan (PDF, DOC, DOCX, PPT, PPTX)</label>
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-subtle flex-grow truncate">
                                    {getDisplayFilename(course.lessonPlanUrl, files.lessonPlan?.name) || 'No lesson plan uploaded.'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => document.getElementById('lessonPlanUpload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                </Button>
                                <input
                                    type="file"
                                    id="lessonPlanUpload"
                                    className="hidden"
                                    accept=".pdf .doc .docx .ppt .pptx"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            handleFileSelect('lessonPlan', e.target.files[0]);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Learner Guide</h3>
                        <div>
                            <label htmlFor="learnerGuideUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Learner Guide (PDF, DOC, DOCX, PPT, PPTX)</label>
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-subtle flex-grow truncate">
                                    {getDisplayFilename(course.learnerGuideUrl, files.learnerGuide?.name) || 'No learner guide uploaded.'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => document.getElementById('learnerGuideUpload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                </Button>
                                <input
                                    type="file"
                                    id="learnerGuideUpload"
                                    className="hidden"
                                    accept=".pdf .doc .docx .ppt .pptx"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            handleFileSelect('learnerGuide', e.target.files[0]);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Facilitator Guide</h3>
                        <div>
                            <label htmlFor="facilitatorGuideUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Facilitator Guide (PDF, DOC, DOCX, PPT, PPTX)</label>
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-subtle flex-grow truncate">
                                    {getDisplayFilename(course.facilitatorGuideUrl, files.facilitatorGuide?.name) || 'No facilitator guide uploaded.'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => document.getElementById('facilitatorGuideUpload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                </Button>
                                <input
                                    type="file"
                                    id="facilitatorGuideUpload"
                                    className="hidden"
                                    accept=".pdf .doc .docx .ppt .pptx"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            handleFileSelect('facilitatorGuide', e.target.files[0]);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Assessment Plan</h3>
                        <div>
                            <label htmlFor="assessmentPlanUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Assessment Plan (PDF, DOC, DOCX, PPT, PPTX)</label>
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-subtle flex-grow truncate">
                                    {getDisplayFilename(course.assessmentPlanUrl, files.assessmentPlan?.name) || 'No assessment plan uploaded.'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => document.getElementById('assessmentPlanUpload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                </Button>
                                <input
                                    type="file"
                                    id="assessmentPlanUpload"
                                    className="hidden"
                                    accept=".pdf .doc .docx .ppt .pptx"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            handleFileSelect('assessmentPlan', e.target.files[0]);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Learner Slides</h3>
                        <div>
                            <label htmlFor="slidesUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Learner Slides (PDF, DOC, DOCX, PPT, PPTX)</label>
                            <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                <span className="text-sm text-subtle flex-grow truncate">
                                    {getDisplayFilename(course.slidesUrl, files.learnerSlides?.name) || 'No slides uploaded.'}
                                </span>
                                <Button variant="ghost" size="sm" onClick={() => document.getElementById('slidesUpload')?.click()}>
                                    <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                </Button>
                                <input
                                    type="file"
                                    id="slidesUpload"
                                    className="hidden"
                                    accept=".pdf .doc .docx .ppt .pptx"
                                    onChange={(e) => {
                                        if (e.target.files?.[0]) {
                                            handleFileSelect('learnerSlides', e.target.files[0]);
                                        }
                                    }}
                                />
                            </div>
                        </div>
                    </Card>
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Trainer Slides</h3>
                        <div className="flex gap-6 mb-4">
                            <div className="flex items-center">
                                <input type="radio" id="trainer-slide-upload" name="trainerSlideType" value="upload" checked={trainerSlideInputType === 'upload'} onChange={() => setTrainerSlideInputType('upload')} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 dark:border-gray-600" />
                                <label htmlFor="trainer-slide-upload" className="ml-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Upload File</label>
                            </div>
                            <div className="flex items-center">
                                <input type="radio" id="trainer-slide-link" name="trainerSlideType" value="link" checked={trainerSlideInputType === 'link'} onChange={() => setTrainerSlideInputType('link')} className="h-4 w-4 text-primary focus:ring-primary border-gray-300 dark:border-gray-600" />
                                <label htmlFor="trainer-slide-link" className="ml-2 block text-sm font-medium text-gray-700 dark:text-gray-300">Link to Google Slides</label>
                            </div>
                        </div>

                        {trainerSlideInputType === 'upload' ? (
                            <div>
                                <label htmlFor="trainerSlidesUpload" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Upload Trainer Slides - PPT/PPTX/PDF/DOC/DOCX</label>
                                <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                    <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                    <span className="text-sm text-subtle flex-grow truncate">
                                        {files.trainerSlides ? files.trainerSlides.name : (course.trainerSlidesUrl && !isTrainerSlidesUrl ? extractFilenameFromPath(course.trainerSlidesUrl) : 'No file uploaded.')}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('trainerSlidesUpload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                    </Button>
                                    <input
                                        type="file"
                                        id="trainerSlidesUpload"
                                        className="hidden"
                                        accept=".ppt,.pptx,.pdf,.doc,.docx"
                                        onChange={(e) => {
                                            if (e.target.files?.[0]) {
                                                handleFileSelect('trainerSlides', e.target.files[0]);
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div>
                                <label htmlFor="trainerSlidesUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Trainer Slides URL (Optional)</label>
                                <input
                                    type="url"
                                    id="trainerSlidesUrl"
                                    name="trainerSlidesUrl"
                                    value={course.trainerSlidesUrl || ''}
                                    onChange={(e) => {
                                        setCourse(prev => ({ ...prev, trainerSlidesUrl: e.target.value }));
                                    }}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/presentation/..."
                                />
                            </div>
                        )}
                    </Card>

                    <div className="space-y-4">
                        <h3 className="text-xl font-bold px-1">Lesson</h3>
                        {course.topics.map(topic => (
                            <div
                                key={topic.id}
                                onDragOver={(e) => handleTopicDragOver(e, topic.id)}
                                onDragLeave={handleTopicDragLeave}
                                onDrop={(e) => handleTopicDrop(e, topic.id)}
                                className={`transition-opacity ${draggedTopicId === topic.id ? 'opacity-30' : ''}`}
                            >
                                <div className={`h-2 transition-all duration-200 ${dropTargetTopicId === topic.id ? 'border-t-4 border-primary' : 'border-t-0'}`}></div>
                                <EditableTopicAccordion
                                    topic={topic}
                                    onUpdateTitle={updateTopicTitle}
                                    onDelete={deleteTopic}
                                    onAddSubtopic={addSubtopic}
                                    onUpdateSubtopic={updateSubtopic}
                                    onDeleteSubtopic={deleteSubtopic}
                                    onSelfDragStart={(e) => handleTopicDragStart(e, topic.id)}
                                    onSelfDragEnd={handleTopicDragEnd}
                                    draggedSubtopic={draggedSubtopic}
                                    dropTargetSubtopic={dropTargetSubtopic}
                                    onSubtopicDragStart={handleSubtopicDragStart}
                                    onSubtopicDrop={handleSubtopicDrop}
                                    onSubtopicDragOver={handleSubtopicDragOver}
                                    onSubtopicDragLeave={handleSubtopicDragLeave}
                                    onSubtopicDragEnd={handleSubtopicDragEnd}
                                />
                            </div>
                        ))}
                        <Button variant="ghost" onClick={addTopic} className="w-full !py-3 !text-lg !font-semibold border-2 border-dashed !border-gray-300 dark:!border-gray-600 hover:!border-primary !text-subtle hover:!text-primary">
                            + Add Learning Unit
                        </Button>
                    </div>

                    <div className="space-y-4">
                        <h3 className="text-xl font-bold px-1">Assessment</h3>
                        <div className="space-y-4">
                            {(course.assessments || []).map(assessment => (
                                <Card key={assessment.id} className="p-4 relative group">
                                    <button onClick={() => handleDeleteAssessment(assessment.id)} className="absolute top-2 right-2 p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                        <Icon name={IconName.Delete} className="w-4 h-4" />
                                    </button>
                                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                                        <Icon name={IconName.ClipboardCheck} className="w-5 h-5 text-primary flex-shrink-0 hidden sm:block" />
                                        <input
                                            type="text"
                                            value={assessment.title}
                                            onChange={(e) => handleUpdateAssessment(assessment.id, 'title', e.target.value)}
                                            className={`${inputGhostClasses(false)} !font-semibold flex-grow`}
                                            placeholder="Assessment Title"
                                        />
                                        <select
                                            value={assessment.category}
                                            onChange={(e) => handleUpdateAssessment(assessment.id, 'category', e.target.value)}
                                            className="text-sm font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-800 dark:text-indigo-300 px-3 py-1 rounded-full border-transparent focus:border-indigo-300 focus:ring-indigo-300 w-full sm:w-auto"
                                        >
                                            {Object.values(AssessmentCategory).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                        </select>
                                    </div>
                                    <div className="mt-4 pt-4 border-t dark:border-gray-700">
                                        <label htmlFor={`assessment-upload-${assessment.id}`} className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Assessment File (PDF/DOC/DOCX)</label>
                                        <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                            <Icon name={IconName.FilePdf} className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                                            <span className="text-sm text-subtle flex-grow truncate">{assessment.fileUrl ? getDisplayFilename(assessment.fileUrl) : 'No file uploaded.'}</span>
                                            <Button variant="ghost" size="sm" onClick={() => document.getElementById(`assessment-upload-${assessment.id}`)?.click()}>
                                                <Icon name={IconName.Upload} className="w-4 h-4 mr-1" /> Upload
                                            </Button>
                                            <input
                                                type="file"
                                                id={`assessment-upload-${assessment.id}`}
                                                className="hidden"
                                                accept=".doc,.docx,.pdf"
                                                onChange={(e) => {
                                                    if (e.target.files?.[0]) {
                                                        handleAssessmentFileUpload(assessment.id, e.target.files[0]);
                                                    }
                                                }}
                                            />
                                        </div>
                                    </div>
                                </Card>
                            ))}
                            {course.assessments?.length === 0 && <p className="text-subtle text-center py-4">No assessments added yet.</p>}
                            <Button variant="ghost" onClick={handleAddAssessment} className="w-full !py-3 !text-lg !font-semibold border-2 border-dashed !border-gray-300 dark:!border-gray-600 hover:!border-primary !text-subtle hover:!text-primary">
                                + Add Assessment
                            </Button>
                        </div>
                    </div>

                    {(role === UserRole.Admin) && (
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4 dark:text-white">Pricing & Funding</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label htmlFor="courseFee" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Fee ($)</label>
                                    <input type="number" id="courseFee" name="courseFee" value={course.courseFee} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. 500" />
                                </div>
                                <div>
                                    <label htmlFor="taxPercent" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Tax / GST (%)</label>
                                    <input
                                        type="number"
                                        id="taxPercent"
                                        name="taxPercent"
                                        value={course.taxPercent}
                                        onChange={handleCourseChange}
                                        className={inputClasses}
                                        placeholder="e.g. 9"
                                        min="0"
                                        step="1"
                                        onKeyPress={(e) => {
                                            // Only allow digits
                                            if (!/[0-9]/.test(e.key) && e.key !== 'Backspace' && e.key !== 'Delete' && e.key !== 'Tab' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') {
                                                e.preventDefault();
                                            }
                                        }}
                                    />
                                </div>
                            </div>
                        </Card>
                    )}

                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Course Settings</h3>
                        <div className="flex justify-between items-center p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                            <div>
                                <p className="font-semibold text-sm">Enable Gaming Leaderboard</p>
                                <p className="text-xs text-subtle">Allow learners to see a competitive leaderboard for this course.</p>
                            </div>
                            <button
                                onClick={() => setCourse(prev => ({ ...prev, isLeaderboardEnabled: !(prev.isLeaderboardEnabled ?? false) }))}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${(course.isLeaderboardEnabled ?? false) ? 'bg-primary' : 'bg-gray-200 dark:bg-gray-600'}`}
                                aria-pressed={course.isLeaderboardEnabled ?? false}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(course.isLeaderboardEnabled ?? false) ? 'translate-x-6' : 'translate-x-1'}`}
                                />
                            </button>
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    );
};

export default CourseEditor;