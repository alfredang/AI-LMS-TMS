import React, { useState, useEffect } from 'react';
import { useLms } from '@contexts/LmsContext';
import { Course, Topic, Subtopic, ModeOfLearning, UserRole, AssessmentMethodKey, ASSESSMENT_METHOD_LABELS, DEFAULT_ASSESSMENT_METHODS } from '@app-types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Icon, IconName } from './ui/Icon';
import Spinner from './ui/Spinner';
import { generateCourseImage } from '@lib/services/geminiService';
import { getCourseImageUrl } from '@utils/imageUtils';
import { getApiUrl } from '@/lib/urlHelpers';

const inputGhostClasses = (isTitle: boolean) =>
    `flex-grow border border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-gray-300 dark:focus:border-gray-600 rounded-md px-2 py-1 bg-transparent hover:bg-gray-50 dark:hover:bg-gray-800 focus:bg-gray-50 dark:focus:bg-gray-800 focus:outline-none w-full transition-colors dark:text-white ${isTitle ? 'font-bold text-xl' : 'text-base'}`;

const parseNumericInput = (value: unknown) => {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
};

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

const formatCurrencyInput = (value: number) => roundCurrency(value).toFixed(2);
const formatCurrencyDisplay = (value: unknown) => {
    const numeric = parseNumericInput(value);
    return new Intl.NumberFormat('en-SG', {
        style: 'currency',
        currency: 'SGD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(numeric);
};

interface TrainerOption {
    user_id: string;
    trainer_name: string;
    email: string;
    status: string | null;
    account_status: string | null;
}

const formatDisplayValue = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
};

const LinkField: React.FC<{ label: string; value?: string | null }> = ({ label, value }) => (
    <div>
        <div className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{label}</div>
        {value ? (
            <a
                href={value}
                target="_blank"
                rel="noreferrer"
                className="block w-full px-3 py-2 text-blue-600 bg-white border border-gray-300 rounded-md shadow-sm hover:underline dark:bg-gray-700 dark:text-blue-300 dark:border-gray-600 break-all"
            >
                {value}
            </a>
        ) : (
            <div className="block w-full px-3 py-2 text-gray-500 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600">
                —
            </div>
        )}
    </div>
);

const ReadonlyValueField: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
    <div>
        <div className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">{label}</div>
        <div className="block w-full px-3 py-2 text-gray-900 bg-white border border-gray-300 rounded-md shadow-sm dark:bg-gray-700 dark:text-white dark:border-gray-600 break-words">
            {value || '—'}
        </div>
    </div>
);


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
    // Resource links props. `instructions` is an optional free-text field
    // used by Activity-type resources as an alternative to a URL — the
    // developer chooses between a clickable link and an in-app instruction
    // block. Stored in the `resource_links` JSONB column on the course row,
    // so older rows without the field simply render as URL activities.
    resourceLinks: { id: string; topicId: string; type: 'file' | 'document' | 'youtube' | 'activity' | 'quiz'; title: string; url: string; instructions?: string }[];
    onAddResourceLink: (topicId: string, type: 'file' | 'document' | 'youtube' | 'activity' | 'quiz') => void;
    onUpdateResourceLink: (id: string, field: 'title' | 'url' | 'instructions', value: string) => void;
    onDeleteResourceLink: (id: string) => void;
    onReorderResourceLink: (draggedId: string, targetId: string, parentId: string) => void;
    onMoveResourceLink: (draggedId: string, targetParentId: string) => void;
    draggedResourceLinkId: string | null;
    onResourceLinkDragStart: (id: string) => void;
    onResourceLinkDragEnd: () => void;
}> = ({
    topic, onUpdateTitle, onDelete, onAddSubtopic, onUpdateSubtopic, onDeleteSubtopic,
    draggedSubtopic, dropTargetSubtopic, onSubtopicDragStart, onSubtopicDrop, onSubtopicDragOver, onSubtopicDragLeave, onSubtopicDragEnd,
    onSelfDragStart, onSelfDragEnd,
    resourceLinks, onAddResourceLink, onUpdateResourceLink, onDeleteResourceLink, onReorderResourceLink, onMoveResourceLink,
    draggedResourceLinkId, onResourceLinkDragStart, onResourceLinkDragEnd
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
                            {topic.subtopics.map(subtopic => {
                                const subtopicLinks = resourceLinks.filter(rl => rl.topicId === subtopic.id);
                                return (
                                <li key={subtopic.id}>
                                    <div
                                        onDragOver={(e) => {
                                            if (draggedResourceLinkId) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                e.currentTarget.classList.add('ring-1', 'ring-blue-400');
                                                return;
                                            }
                                            onSubtopicDragOver(e, topic.id, subtopic.id);
                                        }}
                                        onDragLeave={onSubtopicDragLeave}
                                        onDrop={(e) => {
                                            if (draggedResourceLinkId) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                e.currentTarget.classList.remove('ring-1', 'ring-blue-400');
                                                onMoveResourceLink(draggedResourceLinkId, subtopic.id);
                                                return;
                                            }
                                            onSubtopicDrop(e, topic.id, subtopic.id);
                                        }}
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
                                    </div>
                                    {/* Resource links + buttons for this topic */}
                                    <div
                                        className="ml-10 mt-1 space-y-1 rounded-md transition-colors"
                                        onDragOver={(e) => {
                                            if (!draggedResourceLinkId) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.currentTarget.classList.add('ring-1', 'ring-blue-400', 'bg-blue-50/40', 'dark:bg-blue-900/10');
                                        }}
                                        onDragLeave={(e) => {
                                            e.stopPropagation();
                                            e.currentTarget.classList.remove('ring-1', 'ring-blue-400', 'bg-blue-50/40', 'dark:bg-blue-900/10');
                                        }}
                                        onDrop={(e) => {
                                            if (!draggedResourceLinkId) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            e.currentTarget.classList.remove('ring-1', 'ring-blue-400', 'bg-blue-50/40', 'dark:bg-blue-900/10');
                                            onMoveResourceLink(draggedResourceLinkId, subtopic.id);
                                        }}
                                    >
                                        {subtopicLinks.map((rl, rlIndex) => (
                                            <div
                                                key={rl.id}
                                                draggable
                                                onDragStart={(e) => { e.dataTransfer.setData('resourceLinkId', rl.id); e.dataTransfer.setData('parentId', subtopic.id); e.dataTransfer.effectAllowed = 'move'; onResourceLinkDragStart(rl.id); }}
                                                onDragEnd={() => onResourceLinkDragEnd()}
                                                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-t-2', 'border-blue-400'); }}
                                                onDragLeave={(e) => { e.currentTarget.classList.remove('border-t-2', 'border-blue-400'); }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    e.currentTarget.classList.remove('border-t-2', 'border-blue-400');
                                                    if (draggedResourceLinkId && draggedResourceLinkId !== rl.id) {
                                                        onReorderResourceLink(draggedResourceLinkId, rl.id, subtopic.id);
                                                    }
                                                }}
                                                className={`flex items-center gap-1.5 p-1.5 rounded cursor-grab group/rl ${
                                                    rl.type === 'file' ? 'bg-blue-50/50 dark:bg-blue-900/10' :
                                                    rl.type === 'document' ? 'bg-amber-50/50 dark:bg-amber-900/10' :
                                                    rl.type === 'youtube' ? 'bg-red-50/50 dark:bg-red-900/10' :
                                                    rl.type === 'activity' ? 'bg-purple-50/50 dark:bg-purple-900/10' :
                                                    'bg-green-50/50 dark:bg-green-900/10'
                                                }`}
                                            >
                                                <Icon name={IconName.Menu} className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 flex-shrink-0" />
                                                <span className={`text-[9px] font-bold uppercase px-1 py-0.5 rounded flex-shrink-0 ${
                                                    rl.type === 'file' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                    rl.type === 'document' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
                                                    rl.type === 'youtube' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
                                                    rl.type === 'activity' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                                                    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                                }`}>
                                                    {rl.type === 'file' ? 'Web' : rl.type === 'document' ? 'Doc' : rl.type === 'youtube' ? 'YT' : rl.type === 'activity' ? 'Act' : 'Quiz'}
                                                </span>
                                                <input
                                                    type="text"
                                                    placeholder="Title"
                                                    value={rl.title}
                                                    draggable={false}
                                                    onClick={(e) => e.stopPropagation()}
                                                    onMouseDown={(e) => e.stopPropagation()}
                                                    onChange={e => onUpdateResourceLink(rl.id, 'title', e.target.value)}
                                                    className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-transparent dark:text-white focus:outline-none focus:border-blue-500"
                                                />
                                                {rl.type === 'activity' ? (
                                                    // Activity rows let the developer choose between a URL (external
                                                    // link) and an inline instructions block (free text). Mode is
                                                    // implicit from the data: non-empty instructions = instructions
                                                    // mode, otherwise url mode. The pill button toggles which field
                                                    // is shown; switching modes clears the *other* field so the row
                                                    // has exactly one payload.
                                                    (() => {
                                                        const isInstructionsMode = !!(rl.instructions && rl.instructions.length > 0);
                                                        return (
                                                            <>
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        if (isInstructionsMode) {
                                                                            // Switch to URL mode — clear instructions
                                                                            onUpdateResourceLink(rl.id, 'instructions', '');
                                                                        } else {
                                                                            // Switch to instructions mode — seed with
                                                                            // a single space so the predicate flips
                                                                            // (the textarea will be focusable and the
                                                                            // developer can type their real content).
                                                                            onUpdateResourceLink(rl.id, 'url', '');
                                                                            onUpdateResourceLink(rl.id, 'instructions', ' ');
                                                                        }
                                                                    }}
                                                                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 bg-purple-200/60 hover:bg-purple-300/80 dark:bg-purple-900/40 dark:hover:bg-purple-900/60 text-purple-800 dark:text-purple-300 transition-colors"
                                                                    title={isInstructionsMode ? 'Switch to URL link' : 'Switch to instructions text'}
                                                                >
                                                                    {isInstructionsMode ? '📝 Text' : '🔗 URL'}
                                                                </button>
                                                                {isInstructionsMode ? (
                                                                    <textarea
                                                                        placeholder="Instructions (e.g. steps the learner should follow)"
                                                                        value={rl.instructions || ''}
                                                                        draggable={false}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onMouseDown={(e) => e.stopPropagation()}
                                                                        onChange={e => onUpdateResourceLink(rl.id, 'instructions', e.target.value)}
                                                                        rows={2}
                                                                        className="flex-[2] min-w-0 px-1.5 py-0.5 text-xs border border-purple-200 dark:border-purple-900/50 hover:border-purple-400 dark:hover:border-purple-700 rounded bg-purple-50/30 dark:bg-purple-900/10 dark:text-white focus:outline-none focus:border-purple-500 resize-y leading-snug"
                                                                    />
                                                                ) : (
                                                                    <input
                                                                        type="url"
                                                                        placeholder="URL"
                                                                        value={rl.url}
                                                                        draggable={false}
                                                                        onClick={(e) => e.stopPropagation()}
                                                                        onMouseDown={(e) => e.stopPropagation()}
                                                                        onChange={e => onUpdateResourceLink(rl.id, 'url', e.target.value)}
                                                                        className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-transparent dark:text-white focus:outline-none focus:border-blue-500"
                                                                    />
                                                                )}
                                                            </>
                                                        );
                                                    })()
                                                ) : (
                                                    <input
                                                        type="url"
                                                        placeholder="URL"
                                                        value={rl.url}
                                                        draggable={false}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseDown={(e) => e.stopPropagation()}
                                                        onChange={e => onUpdateResourceLink(rl.id, 'url', e.target.value)}
                                                        className="flex-1 min-w-0 px-1.5 py-0.5 text-xs border-0 border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 bg-transparent dark:text-white focus:outline-none focus:border-blue-500"
                                                    />
                                                )}
                                                <button onClick={() => onDeleteResourceLink(rl.id)} className="p-0.5 text-gray-400 hover:text-red-500 rounded opacity-0 group-hover/rl:opacity-100 transition-opacity flex-shrink-0">
                                                    <Icon name={IconName.Delete} className="w-3 h-3" />
                                                </button>
                                            </div>
                                        ))}
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 hover:!opacity-100 transition-opacity">
                                            <button onClick={() => onAddResourceLink(subtopic.id, 'file')} className="text-[10px] text-gray-400 hover:text-blue-500 px-1 py-0.5 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors">+ Web</button>
                                            <button onClick={() => onAddResourceLink(subtopic.id, 'document')} className="text-[10px] text-gray-400 hover:text-amber-500 px-1 py-0.5 rounded hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors">+ Document</button>
                                            <button onClick={() => onAddResourceLink(subtopic.id, 'youtube')} className="text-[10px] text-gray-400 hover:text-red-500 px-1 py-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">+ YouTube</button>
                                            <button onClick={() => onAddResourceLink(subtopic.id, 'activity')} className="text-[10px] text-gray-400 hover:text-purple-500 px-1 py-0.5 rounded hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors">+ Activity</button>
                                            <button onClick={() => onAddResourceLink(subtopic.id, 'quiz')} className="text-[10px] text-gray-400 hover:text-green-500 px-1 py-0.5 rounded hover:bg-green-50 dark:hover:bg-green-900/20 transition-colors">+ Quiz</button>
                                        </div>
                                    </div>
                                </li>
                                );
                            })}
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
    const { editingCourse, setEditingCourse, role, courseEditMode, setCourseEditMode, trainingProviderProfile } = useLms();

    if (!editingCourse) {
        return <div className="flex items-center justify-center h-full"><Spinner text="Loading course editor..." /></div>;
    }

    // Auto-migrate legacy written/practical links into assessmentMethods if not yet set
    // Treat "No file" as empty (legacy placeholder value)
    const cleanLink = (link?: string) => (link && link !== 'No file' && link.startsWith('http')) ? link : '';
    const initialAssessmentMethods = editingCourse.assessmentMethods || {
        ...DEFAULT_ASSESSMENT_METHODS,
        writtenAssessment: { enabled: !!cleanLink(editingCourse.writtenAssessmentLink), link: cleanLink(editingCourse.writtenAssessmentLink) },
        practicalExam: { enabled: !!cleanLink(editingCourse.practicalPerformanceAssessmentLink), link: cleanLink(editingCourse.practicalPerformanceAssessmentLink) },
    };

    const [course, setCourse] = useState<Course>({
        ...editingCourse,
        topics: editingCourse.topics || [],
        assessments: editingCourse.assessments || [],
        assessmentMethods: initialAssessmentMethods,
        modeOfLearning: editingCourse.modeOfLearning?.length ? editingCourse.modeOfLearning : [ModeOfLearning.Physical],
        // Ensure imageUrl is set - use existing or generate default
        imageUrl: editingCourse.imageUrl || `https://picsum.photos/seed/${editingCourse.id || 'new'}/400/225`
    });
    const [isSaving, setIsSaving] = useState(false);
    const [isGeneratingImage, setIsGeneratingImage] = useState(false);
    const [availableTrainers, setAvailableTrainers] = useState<TrainerOption[]>([]);
    const [trainerSearch, setTrainerSearch] = useState('');
    const [draggedApprovedTrainer, setDraggedApprovedTrainer] = useState<string | null>(null);
    const [approvedTrainerDropTarget, setApprovedTrainerDropTarget] = useState<string | null>(null);

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
        writtenAssessment?: File;
        practicalPerformanceAssessment?: File;
        assessmentFiles: File[];
        // NEW: map uploaded assessment file by assessmentId
        assessmentFilesById?: Record<string, File>;
    }>({
        assessmentFiles: [],
        assessmentFilesById: {}
    });

    // Resource links state (file links, YouTube links, quiz links) — each link belongs to a topic
    const [resourceLinks, setResourceLinks] = useState<{ id: string; topicId: string; type: 'file' | 'document' | 'youtube' | 'activity' | 'quiz'; title: string; url: string; instructions?: string }[]>(
        (course as any).resourceLinks || []
    );

    // Drag and Drop state for Topics (Learning Units)
    const [draggedTopicId, setDraggedTopicId] = useState<string | null>(null);
    const [dropTargetTopicId, setDropTargetTopicId] = useState<string | null>(null);

    // Drag and Drop state for Subtopics
    const [draggedSubtopic, setDraggedSubtopic] = useState<{ topicId: string; subtopicId: string } | null>(null);
    const [dropTargetSubtopic, setDropTargetSubtopic] = useState<{ topicId: string; subtopicId: string } | null>(null);

    // Drag and Drop state for Resource Links (needed because dataTransfer.getData() returns '' during dragover)
    const [draggedResourceLinkId, setDraggedResourceLinkId] = useState<string | null>(null);

    // Use courseEditMode to determine if this is a new course, with fallback to ID check
    // If course has a real database ID (not starting with 'course_'), it's definitely existing
    const hasRealId = course.id && !course.id.startsWith('course_');
    const isNewCourse = hasRealId ? false : (courseEditMode === 'create' || !course.id || course.id.startsWith('course_'));

const isWrittenAssessmentUrl = !course.writtenAssessmentLink || course.writtenAssessmentLink.startsWith('http://') || course.writtenAssessmentLink.startsWith('https://');
    const [writtenAssessmentInputType, setWrittenAssessmentInputType] = useState<'link' | 'upload'>(isWrittenAssessmentUrl ? 'link' : 'upload');

    const isPracticalPerformanceUrl = !course.practicalPerformanceAssessmentLink || course.practicalPerformanceAssessmentLink.startsWith('http://') || course.practicalPerformanceAssessmentLink.startsWith('https://');
    const [practicalPerformanceInputType, setPracticalPerformanceInputType] = useState<'link' | 'upload'>(isPracticalPerformanceUrl ? 'link' : 'upload');

    const companyNormalFundingRate = trainingProviderProfile?.fundingSettings?.normalFunding ?? 50;
    const companyMcesFundingRate = trainingProviderProfile?.fundingSettings?.enhancedFunding ?? 20;
    const companyGstRate = trainingProviderProfile?.fundingSettings?.gstRate ?? 9;
    const isCompanyGstRegistered = trainingProviderProfile?.fundingSettings?.isGstRegistered ?? true;
    const isReadOnly = courseEditMode === 'view';

    const baseCourseFee = parseNumericInput(course.courseFee);
    const computedGstAmount = isCompanyGstRegistered ? roundCurrency(baseCourseFee * (companyGstRate / 100)) : 0;
    const computedCourseFeeIncludeGst = roundCurrency(baseCourseFee + computedGstAmount);
    const computedAfterNormalFunding = roundCurrency((baseCourseFee * ((100 - companyNormalFundingRate) / 100)) + computedGstAmount);
    const computedAfterMcesFunding = roundCurrency((baseCourseFee * ((100 - companyNormalFundingRate - companyMcesFundingRate) / 100)) + computedGstAmount);

    // Debug logging for mode
    useEffect(() => {
        console.log('📝 CourseEditor: Mode:', courseEditMode, '| isNewCourse:', isNewCourse, '| Course ID:', course.id, '| hasRealId:', hasRealId);
    }, [courseEditMode, isNewCourse, course.id, hasRealId]);

    useEffect(() => {
        if (role !== UserRole.Admin && role !== UserRole.Developer) return;
        let cancelled = false;
        const loadTrainers = async () => {
            try {
                const response = await fetch('/api/admin/trainers-detail');
                const result = await response.json();
                if (!response.ok || !result.success) return;
                const activeTrainers = (result.data?.trainers || []).filter((trainer: TrainerOption) => {
                    const trainerStatus = String(trainer.status || '').toLowerCase();
                    const accountStatus = String(trainer.account_status || '').toLowerCase();
                    return trainerStatus === 'active' && accountStatus === 'active';
                });
                if (!cancelled) {
                    setAvailableTrainers(activeTrainers);
                }
            } catch (error) {
                console.error('❌ Failed to load available trainers:', error);
            }
        };
        loadTrainers();
        return () => {
            cancelled = true;
        };
    }, [role]);

    useEffect(() => {
        if (!editingCourse) return;

        const normalizedApprovedTrainers = (editingCourse.approvedTrainers || [])
            .map((trainer: string) => normalizeApprovedTrainerName(trainer))
            .filter(Boolean);

        setCourse(prev => {
            if (
                prev.skillsfutureLink === editingCourse.skillsfutureLink &&
                prev.brochureLink === editingCourse.brochureLink &&
                JSON.stringify(prev.approvedTrainers || []) === JSON.stringify(normalizedApprovedTrainers)
            ) {
                return prev;
            }
            return {
                ...prev,
                skillsfutureLink: editingCourse.skillsfutureLink,
                brochureLink: editingCourse.brochureLink,
                approvedTrainers: normalizedApprovedTrainers,
                numOfTrainers: normalizedApprovedTrainers.length,
                trainersList: normalizedApprovedTrainers.join(', '),
                trainersEmailList: editingCourse.trainersEmailList || '',
            };
        });
    }, [editingCourse]);

    const normalizeApprovedTrainerName = (trainerName: string) =>
        String(trainerName || '')
            .replace(/\s*[\[<(]?[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}[\]>)]?/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();

    // Build trainers_email_list aligned to the new name array.
    // Uses a merged map: existing positional emails + fresh availableTrainers lookup.
    // This preserves emails during reorder/remove even before availableTrainers loads.
    const buildTrainersEmailList = (newNames: string[]): string => {
        const existingNames = (course.trainersList || '').split(',').map(s => s.trim());
        const existingEmails = (course.trainersEmailList || '').split(',').map(s => s.trim());
        const nameToEmail = new Map<string, string>();
        // Layer 1: existing positional pairs (preserves data during reorder/remove)
        existingNames.forEach((name, i) => {
            if (name && existingEmails[i]) nameToEmail.set(name, existingEmails[i]);
        });
        // Layer 2: fresh data from availableTrainers (overrides if loaded)
        availableTrainers.forEach(t => {
            if (t.trainer_name) nameToEmail.set(t.trainer_name, t.email || '');
        });
        return newNames.map(name => nameToEmail.get(name) || '').join(', ');
    };

    const selectedApprovedTrainers = (course.approvedTrainers || []).map(normalizeApprovedTrainerName).filter(Boolean);
    const availableTrainerChoices = availableTrainers.filter(trainer => {
        const matchesSearch = !trainerSearch || trainer.trainer_name.toLowerCase().includes(trainerSearch.toLowerCase()) || trainer.email.toLowerCase().includes(trainerSearch.toLowerCase());
        return matchesSearch && !selectedApprovedTrainers.includes(trainer.trainer_name);
    });

    const addApprovedTrainer = (trainerName: string) => {
        const normalizedTrainerName = normalizeApprovedTrainerName(trainerName);
        if (!normalizedTrainerName || selectedApprovedTrainers.includes(normalizedTrainerName)) return;
        const updated = [...selectedApprovedTrainers, normalizedTrainerName];
        setCourse(prev => ({
            ...prev,
            approvedTrainers: updated,
            numOfTrainers: updated.length,
            trainersList: updated.join(', '),
            trainersEmailList: buildTrainersEmailList(updated),
        }));
        setTrainerSearch('');
    };

    const removeApprovedTrainer = (trainerName: string) => {
        const normalizedTrainerName = normalizeApprovedTrainerName(trainerName);
        const updated = selectedApprovedTrainers.filter(name => name !== normalizedTrainerName);
        setCourse(prev => ({
            ...prev,
            approvedTrainers: updated,
            numOfTrainers: updated.length,
            trainersList: updated.join(', '),
            trainersEmailList: buildTrainersEmailList(updated),
        }));
    };

    const reorderApprovedTrainers = (draggedName: string, targetName: string) => {
        if (!draggedName || !targetName || draggedName === targetName) return;

        const draggedIndex = selectedApprovedTrainers.indexOf(draggedName);
        const targetIndex = selectedApprovedTrainers.indexOf(targetName);
        if (draggedIndex < 0 || targetIndex < 0) return;

        const updated = [...selectedApprovedTrainers];
        const [movedTrainer] = updated.splice(draggedIndex, 1);
        updated.splice(targetIndex, 0, movedTrainer);

        setCourse(prev => ({
            ...prev,
            approvedTrainers: updated,
            numOfTrainers: updated.length,
            trainersList: updated.join(', '),
            trainersEmailList: buildTrainersEmailList(updated),
        }));
    };

    const handleApprovedTrainerDragStart = (trainerName: string) => {
        setDraggedApprovedTrainer(trainerName);
    };

    const handleApprovedTrainerDragEnd = () => {
        setDraggedApprovedTrainer(null);
        setApprovedTrainerDropTarget(null);
    };

    const handleApprovedTrainerDrop = (targetTrainerName: string) => {
        if (draggedApprovedTrainer) {
            reorderApprovedTrainers(draggedApprovedTrainer, targetTrainerName);
        }
        handleApprovedTrainerDragEnd();
    };

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
        e.currentTarget.classList.remove('ring-1', 'ring-blue-400');
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
        const inputMode = (e.target as HTMLInputElement).inputMode;

        if (type === 'number' || inputMode === 'decimal') {
            // Allow empty, digits, and one decimal point — preserve raw string for typing
            if (value === '' || /^\d*\.?\d*$/.test(value)) {
                setCourse({ ...course, [name]: value });
            }
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

    const handleSaveCourse = async (continueEditing = false) => {
        // Validation for required fields
        const requiredFields = [
            { field: course.title, name: 'Course Title' },
            { field: course.courseCode, name: 'Course Code' },
            { field: course.trainingHours, name: 'Training Hours' },
            { field: course.assessmentHours, name: 'Assessment Hours' },
            { field: course.courseType, name: 'Course Type' }
        ];

        // TSC Title and TSC Code are required for WSQ and IBF courses
        const isTscRequired = course.courseType === 'WSQ' || course.courseType === 'IBF';
        if (isTscRequired) {
            requiredFields.push(
                { field: course.tscTitle || '', name: 'TSC Title' },
                { field: course.tscCode || '', name: 'TSC Code' }
            );
        }

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

        // Validate trainer slides URL if it looks like a user-entered URL (skip uploaded file paths)
        if (course.trainerSlidesUrl && course.trainerSlidesUrl.trim() !== '' && !course.trainerSlidesUrl.startsWith('/uploads/')) {
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
                courseFee: baseCourseFee,
                taxPercent: companyGstRate / 100,
                scheduleId: course.scheduleId,
                courseFeesExcludeGst: baseCourseFee,
                courseFeesIncludeGst: computedCourseFeeIncludeGst,
                afterNormalFunding: computedAfterNormalFunding,
                afterMcesFunding: computedAfterMcesFunding,
                isUtapEligible: course.isUtapEligible || false,
                renewedStatus: course.renewedStatus,
                // Include trainer slides URL if it's a link (not upload)
                trainerSlidesUrl: course.trainerSlidesUrl,
                lessonPlanUrl: course.lessonPlanUrl || null,
                learnerGuideUrl: course.learnerGuideUrl || null,
                facilitatorGuideUrl: course.facilitatorGuideUrl || null,
                assessmentPlanUrl: course.assessmentPlanUrl || null,
                slidesUrl: course.slidesUrl || null,
                courseLink: course.courseLink || null,
                brochureLink: course.brochureLink || null,
                skillsfutureLink: course.skillsfutureLink || null,
                fundingValidity: course.fundingValidity || null,
                assessmentRecordLink: course.assessmentRecordLink || null,
                assessmentSummaryRecordUrl: course.assessmentSummaryRecordUrl || '',
                numOfTrainers: selectedApprovedTrainers.length,
                trainersList: selectedApprovedTrainers.join(', '),
                // Sync assessmentMethods links to legacy columns so view mode always shows latest
                writtenAssessmentLink: (course.assessmentMethods?.writtenAssessment?.enabled && course.assessmentMethods.writtenAssessment.link)
                    ? course.assessmentMethods.writtenAssessment.link
                    : (writtenAssessmentInputType === 'link' ? (course.writtenAssessmentLink || null) : null),
                practicalPerformanceAssessmentLink: (course.assessmentMethods?.practicalExam?.enabled && course.assessmentMethods.practicalExam.link)
                    ? course.assessmentMethods.practicalExam.link
                    : (practicalPerformanceInputType === 'link' ? (course.practicalPerformanceAssessmentLink || null) : null),
                assessmentMethods: course.assessmentMethods || null,
                // Drop rows that have no payload at all. Activity-type rows
                // are allowed to use instructions INSTEAD of a URL, so they
                // survive the filter as long as one of the two fields is
                // non-empty. Other resource types still require a URL.
                resourceLinks: resourceLinks.filter(rl => {
                    const hasUrl = rl.url.trim() !== '';
                    const hasInstructions =
                        rl.type === 'activity' &&
                        typeof rl.instructions === 'string' &&
                        rl.instructions.trim() !== '';
                    return hasUrl || hasInstructions;
                }),
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
            if (editingCourse?.trainerSlidesUrl && editingCourse.trainerSlidesUrl.includes('uploads/')) {
                // Clean up any old uploaded trainer slides file since we now use links only
                oldFileUrls.trainerSlides = editingCourse.trainerSlidesUrl;
            }
            if (files.writtenAssessment && writtenAssessmentInputType === 'upload') {
                formData.append('writtenAssessment', files.writtenAssessment);
                if (editingCourse?.writtenAssessmentLink && editingCourse.writtenAssessmentLink.includes('uploads/')) {
                    oldFileUrls.writtenAssessment = editingCourse.writtenAssessmentLink;
                }
            } else if (writtenAssessmentInputType === 'link' && editingCourse?.writtenAssessmentLink && editingCourse.writtenAssessmentLink.includes('uploads/')) {
                oldFileUrls.writtenAssessment = editingCourse.writtenAssessmentLink;
            }
            if (files.practicalPerformanceAssessment && practicalPerformanceInputType === 'upload') {
                formData.append('practicalPerformanceAssessment', files.practicalPerformanceAssessment);
                if (editingCourse?.practicalPerformanceAssessmentLink && editingCourse.practicalPerformanceAssessmentLink.includes('uploads/')) {
                    oldFileUrls.practicalPerformanceAssessment = editingCourse.practicalPerformanceAssessmentLink;
                }
            } else if (practicalPerformanceInputType === 'link' && editingCourse?.practicalPerformanceAssessmentLink && editingCourse.practicalPerformanceAssessmentLink.includes('uploads/')) {
                oldFileUrls.practicalPerformanceAssessment = editingCourse.practicalPerformanceAssessmentLink;
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
                inputType: 'link',
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
                // Clear the files marked for deletion since they were successfully processed
                setFilesToDelete([]);
                setDeletedAssessments([]);

                if (continueEditing) {
                    // Stay on the edit page — reload course data to get fresh state
                    if (isNewCourse && result.data?.courseId) {
                        // For new courses, update the course with the real ID from the server
                        setCourse(prev => ({ ...prev, id: result.data.courseId }));
                        setEditingCourse({ ...course, id: result.data.courseId } as any);
                        setCourseEditMode('edit');
                    }
                    // Reset file inputs since files were already uploaded
                    setFiles({
                        assessmentFiles: [],
                        assessmentFilesById: {}
                    });
                    alert(`Course "${courseData.title}" saved successfully!`);
                } else {
                    // Navigate away from editor
                    setEditingCourse(null);
                    setCourseEditMode(null);
                    alert(`Course "${courseData.title}" ${isNewCourse ? 'created' : 'updated'} successfully!`);
                }
                console.log('✅ Course saved:', result.data);
            } else {
                const errorDetail = result.error?.message || result.message || `Failed to ${isNewCourse ? 'create' : 'update'} course`;
                console.error('❌ Server error details:', result.error);
                throw new Error(errorDetail);
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

    const addResourceLink = (topicId: string, type: 'file' | 'document' | 'youtube' | 'activity' | 'quiz') => {
        setResourceLinks(prev => [...prev, { id: `rl_${Date.now()}`, topicId, type, title: '', url: '' }]);
    };

    const updateResourceLink = (id: string, field: 'title' | 'url' | 'instructions', value: string) => {
        setResourceLinks(prev => prev.map(rl => rl.id === id ? { ...rl, [field]: value } : rl));
    };

    const deleteResourceLink = (id: string) => {
        setResourceLinks(prev => prev.filter(rl => rl.id !== id));
    };

    const moveResourceLink = (draggedId: string, targetParentId: string) => {
        setResourceLinks(prev => {
            const draggedIndex = prev.findIndex(rl => rl.id === draggedId);
            if (draggedIndex === -1) return prev;

            const draggedLink = prev[draggedIndex];
            if (draggedLink.topicId === targetParentId) return prev;

            const nextLinks = [...prev];
            nextLinks[draggedIndex] = { ...draggedLink, topicId: targetParentId };
            return nextLinks;
        });
    };

    const reorderResourceLink = (draggedId: string, targetId: string, parentId: string) => {
        setResourceLinks(prev => {
            const newLinks = [...prev];
            const draggedIndex = newLinks.findIndex(rl => rl.id === draggedId);
            const targetIndex = newLinks.findIndex(rl => rl.id === targetId);
            if (draggedIndex === -1 || targetIndex === -1) return prev;
            // Move dragged item to parent if different
            newLinks[draggedIndex] = { ...newLinks[draggedIndex], topicId: parentId };
            const [dragged] = newLinks.splice(draggedIndex, 1);
            const newTargetIndex = newLinks.findIndex(rl => rl.id === targetId);
            newLinks.splice(newTargetIndex, 0, dragged);
            return newLinks;
        });
    };

    const handleUpdateAssessment = (id: string, field: 'title' | 'category' | 'fileUrl', value: string) => {
        setCourse(prev => ({ ...prev, assessments: prev.assessments?.map(a => a.id === id ? { ...a, [field]: value } : a) }));
    }

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
                case 'writtenAssessment':
                    isValid = validateDocumentFile(file, 'Written Assessment');
                    break;
                case 'practicalPerformanceAssessment':
                    isValid = validateDocumentFile(file, 'Practical Performance Assessment');
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
            <div className={`z-20 bg-background flex flex-col gap-3 pb-2 border-b border-gray-200 dark:border-gray-700 ${isReadOnly ? 'mb-2' : 'pt-0 mb-4'}`}>
                <div className={!isNewCourse ? 'space-y-0' : undefined}>
                    <h2 className={`font-bold dark:text-white ${!isNewCourse ? 'text-[1.625rem] leading-tight' : 'text-2xl'}`}>{isNewCourse ? 'Create Course' : course.title}</h2>
                    {!isNewCourse && course.courseCode && (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0">{course.courseCode}</p>
                    )}
                </div>
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-end gap-2">
                    <Button variant="ghost" onClick={() => {
                        setEditingCourse(null);
                        setCourseEditMode(null);
                    }}>Cancel</Button>
                    {!isReadOnly && !isNewCourse && (
                        <Button variant="outline" onClick={() => setCourseEditMode('view')}>
                            Exit Edit
                        </Button>
                    )}
                    {isReadOnly && (
                        <Button variant="primary" onClick={() => setCourseEditMode('edit')}>
                            Edit
                        </Button>
                    )}
                    {!isReadOnly && !isNewCourse && (
                        <Button variant="outline" onClick={() => handleSaveCourse(true)} disabled={isSaving}>
                            {isSaving ? <Spinner size="sm" /> : 'Save & Continue Editing'}
                        </Button>
                    )}
                    {!isReadOnly && (
                        <Button variant="primary" onClick={() => handleSaveCourse(false)} disabled={isSaving}>
                            {isSaving ? <Spinner size="sm" /> : (isNewCourse ? 'Create Course' : 'Save Changes')}
                        </Button>
                    )}
                </div>
            </div>

            {isReadOnly ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 items-start">
                    <div className="md:col-span-1 xl:col-span-1 space-y-6 xl:sticky xl:top-6">
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4 dark:text-white">Course Details</h3>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-2">Course Image</label>
                                    <div className="relative aspect-video bg-gray-100 dark:bg-gray-700 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-600 mb-3 shadow-sm">
                                        <img
                                            src={getCourseImageUrl(course.imageUrl, course.id)}
                                            alt={course.title}
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                const target = e.target as HTMLImageElement;
                                                target.src = `https://picsum.photos/seed/${course.id || 'default'}/400/200`;
                                            }}
                                        />
                                    </div>
                                    <LinkField label="Image URL Link" value={course.imageUrl} />
                                </div>
                                <ReadonlyValueField label="Course Title" value={course.title} />
                                <ReadonlyValueField label="Course Code" value={course.courseCode} />
                                <ReadonlyValueField label="TSC Title" value={course.tscTitle} />
                                <ReadonlyValueField label="TSC Code" value={course.tscCode} />
                                <ReadonlyValueField label="Funding Validity" value={course.fundingValidity} />
                                <ReadonlyValueField label="Training Hours" value={formatDisplayValue(course.trainingHours)} />
                                <ReadonlyValueField label="Assessment Hours" value={formatDisplayValue(course.assessmentHours)} />
                                <ReadonlyValueField label="Total Duration" value={`${Number(course.trainingHours || 0) + Number(course.assessmentHours || 0)} hours`} />
                                <ReadonlyValueField label="Mode of Learning" value={course.modeOfLearning?.join(', ')} />
                                <ReadonlyValueField label="Course Type" value={course.courseType} />
                                <ReadonlyValueField
                                    label="Approved Trainers"
                                    value={
                                        selectedApprovedTrainers.length > 0 ? (
                                            <div className="space-y-1">
                                                {selectedApprovedTrainers.map((trainerName) => (
                                                    <div key={trainerName}>{trainerName}</div>
                                                ))}
                                            </div>
                                        ) : '—'
                                    }
                                />
                            </div>
                        </Card>

                        {role === UserRole.Admin && (
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4 dark:text-white">Pricing & Funding</h3>
                                <div className="space-y-4">
                                    <ReadonlyValueField label="Schedule ID" value={course.scheduleId} />
                                    <ReadonlyValueField label="Course Fee ($)" value={formatCurrencyDisplay(baseCourseFee)} />
                                    <ReadonlyValueField label="Tax / GST Rate (%)" value={`${companyGstRate}%`} />
                                    <ReadonlyValueField label="GST ($)" value={formatCurrencyDisplay(computedGstAmount)} />
                                    <ReadonlyValueField label="Course Fee Incl. GST ($)" value={formatCurrencyDisplay(computedCourseFeeIncludeGst)} />
                                    <ReadonlyValueField label="After Normal Funding ($)" value={formatCurrencyDisplay(computedAfterNormalFunding)} />
                                    <ReadonlyValueField label="After MCES Funding ($)" value={formatCurrencyDisplay(computedAfterMcesFunding)} />
                                    <ReadonlyValueField label="UTAP Eligible" value={course.isUtapEligible ? 'Yes' : 'No'} />
                            </div>
                        </Card>
                    )}

                </div>

                    <div className="md:col-span-1 xl:col-span-2 space-y-6">
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-3">Learning Outcomes</h3>
                            <div className="whitespace-pre-wrap rounded-md border border-gray-300 bg-white px-3 py-2 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-white">
                                {course.learningOutcomes || '—'}
                            </div>
                        </Card>

                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4">Courseware</h3>
                            <div className="space-y-4">
                                <LinkField label="Lesson Plan URL" value={course.lessonPlanUrl} />
                                <LinkField label="Learner Guide URL" value={course.learnerGuideUrl} />
                                <LinkField label="Facilitator Guide URL" value={course.facilitatorGuideUrl} />
                                <LinkField label="Assessment Plan URL" value={course.assessmentPlanUrl} />
                                <LinkField label="Learner Slides URL" value={course.slidesUrl} />
                                <LinkField label="Trainer Slides URL" value={course.trainerSlidesUrl} />
                                <LinkField label="Courseware Link" value={course.courseLink} />
                                <LinkField label="Brochure Link" value={course.brochureLink} />
                                <LinkField label="SkillsFuture Link" value={course.skillsfutureLink} />
                                <LinkField label="Assessment Record Link" value={course.assessmentRecordLink} />
                                <LinkField label="Assessment Summary Record URL" value={course.assessmentSummaryRecordUrl} />
                            </div>
                        </Card>

                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4">Lesson</h3>
                            <div className="space-y-4">
                                {course.topics?.length ? course.topics.map((topic, index) => (
                                    <div key={topic.id} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                                        <h4 className="text-lg font-semibold dark:text-white">{index + 1}. {topic.title}</h4>
                                        {topic.subtopics?.length > 0 && (
                                            <ul className="mt-3 space-y-2 text-sm text-gray-700 dark:text-gray-300">
                                                {topic.subtopics.map((subtopic, subIndex) => (
                                                    <li key={subtopic.id}>{index + 1}.{subIndex + 1} {subtopic.title}</li>
                                                ))}
                                            </ul>
                                        )}
                                        {resourceLinks.filter(link => link.topicId === topic.id).length > 0 && (
                                            <div className="mt-4 space-y-2">
                                                {resourceLinks.filter(link => link.topicId === topic.id).map(link => (
                                                    <a
                                                        key={link.id}
                                                        href={link.url}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="block rounded-md border border-gray-200 px-3 py-2 text-sm text-blue-600 hover:underline dark:border-gray-700 dark:text-blue-300"
                                                    >
                                                        {link.title || link.url}
                                                    </a>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )) : (
                                    <div className="text-gray-500 dark:text-gray-400">No lessons available.</div>
                                )}
                            </div>
                        </Card>

                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4">Assessment Links</h3>
                            <div className="space-y-4">
                                <LinkField label="Written Exam" value={
                                    (course.assessmentMethods?.writtenAssessment?.enabled && course.assessmentMethods.writtenAssessment.link)
                                        ? course.assessmentMethods.writtenAssessment.link
                                        : course.writtenAssessmentLink
                                } />
                                <LinkField label="Practical Exam" value={
                                    (course.assessmentMethods?.practicalExam?.enabled && course.assessmentMethods.practicalExam.link)
                                        ? course.assessmentMethods.practicalExam.link
                                        : course.practicalPerformanceAssessmentLink
                                } />
                                {course.assessmentMethods && Object.entries(course.assessmentMethods).map(([key, method]) => {
                                    if (!method?.enabled) return null;
                                    if (key === 'writtenAssessment') return null;
                                    if (key === 'practicalExam') return null;
                                    return <LinkField key={key} label={ASSESSMENT_METHOD_LABELS[key as AssessmentMethodKey]} value={method.link} />;
                                })}
                            </div>
                        </Card>
                    </div>
                </div>
            ) : (
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
                                    TSC Title {(course.courseType === 'WSQ' || course.courseType === 'IBF') && <span className="text-red-500">*</span>}
                                </label>
                                <input type="text" id="tscTitle" name="tscTitle" value={course.tscTitle} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. Web Development" />
                            </div>
                            <div>
                                <label htmlFor="tscCode" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    TSC Code {(course.courseType === 'WSQ' || course.courseType === 'IBF') && <span className="text-red-500">*</span>}
                                </label>
                                <input type="text" id="tscCode" name="tscCode" value={course.tscCode} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. ICT-DIT-3011-1.1" />
                            </div>
                            <div>
                                <label htmlFor="fundingValidity" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                                    Funding Validity
                                </label>
                                <input type="date" id="fundingValidity" name="fundingValidity" value={(() => {
                                    if (!course.fundingValidity) return '';
                                    if (/^\d{4}-\d{2}-\d{2}/.test(course.fundingValidity)) return course.fundingValidity.slice(0, 10);
                                    const d = new Date(course.fundingValidity);
                                    if (isNaN(d.getTime())) return '';
                                    const yyyy = d.getFullYear();
                                    const mm = String(d.getMonth() + 1).padStart(2, '0');
                                    const dd = String(d.getDate()).padStart(2, '0');
                                    return `${yyyy}-${mm}-${dd}`;
                                })()} onChange={handleCourseChange} className={inputClasses} />
                                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Date until which the course funding is valid</p>
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
                                            <input type="text" inputMode="decimal" id="trainingHours" name="trainingHours" value={course.trainingHours} onChange={handleCourseChange} className={inputClasses} placeholder="0" />
                                        </div>
                                        <div>
                                            <label htmlFor="assessmentHours" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                                                Assessment Hours <span className="text-red-500">*</span>
                                            </label>
                                            <input type="text" inputMode="decimal" id="assessmentHours" name="assessmentHours" value={course.assessmentHours} onChange={handleCourseChange} className={inputClasses} placeholder="0" />
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
                    {role !== UserRole.Admin && (
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-3">Learning Outcomes</h3>
                            <textarea id="learningOutcomes" name="learningOutcomes" value={course.learningOutcomes} onChange={handleCourseChange} className={`${inputClasses} h-32`} placeholder="Describe the key learning outcomes..." />
                        </Card>
                    )}
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4">Courseware</h3>
                        <div className="space-y-4">
                            <div>
                                <label htmlFor="lessonPlanUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Lesson Plan URL</label>
                                <input
                                    type="url"
                                    id="lessonPlanUrl"
                                    value={course.lessonPlanUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, lessonPlanUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="learnerGuideUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Learner Guide URL</label>
                                <input
                                    type="url"
                                    id="learnerGuideUrl"
                                    value={course.learnerGuideUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, learnerGuideUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="facilitatorGuideUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Facilitator Guide URL</label>
                                <input
                                    type="url"
                                    id="facilitatorGuideUrl"
                                    value={course.facilitatorGuideUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, facilitatorGuideUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="assessmentPlanUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Assessment Plan URL</label>
                                <input
                                    type="url"
                                    id="assessmentPlanUrl"
                                    value={course.assessmentPlanUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, assessmentPlanUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="learnerSlidesUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Learner Slides URL</label>
                                <input
                                    type="url"
                                    id="learnerSlidesUrl"
                                    value={course.slidesUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, slidesUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="trainerSlidesUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Trainer Slides URL</label>
                                <input
                                    type="url"
                                    id="trainerSlidesUrl"
                                    name="trainerSlidesUrl"
                                    value={course.trainerSlidesUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, trainerSlidesUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/presentation/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="courseLink" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Courseware Link</label>
                                <input
                                    type="url"
                                    id="courseLink"
                                    value={course.courseLink || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, courseLink: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://..."
                                />
                            </div>
                            <div>
                                <label htmlFor="brochureLink" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Brochure Link</label>
                                <input
                                    type="url"
                                    id="brochureLink"
                                    value={course.brochureLink || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, brochureLink: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://drive.google.com/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="skillsfutureLink" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">SkillsFuture Link</label>
                                <input
                                    type="url"
                                    id="skillsfutureLink"
                                    value={course.skillsfutureLink || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, skillsfutureLink: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://www.myskillsfuture.gov.sg/..."
                                />
                            </div>
                            <div>
                                <label htmlFor="assessmentRecordLink" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Assessment Record Link</label>
                                <input
                                    type="url"
                                    id="assessmentRecordLink"
                                    value={course.assessmentRecordLink || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, assessmentRecordLink: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://..."
                                />
                            </div>
                            <div>
                                <label htmlFor="assessmentSummaryRecordUrl" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Assessment Summary Record URL</label>
                                <input
                                    type="url"
                                    id="assessmentSummaryRecordUrl"
                                    value={course.assessmentSummaryRecordUrl || ''}
                                    onChange={(e) => setCourse(prev => ({ ...prev, assessmentSummaryRecordUrl: e.target.value }))}
                                    className={inputClasses}
                                    placeholder="https://docs.google.com/..."
                                />
                            </div>
                        </div>
                    </Card>

                    {(role === UserRole.Trainer || role === UserRole.Developer) && (
                    <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                        <h3 className="text-xl font-bold mb-4">Assessment Methods</h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Select the assessment methods for this course. A link field will appear for each selected method.</p>
                        <div className="space-y-3">
                            {(Object.keys(ASSESSMENT_METHOD_LABELS) as AssessmentMethodKey[]).map((methodKey) => {
                                const methods = course.assessmentMethods || DEFAULT_ASSESSMENT_METHODS;
                                const method = methods[methodKey] || { enabled: false, link: '' };
                                return (
                                    <div key={methodKey} className="border dark:border-gray-700 rounded-lg p-3">
                                        <label className="flex items-center gap-3 cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={method.enabled}
                                                onChange={(e) => {
                                                    const updated = { ...methods, [methodKey]: { ...method, enabled: e.target.checked } };
                                                    setCourse(prev => ({ ...prev, assessmentMethods: updated }));
                                                }}
                                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                            />
                                            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">{ASSESSMENT_METHOD_LABELS[methodKey]}</span>
                                        </label>
                                        {method.enabled && (
                                            <div className="mt-2 ml-7">
                                                <input
                                                    type="url"
                                                    value={method.link}
                                                    onChange={(e) => {
                                                        const updated = { ...methods, [methodKey]: { ...method, link: e.target.value } };
                                                        setCourse(prev => ({ ...prev, assessmentMethods: updated }));
                                                    }}
                                                    className={inputClasses}
                                                    placeholder="https://docs.google.com/..."
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                    )}

                    {(role === UserRole.Admin || role === UserRole.Developer) && (
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4 dark:text-white">Approved Trainers</h3>
                            <div className="space-y-4">
                                <div>
                                    <label htmlFor="trainerSearch" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Add Trainer</label>
                                    <input
                                        id="trainerSearch"
                                        type="text"
                                        value={trainerSearch}
                                        onChange={(e) => setTrainerSearch(e.target.value)}
                                        className={inputClasses}
                                        placeholder="Search active trainer by name or email"
                                    />
                                </div>
                                {availableTrainerChoices.length > 0 && (
                                    <div className="max-h-56 overflow-y-auto rounded-md border border-gray-300 dark:border-gray-600">
                                        {availableTrainerChoices.slice(0, 12).map((trainer) => (
                                            <button
                                                key={trainer.user_id}
                                                type="button"
                                                onClick={() => addApprovedTrainer(trainer.trainer_name)}
                                                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-700"
                                            >
                                                <span className="dark:text-white">{trainer.trainer_name}</span>
                                                <span className="text-gray-500 dark:text-gray-400">{trainer.email}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <div className="space-y-2">
                                    <div className="text-sm text-gray-500 dark:text-gray-400">
                                        {selectedApprovedTrainers.length} assigned trainer{selectedApprovedTrainers.length === 1 ? '' : 's'}
                                    </div>
                                    {selectedApprovedTrainers.length > 0 ? (
                                        <div className="flex flex-wrap gap-2">
                                            {selectedApprovedTrainers.map((trainerName) => (
                                                <span
                                                    key={trainerName}
                                                    draggable
                                                    onDragStart={() => handleApprovedTrainerDragStart(trainerName)}
                                                    onDragEnd={handleApprovedTrainerDragEnd}
                                                    onDragOver={(e) => {
                                                        e.preventDefault();
                                                        if (trainerName !== draggedApprovedTrainer) {
                                                            setApprovedTrainerDropTarget(trainerName);
                                                        }
                                                    }}
                                                    onDragLeave={() => {
                                                        if (approvedTrainerDropTarget === trainerName) {
                                                            setApprovedTrainerDropTarget(null);
                                                        }
                                                    }}
                                                    onDrop={() => handleApprovedTrainerDrop(trainerName)}
                                                    className={`inline-flex cursor-grab items-center gap-2 rounded-full px-3 py-1 text-sm ${
                                                        approvedTrainerDropTarget === trainerName
                                                            ? 'bg-blue-200 text-blue-900 dark:bg-blue-800/60 dark:text-blue-100'
                                                            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
                                                    } ${draggedApprovedTrainer === trainerName ? 'opacity-60' : ''}`}
                                                    title="Drag to reorder trainer"
                                                >
                                                    {trainerName}
                                                    <button
                                                        type="button"
                                                        onClick={() => removeApprovedTrainer(trainerName)}
                                                        className="font-bold leading-none"
                                                        aria-label={`Remove ${trainerName}`}
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-sm text-gray-500 dark:text-gray-400">No assigned trainers selected.</div>
                                    )}
                                </div>
                            </div>
                        </Card>
                    )}

                    {role === UserRole.Developer && (
                        <div className="space-y-4">
                            {/* Lesson header row — the save buttons are mirrored here
                                so developers can save without scrolling back up to
                                the top of the page after editing topics/resources. */}
                            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
                                <h3 className="text-xl font-bold">Lesson</h3>
                                {!isReadOnly && (
                                    <div className="flex flex-wrap items-center gap-2">
                                        {!isNewCourse && (
                                            <Button variant="outline" size="sm" onClick={() => handleSaveCourse(true)} disabled={isSaving}>
                                                {isSaving ? <Spinner size="sm" /> : 'Save & Continue Editing'}
                                            </Button>
                                        )}
                                        <Button variant="primary" size="sm" onClick={() => handleSaveCourse(false)} disabled={isSaving}>
                                            {isSaving ? <Spinner size="sm" /> : (isNewCourse ? 'Create Course' : 'Save Changes')}
                                        </Button>
                                    </div>
                                )}
                            </div>
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
                                        resourceLinks={resourceLinks.filter(rl => topic.subtopics.some(st => st.id === rl.topicId))}
                                        onAddResourceLink={addResourceLink}
                                        onUpdateResourceLink={updateResourceLink}
                                        onDeleteResourceLink={deleteResourceLink}
                                        onReorderResourceLink={reorderResourceLink}
                                        onMoveResourceLink={moveResourceLink}
                                        draggedResourceLinkId={draggedResourceLinkId}
                                        onResourceLinkDragStart={(id: string) => setDraggedResourceLinkId(id)}
                                        onResourceLinkDragEnd={() => setDraggedResourceLinkId(null)}
                                    />
                                </div>
                            ))}
                            <Button variant="ghost" onClick={addTopic} className="w-full !py-3 !text-lg !font-semibold border-2 border-dashed !border-gray-300 dark:!border-gray-600 hover:!border-primary !text-subtle hover:!text-primary">
                                + Add Learning Unit
                            </Button>
                        </div>
                    )}

                    {(role === UserRole.Admin) && (
                        <Card className="p-6 dark:bg-gray-800 dark:border-gray-700">
                            <h3 className="text-xl font-bold mb-4 dark:text-white">Pricing & Funding</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                <div>
                                    <label htmlFor="scheduleId" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Schedule ID</label>
                                    <input type="text" id="scheduleId" name="scheduleId" value={course.scheduleId || ''} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. SCH-001" />
                                </div>
                                <div>
                                    <label htmlFor="courseFee" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Fee ($)</label>
                                    <input type="number" inputMode="decimal" id="courseFee" name="courseFee" value={course.courseFee ?? ''} onChange={handleCourseChange} className={inputClasses} placeholder="e.g. 500" />
                                </div>
                                <div>
                                    <label htmlFor="taxPercent" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Tax / GST Rate (%)</label>
                                    <input
                                        type="text"
                                        id="taxPercent"
                                        name="taxPercent"
                                        value={companyGstRate}
                                        readOnly
                                        className={inputClasses}
                                        placeholder="e.g. 9"
                                    />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">From Company Setting</p>
                                </div>
                                <div>
                                    <label htmlFor="gstAmount" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">GST ($)</label>
                                    <input type="text" id="gstAmount" value={formatCurrencyInput(computedGstAmount)} readOnly className={inputClasses} />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Computed as Course Fee × {companyGstRate}%</p>
                                </div>
                                <div>
                                    <label htmlFor="courseFeesIncludeGst" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">Course Fee Incl. GST ($)</label>
                                    <input type="text" id="courseFeesIncludeGst" value={formatCurrencyInput(computedCourseFeeIncludeGst)} readOnly className={inputClasses} />
                                </div>
                                <div>
                                    <label htmlFor="afterNormalFunding" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">After Normal Funding ($)</label>
                                    <input type="text" id="afterNormalFunding" value={formatCurrencyInput(computedAfterNormalFunding)} readOnly className={inputClasses} />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Using Company Setting rate of {companyNormalFundingRate}%</p>
                                </div>
                                <div>
                                    <label htmlFor="afterMcesFunding" className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">After MCES Funding ($)</label>
                                    <input type="text" id="afterMcesFunding" value={formatCurrencyInput(computedAfterMcesFunding)} readOnly className={inputClasses} />
                                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">Using Company Setting rate of {companyMcesFundingRate}%</p>
                                </div>
                                <div className="sm:col-span-2 lg:col-span-3">
                                    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-md border dark:border-gray-600">
                                        <div>
                                            <p className="font-semibold text-sm text-gray-900 dark:text-white">UTAP Eligible</p>
                                            <p className="text-xs text-subtle">Mark whether this course is eligible for UTAP funding.</p>
                                        </div>
                                        <input
                                            type="checkbox"
                                            id="isUtapEligible"
                                            checked={!!course.isUtapEligible}
                                            onChange={(e) => setCourse(prev => ({ ...prev, isUtapEligible: e.target.checked }))}
                                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        />
                                    </div>
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
            )}
        </div>
    );
};

export default CourseEditor;
