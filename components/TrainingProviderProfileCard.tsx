import React, { useState, useEffect, useRef } from 'react';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Icon, IconName } from './ui/Icon';
import { Spinner } from './ui';
import { TrainingProviderProfile } from '@app-types/profile';
import { useLms } from '@contexts/LmsContext';
import { applyPrimaryColor, useColorScheme, ThemeMode, getCurrentTheme, applyTheme } from '@utils/colorUtils';
import { getApiUrl, getFileUrl } from '@/lib/urlHelpers';
import PayrollSettingsView from './payroll/PayrollSettingsView';

// Constants for styling consistency
const inputClasses = "block w-full px-3 py-2 text-on-surface bg-surface border border-default rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent";

// API Key configurations with their available models
const API_KEY_CONFIGS: Record<string, { label: string; models: { value: string; label: string }[]; defaultModel: string }> = {
    'ANTHROPIC_API_KEY': {
        label: 'Anthropic (Claude)',
        defaultModel: 'claude-sonnet-4-6-20250527',
        models: [
            { value: 'claude-opus-4-6-20250527', label: 'Claude Opus 4.6' },
            { value: 'claude-sonnet-4-6-20250527', label: 'Claude Sonnet 4.6' },
        ]
    },
    'OPENAI_API_KEY': {
        label: 'OpenAI',
        defaultModel: 'gpt-5.1',
        models: [
            { value: 'gpt-5.4', label: 'GPT-5.4' },
            { value: 'gpt-5.1', label: 'GPT-5.1' },
            { value: 'gpt-5', label: 'GPT-5' },
        ]
    },
    'GEMINI_API_KEY': {
        label: 'Google Gemini',
        defaultModel: 'gemini-3-flash-preview',
        models: [
            { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro Preview' },
            { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' },
        ]
    },
    'MINIMAX_API_KEY': {
        label: 'MiniMax',
        defaultModel: 'MiniMax-M2.7',
        models: [
            { value: 'MiniMax-M2.7', label: 'MiniMax 2.7' },
            { value: 'MiniMax-M2.5', label: 'MiniMax 2.5' },
        ]
    },
    'KIMI_API_KEY': {
        label: 'Kimi (Moonshot)',
        defaultModel: 'kimi-latest',
        models: [
            { value: 'kimi-latest', label: 'Kimi Latest' },
            { value: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
            { value: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
        ]
    },
    'DEEPSEEK_API_KEY': {
        label: 'DeepSeek',
        defaultModel: 'deepseek-chat',
        models: [
            { value: 'deepseek-chat', label: 'DeepSeek V3.2 Chat' },
            { value: 'deepseek-reasoner', label: 'DeepSeek V3.2 Reasoner' },
        ]
    },
    'OPENROUTER_API_KEY': {
        label: 'OpenRouter',
        defaultModel: 'anthropic/claude-sonnet-4',
        models: [
            { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
            { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' },
            { value: 'openai/gpt-4.1', label: 'GPT-4.1' },
            { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
        ]
    },
    'OPENCLAW_HOOKS_TOKEN': {
        label: 'OpenClaw Hooks Token',
        defaultModel: '',
        models: []
    },
    'OPENCLAW_GATEWAY_TOKEN': {
        label: 'OpenClaw Gateway Token',
        defaultModel: '',
        models: []
    },
    'N8N_API_KEY': {
        label: 'n8n API Key',
        defaultModel: '',
        models: []
    },
    'FIRECRAWL_API_KEY': {
        label: 'Firecrawl API Key',
        defaultModel: '',
        models: []
    },
    'BIZFILE_CLIENT_ID': {
        label: 'Bizfile Client ID',
        defaultModel: '',
        models: []
    },
    'BIZFILE_CLIENT_SECRET': {
        label: 'Bizfile Client Secret',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_APP1_CLIENT_ID': {
        label: 'Client ID',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_APP1_CLIENT_SECRET': {
        label: 'Client Secret',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_APP2_CLIENT_ID': {
        label: 'Client ID',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_APP2_CLIENT_SECRET': {
        label: 'Client Secret',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_REFRESH_TOKEN': {
        label: 'Refresh Token',
        defaultModel: '',
        models: []
    },
    'QUICKBOOKS_REALM_ID': {
        label: 'Realm ID (Company ID)',
        defaultModel: '',
        models: []
    },
};

const LLM_API_KEY_NAMES = [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'MINIMAX_API_KEY',
    'KIMI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENROUTER_API_KEY',
] as const;
const OPENCLAW_API_KEY_NAMES = [
    'OPENCLAW_HOOKS_TOKEN',
    'OPENCLAW_GATEWAY_TOKEN',
] as const;
const N8N_API_KEY_NAMES = [
    'N8N_API_KEY',
] as const;
const FIRECRAWL_API_KEY_NAMES = [
    'FIRECRAWL_API_KEY',
] as const;
const BIZFILE_API_KEY_NAMES = [
    'BIZFILE_CLIENT_ID',
    'BIZFILE_CLIENT_SECRET',
] as const;
const QUICKBOOKS_APP1_KEY_NAMES = [
    'QUICKBOOKS_APP1_CLIENT_ID',
    'QUICKBOOKS_APP1_CLIENT_SECRET',
] as const;
const QUICKBOOKS_APP2_KEY_NAMES = [
    'QUICKBOOKS_APP2_CLIENT_ID',
    'QUICKBOOKS_APP2_CLIENT_SECRET',
] as const;

// Helper function to clean filename for display
const getCleanDisplayName = (filename: string): string => {
    if (!filename) return '';

    // Remove timestamp prefix (pattern: numbers_)
    const withoutTimestamp = filename.replace(/^\d+_/, '');

    // Fix double extensions (e.g., "test.txt.txt" -> "test.txt")
    const extension = withoutTimestamp.includes('.') ? '.' + withoutTimestamp.split('.').pop() : '';
    const nameWithoutExt = withoutTimestamp.replace(new RegExp(`\\${extension}$`), '');

    // Check if name ends with the same extension again
    if (extension && nameWithoutExt.toLowerCase().endsWith(extension.toLowerCase())) {
        const correctedName = nameWithoutExt.slice(0, -extension.length);
        return correctedName + extension;
    }

    return withoutTimestamp;
};

// Reusable Profile Bio Item Component
const ProfileBioItem: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div>
        <p className="text-sm text-subtle">{label}</p>
        <p className="font-semibold text-on-surface break-words">{value}</p>
    </div>
);

// Toggle Component for Settings
const ToggleSwitch: React.FC<{
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: string;
    isEditing: boolean;
}> = ({ checked, onChange, label, isEditing }) => {
    if (!isEditing) {
        return (
            <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                <span className="text-sm font-bold text-on-surface">{label}</span>
                <span className={`text-sm font-medium ${checked ? 'text-green-500' : 'text-gray-400'}`}>
                    {checked ? 'Enabled' : 'Disabled'}
                </span>
            </div>
        );
    }

    return (
        <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
            <label className="text-sm font-bold text-on-surface flex-grow cursor-pointer" onClick={() => onChange(!checked)}>
                {label}
            </label>
            <button
                type="button"
                onClick={() => onChange(!checked)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
                    }`}
            >
                <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'
                        }`}
                />
            </button>
        </div>
    );
};

interface TrainingProviderProfileCardProps {
    profile: TrainingProviderProfile;
    onUpdate: (userId: string, updatedData: Partial<TrainingProviderProfile>) => Promise<void>;
}

export const TrainingProviderProfileCard: React.FC<TrainingProviderProfileCardProps> = ({ profile, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);

    // Transform initial profile data to ensure colorScheme is a string
    const getInitialFormData = (profile: TrainingProviderProfile) => {
        // Extract default AI provider from apiKeys (stored as special entry)
        const defaultAiProvider = profile.apiKeys?.['DEFAULT_AI_PROVIDER'] || '';

        // Remove special keys from displayed apiKeys
        const cleanApiKeys = { ...profile.apiKeys };
        delete cleanApiKeys['DEFAULT_AI_PROVIDER'];

        const transformedProfile: TrainingProviderProfile & { defaultAiProvider: string } = {
            ...profile,
            apiKeys: cleanApiKeys,
            apiKeyModels: profile.apiKeyModels || {},
            defaultAiProvider,
        };

        // Handle colorScheme transformation from object to string
        if (profile.colorScheme && typeof profile.colorScheme === 'object' && 'primary' in profile.colorScheme) {
            transformedProfile.colorScheme = (profile.colorScheme as any).primary;
        }

        return transformedProfile;
    };

    const [formData, setFormData] = useState(getInitialFormData(profile));
    const [isSaving, setIsSaving] = useState(false);
    const [zoomStatus, setZoomStatus] = useState<{
        configured: boolean;
        connected: boolean;
        userEmail?: string | null;
    }>({
        configured: !!(profile.integrations?.zoomClientId && profile.integrations?.zoomClientSecret),
        connected: !!profile.integrations?.zoomConnected,
        userEmail: profile.integrations?.zoomUserEmail || null,
    });
    const [zoomBusy, setZoomBusy] = useState(false);
    const zoomPollIntervalRef = useRef<number | null>(null);
    const [newApiKey, setNewApiKey] = useState({ name: '', value: '' });
    const [visibleApiKeys, setVisibleApiKeys] = useState<{ [key: string]: boolean }>({});
    const [isApiKeysOpen, setIsApiKeysOpen] = useState(false);
    const [isLlmCredentialsOpen, setIsLlmCredentialsOpen] = useState(false);
    const [isOpenClawCredentialsOpen, setIsOpenClawCredentialsOpen] = useState(false);
    const [isN8nCredentialsOpen, setIsN8nCredentialsOpen] = useState(false);
    const [isFirecrawlCredentialsOpen, setIsFirecrawlCredentialsOpen] = useState(false);
    const [isBizfileCredentialsOpen, setIsBizfileCredentialsOpen] = useState(false);
    const [isQuickbooksCredentialsOpen, setIsQuickbooksCredentialsOpen] = useState(false);
    const [isCompanyOpen, setIsCompanyOpen] = useState(false);
    const [isContactOpen, setIsContactOpen] = useState(false);
    const [isDocTemplatesOpen, setIsDocTemplatesOpen] = useState(false);
    const [isSsgOpen, setIsSsgOpen] = useState(false);
    const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
    const [isGoogleIntegrationOpen, setIsGoogleIntegrationOpen] = useState(false);
    const [isZoomIntegrationOpen, setIsZoomIntegrationOpen] = useState(false);
    const [isOpenClawIntegrationOpen, setIsOpenClawIntegrationOpen] = useState(false);
    const [isMagentoIntegrationOpen, setIsMagentoIntegrationOpen] = useState(false);
    const [isN8nIntegrationOpen, setIsN8nIntegrationOpen] = useState(false);
    const [isAdminSettingsOpen, setIsAdminSettingsOpen] = useState(false);
    const [isPayrollOpen, setIsPayrollOpen] = useState(false);
    const [isSecurityOpen, setIsSecurityOpen] = useState(false);
    const [isGamificationOpen, setIsGamificationOpen] = useState(false);
    const [isSsgFundingOpen, setIsSsgFundingOpen] = useState(false);
    const [isGstOpen, setIsGstOpen] = useState(false);
    const [isAppearanceOpen, setIsAppearanceOpen] = useState(false);
    const [isEncryptionKeyVisible, setIsEncryptionKeyVisible] = useState(false);
    const [isApp1EncryptionKeyVisible, setIsApp1EncryptionKeyVisible] = useState(false);
    const [isApp3EncryptionKeyVisible, setIsApp3EncryptionKeyVisible] = useState(false);
    const [isSsgApp1Open, setIsSsgApp1Open] = useState(false);
    const [isSsgApp2Open, setIsSsgApp2Open] = useState(false);
    const [isSsgApp3Open, setIsSsgApp3Open] = useState(false);
    const [isSsgApp4Open, setIsSsgApp4Open] = useState(false);
    const [isApp4ClientSecretVisible, setIsApp4ClientSecretVisible] = useState(false);
    const [isVisibleGoogleSecret, setIsVisibleGoogleSecret] = useState(false);
    const [isVisibleGoogleRefreshToken, setIsVisibleGoogleRefreshToken] = useState(false);
    const [themeMode, setThemeMode] = useState<ThemeMode>(() => getCurrentTheme());

    // Get the updateTrainingProviderProfile function from the LMS context
    const { updateTrainingProviderProfile, updateCurrentUserProfile } = useLms();

    // Helper function to ensure absolute URL for images
    const getImageUrl = (url: string | undefined) => {
        if (!url) return '/images/default-company-logo.png'; // fallback image
        if (url.startsWith('http') || url.startsWith('blob:')) return url; // already absolute or blob URL
        return getFileUrl(url); // add server URL
    };

    // File upload states
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [invoiceTemplateFile, setInvoiceTemplateFile] = useState<File | null>(null);
    const [receiptTemplateFile, setReceiptTemplateFile] = useState<File | null>(null);
    const [certificateTemplateFile, setCertificateTemplateFile] = useState<File | null>(null);
    const [proFormaTemplateFile, setProFormaTemplateFile] = useState<File | null>(null);
    const [ssgCertFile, setSsgCertFile] = useState<File | null>(null);
    const [ssgPrivateKeyFile, setSsgPrivateKeyFile] = useState<File | null>(null);
    const [ssgApp1CertFile, setSsgApp1CertFile] = useState<File | null>(null);
    const [ssgApp1PrivateKeyFile, setSsgApp1PrivateKeyFile] = useState<File | null>(null);
    const [ssgApp3CertFile, setSsgApp3CertFile] = useState<File | null>(null);
    const [ssgApp3PrivateKeyFile, setSsgApp3PrivateKeyFile] = useState<File | null>(null);
    const [serviceAccountKeyFile, setServiceAccountKeyFile] = useState<File | null>(null);

    const adminSettingLabels: { [key: string]: string } = {
        autoSendProFormaInvoice: "Auto Send Pro Forma Invoice Upon Course Confirmation",
        autoSendConfirmationEmail: "Auto Send Confirmation Email Upon Course Confirmation",
        autoSendInvoiceOnGrantSuccess: "Auto Send Invoice Upon Successful Grant Application",
        autoSendReceiptOnPayment: "Auto Send Receipt Upon Payment Received",
        autoSendCertificateOnCompletion: "Auto Send Certificate On Achievement Upon Class Completed",
        autoSendThankYouEmail: "Auto Send Thank You Email Upon Class Completed",
        autoImportDaFromEmail: "Auto Import Direct Applications from MySkillsFuture Email",
        autoEnrolDirectApplications: "Auto Submit Direct Applications to SSG",
        autoGenerateQbInvoice: "Auto Generate QuickBooks Invoice for Direct Applications",
        autoAddLearnerToCalendar: "Auto Add Learner to Calendar for Direct Applications",
        showLessonPlanLearnerView: "Show Lesson Plan on Learner View",
        showCertificateDelivery: "Show Certificate Delivery on Course Page (in addition to TRAQOM Survey)",
    };

    useEffect(() => {
        // Transform profile data to ensure colorScheme is a string
        setFormData(getInitialFormData(profile));
        setZoomStatus({
            configured: !!(profile.integrations?.zoomClientId && profile.integrations?.zoomClientSecret),
            connected: !!profile.integrations?.zoomConnected,
            userEmail: profile.integrations?.zoomUserEmail || null,
        });
    }, [profile]);

    // Clean up blob URLs to prevent memory leaks
    useEffect(() => {
        return () => {
            if (formData.companyLogoUrl && formData.companyLogoUrl.startsWith('blob:')) {
                URL.revokeObjectURL(formData.companyLogoUrl);
            }
        };
    }, [formData.companyLogoUrl]);

    useEffect(() => {
        if (!isIntegrationsOpen) return;
        const selectedProvider = (formData.integrations as any)?.virtualMeetingProvider || 'google_meet';
        if (selectedProvider === 'google_meet') setIsGoogleIntegrationOpen(true);
        if (selectedProvider === 'zoom') setIsZoomIntegrationOpen(true);
    }, [isIntegrationsOpen, formData.integrations]);

    useEffect(() => {
        return () => {
            if (zoomPollIntervalRef.current) {
                window.clearInterval(zoomPollIntervalRef.current);
            }
        };
    }, []);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleContactChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            contactPerson: {
                ...prev.contactPerson,
                [name]: value
            }
        }));
    };

    const renderCredentialInputs = (keyNames: readonly (keyof typeof API_KEY_CONFIGS)[]) => (
        <div className="space-y-4">
            {keyNames.map((keyName) => {
                const keyValue = (formData.apiKeys || {})[keyName] || '';
                const selectedModel = (formData.apiKeyModels && keyName in formData.apiKeyModels)
                    ? formData.apiKeyModels[keyName]
                    : (API_KEY_CONFIGS[keyName]?.defaultModel || '');
                const isVisible = visibleApiKeys[keyName];
                const config = API_KEY_CONFIGS[keyName];
                const supportsModels = (config?.models?.length || 0) > 0;
                const isLlmCredential = LLM_API_KEY_NAMES.includes(keyName as typeof LLM_API_KEY_NAMES[number]);
                const isDefaultProvider = formData.defaultAiProvider === keyName;
                const inputLabel =
                    keyName === 'OPENCLAW_HOOKS_TOKEN'
                        ? ''
                        : keyName === 'OPENCLAW_GATEWAY_TOKEN'
                            ? ''
                            : keyName === 'N8N_API_KEY'
                                ? ''
                            : 'API Key';

                return (
                    <div
                        key={keyName}
                        className="p-4 rounded-lg border border-gray-300 dark:border-gray-600 bg-surface"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <span className="font-semibold text-on-surface">
                                {config?.label || keyName}
                            </span>
                            <div className="flex items-center gap-4">
                                {isLlmCredential && (
                                    isEditing ? (
                                        <label className={`flex items-center gap-2 text-sm ${keyValue ? 'text-on-surface' : 'text-subtle'}`}>
                                            <input
                                                type="radio"
                                                name="default-llm-provider"
                                                checked={isDefaultProvider}
                                                disabled={!keyValue}
                                                onChange={() => {
                                                    if (!keyValue) return;
                                                    setFormData(prev => ({ ...prev, defaultAiProvider: keyName } as any));
                                                }}
                                                className="h-4 w-4 accent-primary"
                                            />
                                            Default Model
                                        </label>
                                    ) : (
                                        isDefaultProvider ? (
                                            <span className="text-sm text-primary font-medium">Default Model</span>
                                        ) : null
                                    )
                                )}
                                {keyValue && (
                                    <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
                                        <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                                        Configured
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3">
                            <div className="flex-1">
                                {inputLabel && (
                                    <label className="block text-xs text-subtle mb-1">{inputLabel}</label>
                                )}
                                {isEditing ? (
                                    <div className="relative">
                                        <input
                                            type={isVisible ? "text" : "password"}
                                            value={keyValue}
                                            onChange={(e) => {
                                                const newValue = e.target.value;
                                                setFormData(prev => ({
                                                    ...prev,
                                                    apiKeys: {
                                                        ...(prev.apiKeys || {}),
                                                        [keyName]: newValue
                                                    }
                                                }));
                                            }}
                                            placeholder={inputLabel ? `Enter ${inputLabel.toLowerCase()}...` : 'Enter API key...'}
                                            className="w-full px-3 py-2 text-on-surface bg-surface border border-gray-300 dark:border-gray-600 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent pr-10"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                            className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
                                        >
                                            <Icon
                                                name={isVisible ? IconName.EyeOff : IconName.Eye}
                                                className="w-4 h-4"
                                            />
                                        </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 px-3 py-2 bg-surface border border-gray-300 dark:border-gray-600 rounded-md">
                                        <span className="flex-grow text-on-surface font-mono text-sm truncate">
                                            {keyValue ? (
                                                isVisible ? keyValue : `••••••••••••••••••••${keyValue.slice(-4)}`
                                            ) : (
                                                <span className="text-gray-500 italic">Not set</span>
                                            )}
                                        </span>
                                        {keyValue && (
                                            <button
                                                type="button"
                                                onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 flex-shrink-0"
                                            >
                                                <Icon
                                                    name={isVisible ? IconName.EyeOff : IconName.Eye}
                                                    className="w-4 h-4"
                                                />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>

                            {supportsModels && (
                                <div className="sm:w-48 flex-shrink-0">
                                    <label className="block text-xs text-subtle mb-1">Model</label>
                                    {isEditing ? (
                                        <select
                                            value={selectedModel}
                                            onChange={(e) => {
                                                setFormData(prev => ({
                                                    ...prev,
                                                    apiKeyModels: {
                                                        ...(prev.apiKeyModels || {}),
                                                        [keyName]: e.target.value
                                                    }
                                                }));
                                            }}
                                            className="w-full px-3 py-2 text-on-surface bg-surface border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                                            disabled={!keyValue}
                                        >
                                            <option value="">None</option>
                                            {config?.models.map((model) => (
                                                <option key={model.value} value={model.value}>
                                                    {model.label}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        <div className="px-3 py-2 bg-surface border border-gray-300 dark:border-gray-600 rounded-md">
                                            <span className="text-on-surface text-sm">
                                                {keyValue ? (
                                                    selectedModel === '' ? 'None' : (config?.models.find(m => m.value === selectedModel)?.label || selectedModel)
                                                ) : (
                                                    <span className="text-gray-500 italic">-</span>
                                                )}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );

    // Map from camelCase admin setting keys to snake_case DB column names
    // for the lightweight auto-save that bypasses the full profile save.
    const adminSettingDbColumns: Record<string, string> = {
        autoSendProFormaInvoice: 'auto_send_proforma_invoice',
        autoSendConfirmationEmail: 'auto_send_confirm_email',
        autoSendInvoiceOnGrantSuccess: 'auto_send_invoice',
        autoSendReceiptOnPayment: 'auto_send_receipt',
        autoSendCertificateOnCompletion: 'auto_send_certificate',
        autoSendThankYouEmail: 'auto_send_thankyou_email',
        autoImportDaFromEmail: 'auto_import_da_from_email',
        autoEnrolDirectApplications: 'auto_enrol_direct_applications',
        autoGenerateQbInvoice: 'auto_generate_qb_invoice',
        autoAddLearnerToCalendar: 'auto_add_learner_to_calendar',
        showLessonPlanLearnerView: 'show_lesson_plan_learner_view',
        showCertificateDelivery: 'show_certificate_delivery',
    };

    const handleToggleChange = (section: 'adminSettings' | 'securitySettings' | 'integrations' | 'gamingSettings' | 'fundingSettings', key: string) => {
        setFormData(prev => {
            const currentSection = prev[section];
            const newValue = !(currentSection as any)[key];

            // Auto-save admin setting toggles immediately via a lightweight
            // PATCH-style endpoint so the user doesn't have to click Save.
            if (section === 'adminSettings' && adminSettingDbColumns[key]) {
                fetch(getApiUrl('/api/training-provider/toggle-setting'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ column: adminSettingDbColumns[key], value: newValue }),
                }).catch(err => console.error('Failed to auto-save toggle:', err));

                // Also update the global LmsContext so other pages (e.g. CourseDetail)
                // reflect the change immediately without requiring a page refresh.
                const contextKeys: Record<string, string> = {
                    showCertificateDelivery: 'showCertificateDelivery',
                    showLessonPlanLearnerView: 'showLessonPlanLearnerView',
                };
                if (contextKeys[key]) {
                    updateTrainingProviderProfile({ [contextKeys[key]]: newValue } as any);
                }
            }

            return {
                ...prev,
                [section]: {
                    ...currentSection,
                    [key]: newValue
                }
            };
        });
    };

    const handleFundingChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            fundingSettings: {
                ...prev.fundingSettings,
                [name]: name === 'isGstRegistered' ? e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : value === 'true'
                    : name === 'normalFunding' ? (parseInt(value) as 50 | 70)
                        : name === 'enhancedFunding' ? parseInt(value)
                            : name === 'gstRate' ? parseFloat(value)
                                : value
            }
        }));
    };

    const handleAddApiKey = () => {
        if (newApiKey.name && newApiKey.value) {
            setFormData(prev => ({
                ...prev,
                apiKeys: {
                    ...(prev.apiKeys || {}),
                    [newApiKey.name]: newApiKey.value
                }
            }));
            setNewApiKey({ name: '', value: '' });
        }
    };

    const handleRemoveApiKey = (keyName: string) => {
        setFormData(prev => {
            const newApiKeys = { ...(prev.apiKeys || {}) };
            delete newApiKeys[keyName];
            return {
                ...prev,
                apiKeys: newApiKeys
            };
        });
    };

    const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newColor = e.target.value;

        setFormData(prev => ({
            ...prev,
            colorScheme: newColor
        }));

        // Apply the color change immediately for real-time preview
        if (isEditing) {
            applyPrimaryColor(newColor);
            console.log(`🎨 Real-time color preview applied: ${newColor}`);
        }
    };

    const handleThemeToggle = () => {
        const newTheme: ThemeMode = themeMode === 'dark' ? 'light' : 'dark';
        setThemeMode(newTheme);
        applyTheme(newTheme);
        console.log(`🌓 Theme toggled to: ${newTheme}`);
    };

    const handleTemplateUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'invoiceTemplateUrl' | 'receiptTemplateUrl' | 'certificateTemplateUrl' | 'proFormaInvoiceTemplateUrl' | 'ssgCertFile' | 'ssgPrivateKeyFile' | 'ssgApp1CertFile' | 'ssgApp1PrivateKeyFile' | 'ssgApp3CertFile' | 'ssgApp3PrivateKeyFile' | 'serviceAccountKeyFile') => {
        const file = e.target.files?.[0];
        if (file) {
            // Debug log to see what's happening with the filename and file details
            console.log(`🔍 handleTemplateUpload - Field: ${field}`);
            console.log(`🔍 File details:`, {
                name: file.name,
                size: file.size,
                type: file.type,
                lastModified: file.lastModified,
                webkitRelativePath: file.webkitRelativePath
            });

            // Check if file is empty
            if (file.size === 0) {
                alert(`⚠️ The selected file "${file.name}" is empty (0 bytes). Please select a file with content.`);
                e.target.value = ''; // Clear the input
                return;
            }

            // Store the file in the appropriate state variable
            switch (field) {
                case 'invoiceTemplateUrl':
                    setInvoiceTemplateFile(file);
                    break;
                case 'receiptTemplateUrl':
                    setReceiptTemplateFile(file);
                    break;
                case 'certificateTemplateUrl':
                    setCertificateTemplateFile(file);
                    break;
                case 'proFormaInvoiceTemplateUrl':
                    setProFormaTemplateFile(file);
                    break;
                case 'ssgCertFile':
                    setSsgCertFile(file);
                    break;
                case 'ssgPrivateKeyFile':
                    setSsgPrivateKeyFile(file);
                    break;
                case 'ssgApp1CertFile':
                    setSsgApp1CertFile(file);
                    break;
                case 'ssgApp1PrivateKeyFile':
                    setSsgApp1PrivateKeyFile(file);
                    break;
                case 'ssgApp3CertFile':
                    setSsgApp3CertFile(file);
                    break;
                case 'ssgApp3PrivateKeyFile':
                    setSsgApp3PrivateKeyFile(file);
                    break;
                case 'serviceAccountKeyFile':
                    setServiceAccountKeyFile(file);
                    break;
            }

            // Update the form data to show the cleaned filename for immediate display
            setFormData(prev => {
                const cleanedName = getCleanDisplayName(file.name);
                const newFormData = {
                    ...prev,
                    [field]: cleanedName  // Store cleaned filename for display
                };
                console.log(`🔍 Updated formData[${field}]: original "${file.name}" -> cleaned "${cleanedName}"`);
                return newFormData;
            });
        }
    };

    const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setLogoFile(file); // Store the file for upload

            // Create preview URL for immediate display
            const previewUrl = URL.createObjectURL(file);
            setFormData(prev => ({ ...prev, companyLogoUrl: previewUrl }));
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Create FormData for multipart upload
            const formDataToSend = new FormData();

            // Filter out empty API key values before sending
            const filteredApiKeys: Record<string, string> = {};
            if (formData.apiKeys) {
                for (const [key, value] of Object.entries(formData.apiKeys)) {
                    const strValue = typeof value === 'string' ? value.trim() : '';
                    if (strValue !== '') {
                        filteredApiKeys[key] = strValue;
                    }
                }
            }

            // Include default AI provider selection as a special API key entry
            if (formData.defaultAiProvider) {
                filteredApiKeys['DEFAULT_AI_PROVIDER'] = formData.defaultAiProvider;
            }

            // Prepare profile data with filtered API keys
            const profileDataToSend = {
                ...formData,
                apiKeys: filteredApiKeys
            };

            console.log('📤 Sending profile data:', {
                userId: profile.id,
                apiKeysCount: Object.keys(filteredApiKeys).length,
                apiKeyNames: Object.keys(filteredApiKeys)
            });

            // Add user ID and profile data as JSON string
            formDataToSend.append('userId', profile.id);
            formDataToSend.append('profileData', JSON.stringify(profileDataToSend));

            // Add file uploads if they exist
            if (logoFile) {
                formDataToSend.append('companyLogo', logoFile);
            }
            if (invoiceTemplateFile) {
                formDataToSend.append('invoiceTemplate', invoiceTemplateFile);
            }
            if (receiptTemplateFile) {
                formDataToSend.append('receiptTemplate', receiptTemplateFile);
            }
            if (certificateTemplateFile) {
                formDataToSend.append('certificateTemplate', certificateTemplateFile);
            }
            if (proFormaTemplateFile) {
                formDataToSend.append('proFormaInvoiceTemplate', proFormaTemplateFile);
            }
            if (ssgCertFile) {
                formDataToSend.append('ssgCertFile', ssgCertFile);
            }
            if (ssgPrivateKeyFile) {
                formDataToSend.append('ssgPrivateKeyFile', ssgPrivateKeyFile);
            }
            if (ssgApp1CertFile) {
                formDataToSend.append('ssgApp1CertFile', ssgApp1CertFile);
            }
            if (ssgApp1PrivateKeyFile) {
                formDataToSend.append('ssgApp1PrivateKeyFile', ssgApp1PrivateKeyFile);
            }
            if (ssgApp3CertFile) {
                formDataToSend.append('ssgApp3CertFile', ssgApp3CertFile);
            }
            if (ssgApp3PrivateKeyFile) {
                formDataToSend.append('ssgApp3PrivateKeyFile', ssgApp3PrivateKeyFile);
            }
            if (serviceAccountKeyFile) {
                formDataToSend.append('serviceAccountKeyFile', serviceAccountKeyFile);
            }

            // Call the training provider update API
            const response = await fetch(getApiUrl('/api/training-provider/update'), {
                method: 'PUT',
                body: formDataToSend,
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                const errorMsg = result.details
                    ? `${result.error}: ${result.details}`
                    : result.error || 'Failed to update profile';
                throw new Error(errorMsg);
            }

            console.log('✅ Profile updated successfully:', result);

            // Clear file states after successful upload
            setLogoFile(null);
            setInvoiceTemplateFile(null);
            setReceiptTemplateFile(null);
            setCertificateTemplateFile(null);
            setProFormaTemplateFile(null);
            setSsgCertFile(null);
            setSsgPrivateKeyFile(null);
            setServiceAccountKeyFile(null);

            // Update only the file URL fields from the server response — do NOT replace the
            // entire formData, as the server only returns a partial set of fields and would
            // wipe out colorScheme, apiKeys, etc., and cause the logo to flicker or reset.
            if (result.data && result.data.profile) {
                const serverProfile = result.data.profile;
                setFormData(prev => ({
                    ...prev,
                    companyLogoUrl:            serverProfile.companyLogoUrl            ?? prev.companyLogoUrl,
                    invoiceTemplateUrl:        serverProfile.invoiceTemplateUrl        ?? prev.invoiceTemplateUrl,
                    receiptTemplateUrl:        serverProfile.receiptTemplateUrl        ?? prev.receiptTemplateUrl,
                    certificateTemplateUrl:    serverProfile.certificateTemplateUrl    ?? prev.certificateTemplateUrl,
                    proFormaInvoiceTemplateUrl: serverProfile.proFormaInvoiceTemplateUrl ?? prev.proFormaInvoiceTemplateUrl,
                }));

                // Update the training provider profile in the LMS context for header logo
                // and admin settings that affect other pages (e.g. CourseDetail)
                updateTrainingProviderProfile({
                    companyLogoUrl: serverProfile.companyLogoUrl,
                    companyShortname: serverProfile.companyShortname || serverProfile.companyName,
                    certificateDeliveryLabel: formData.adminSettings?.certificateDeliveryLabel,
                    certificateDeliveryLink: formData.adminSettings?.certificateDeliveryLink,
                    showCertificateDelivery: formData.adminSettings?.showCertificateDelivery,
                    showLessonPlanLearnerView: formData.adminSettings?.showLessonPlanLearnerView,
                });

                // Update the current user profile so the profile dropdown shows the same image
                updateCurrentUserProfile({
                    profilePictureUrl: serverProfile.companyLogoUrl,
                    name: serverProfile.companyName
                });

                // Re-apply the color scheme after successful save
                if (formData.colorScheme) {
                    applyPrimaryColor(formData.colorScheme);
                    console.log(`🎨 Re-applied color after save: ${formData.colorScheme}`);
                }
            }

            // Update the profile with new data and exit edit mode
            // Note: pass the merged result so the parent gets the server-confirmed file URLs
            onUpdate(profile.id, { ...formData, ...(result.data?.profile ?? {}) });
            setIsEditing(false);

            // Show success message (you can add toast notification here)
            alert('Profile updated successfully!');

        } catch (error) {
            console.error('❌ Failed to update profile:', error);
            alert(`Failed to update profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
        } finally {
            setIsSaving(false);
        }
    };

    const refreshZoomStatus = async () => {
        try {
            const response = await fetch(getApiUrl('/api/integrations/zoom/status'));
            const result = await response.json();
            if (result.success) {
                const nextStatus = {
                    configured: !!result.data.configured,
                    connected: !!result.data.connected,
                    userEmail: result.data.userEmail || null,
                };
                setZoomStatus(nextStatus);
                return nextStatus;
            }
        } catch {
            // Best-effort status refresh only.
        }
        return null;
    };

    const handleConnectZoom = () => {
        if (zoomPollIntervalRef.current) {
            window.clearInterval(zoomPollIntervalRef.current);
            zoomPollIntervalRef.current = null;
        }

        const popup = window.open(getApiUrl('/api/integrations/zoom/oauth/connect'), '_blank', 'noopener,noreferrer,width=720,height=760');
        setZoomBusy(true);
        const startedAt = Date.now();
        const timeoutMs = 120000;

        zoomPollIntervalRef.current = window.setInterval(async () => {
            const status = await refreshZoomStatus();
            const popupClosed = !!popup?.closed;
            const timedOut = Date.now() - startedAt > timeoutMs;

            if (status?.connected || popupClosed || timedOut) {
                if (zoomPollIntervalRef.current) {
                    window.clearInterval(zoomPollIntervalRef.current);
                    zoomPollIntervalRef.current = null;
                }
                if (popupClosed && !status?.connected) {
                    await refreshZoomStatus();
                }
                setZoomBusy(false);
                if (timedOut && !status?.connected) {
                    alert('Zoom authorization was not completed. Try Connect Zoom again if needed.');
                }
            }
        }, 2000);
    };

    const handleTestZoom = async () => {
        setZoomBusy(true);
        try {
            const response = await fetch(getApiUrl('/api/integrations/zoom/test'), { method: 'POST' });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Zoom test failed');
            await refreshZoomStatus();
            alert(`Zoom connected as ${result.data?.email || 'the configured account'}`);
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Zoom test failed');
        } finally {
            setZoomBusy(false);
        }
    };

    const handleDisconnectZoom = async () => {
        if (!confirm('Disconnect Zoom for this training provider? Existing course run links will remain, but new Zoom meetings cannot be generated until Zoom is connected again.')) return;
        setZoomBusy(true);
        try {
            const response = await fetch(getApiUrl('/api/integrations/zoom/disconnect'), { method: 'POST' });
            const result = await response.json();
            if (!response.ok || !result.success) throw new Error(result.error || 'Zoom disconnect failed');
            await refreshZoomStatus();
        } catch (error) {
            alert(error instanceof Error ? error.message : 'Zoom disconnect failed');
        } finally {
            setZoomBusy(false);
        }
    };

    const handleCancelEdit = () => {
        setIsEditing(false);
        setFormData(getInitialFormData(profile));
    };

    const renderSectionActions = () => (
        <div className="flex flex-shrink-0 items-center gap-2">
            {isEditing ? (
                <>
                    <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                        Cancel
                    </Button>
                    <Button size="sm" onClick={handleSave} disabled={isSaving}>
                        {isSaving ? 'Saving...' : 'Save'}
                    </Button>
                </>
            ) : (
                <Button size="sm" className="!text-white" onClick={() => setIsEditing(true)}>
                    <Icon name={IconName.Edit} className="w-4 h-4 mr-2" />
                    Edit
                </Button>
            )}
        </div>
    );

    const ssgAppCount = Math.max(1, Math.min(4, formData.ssgAppCount ?? 1));
    const hasZoomCredentialsInForm = !!((formData.integrations as any).zoomClientId && (formData.integrations as any).zoomClientSecret);
    const zoomConnectButtonLabel = zoomBusy ? 'Waiting...' : isEditing ? 'Save first' : 'Connect Zoom';
    const getSsgAppLabel = (appKey: 'app1' | 'app2' | 'app3' | 'app4') => {
        const n = appKey.replace('app', '');
        const customName = formData.ssgAppNames?.[appKey]?.trim();
        return customName ? `App ${n} (${customName})` : `App ${n}`;
    };

    const renderSsgAppHeader = (
        title: string,
        appKey: string,
        isOpen: boolean,
        toggle: () => void
    ) => {
        const isDefault = formData.ssgDefaultApp === appKey;
        return (
            <button
                type="button"
                onClick={toggle}
                className={`w-full rounded-md border px-6 py-5 text-left transition-colors ${isDefault ? 'border-green-500/40 bg-green-500/5 hover:border-green-500/60' : 'border-default bg-surface-elevated hover:border-primary/40'}`}
            >
                <div className="flex items-center justify-between gap-4">
                    <h3 className={`text-lg font-bold ${isDefault ? 'text-green-400' : 'text-on-surface'}`}>{title}</h3>
                    <Icon
                        name={IconName.ChevronDown}
                        className={`w-5 h-5 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                    />
                </div>
            </button>
        );
    };

    const renderDefaultRadio = (appKey: string) => {
        const isDefault = formData.ssgDefaultApp === appKey;
        if (!isDefault && !isEditing) return null;
        return (
            <div className="mt-2 col-span-full">
                <button
                    type="button"
                    onClick={() => isEditing && setFormData(prev => ({ ...prev, ssgDefaultApp: appKey }))}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors ${isDefault ? 'text-green-400' : 'text-on-surface-secondary hover:text-primary cursor-pointer'}`}
                >
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${isDefault ? 'border-green-400' : 'border-gray-500'}`}>
                        {isDefault && <div className="w-2 h-2 rounded-full bg-green-400" />}
                    </div>
                    <span className="text-sm font-medium">{isDefault ? 'Default App for SSG API' : 'Set as Default for SSG API'}</span>
                </button>
            </div>
        );
    };

    const renderSectionHeader = (
        title: string,
        isOpen: boolean,
        toggle: () => void,
        titleClassName = 'text-xl font-bold dark:text-white'
    ) => (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button type="button" onClick={toggle} className="group flex flex-1 items-center justify-between text-left">
                <h2 className={titleClassName}>{title}</h2>
                <Icon name={IconName.ChevronDown} className={`w-5 h-5 text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 transition-transform duration-200 flex-shrink-0 ml-4 ${isOpen ? 'rotate-180' : ''}`} />
            </button>
            {renderSectionActions()}
        </div>
    );

    const renderSubsectionHeader = (
        title: string,
        isOpen: boolean,
        toggle: () => void
    ) => (
        <button
            type="button"
            onClick={toggle}
            className="w-full rounded-md border border-default bg-surface-elevated px-6 py-5 text-left transition-colors hover:border-primary/40"
        >
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-lg font-bold text-on-surface">{title}</h3>
                <Icon
                    name={IconName.ChevronDown}
                    className={`w-5 h-5 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </div>
        </button>
    );

    const renderIntegrationPanelHeader = (
        title: string,
        isOpen: boolean,
        toggle: () => void
    ) => (
        <button
            type="button"
            onClick={toggle}
            className={[
                'w-full border border-default bg-surface-elevated px-4 py-3 text-left transition-colors hover:border-primary/40',
                isOpen ? 'rounded-t-md rounded-b-none border-b-0' : 'rounded-md',
            ].join(' ')}
        >
            <div className="flex items-center justify-between gap-4">
                <h3 className="text-base font-bold text-on-surface">{title}</h3>
                <Icon
                    name={IconName.ChevronDown}
                    className={`w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                />
            </div>
        </button>
    );

    return (
        <>
            <Card className="overflow-visible p-8 dark:bg-gray-800 dark:border-gray-700">
                <div className="-mx-8 -mt-8 mb-6 border-b border-gray-700/60 bg-slate-800/95 px-8 pt-8 pb-6">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex min-w-0 flex-1 flex-col items-center gap-6 sm:flex-row sm:items-center">
                            <div className="flex-shrink-0 text-center">
                                <div className="relative group w-24 h-24">
                                    <img
                                        src={getImageUrl(formData.companyLogoUrl)}
                                        alt={formData.companyName}
                                        className="w-24 h-24 rounded-md object-cover ring-4 ring-blue-500/20"
                                    />
                                    {isEditing && (
                                        <>
                                            <input
                                                type="file"
                                                id="logo-upload"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={handleLogoChange}
                                            />
                                            <label
                                                htmlFor="logo-upload"
                                                className="absolute inset-0 bg-black/60 flex items-center justify-center text-white rounded-md cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <Icon name={IconName.Upload} className="w-8 h-8" />
                                            </label>
                                        </>
                                    )}
                                </div>
                            </div>

                            <div className="min-w-0 flex-1 text-center sm:text-left">
                                <h1 className="text-3xl font-bold text-on-surface dark:text-white">{formData.companyName}</h1>
                                <p className="text-subtle text-lg dark:text-gray-400">{formData.companyShortname}</p>
                            </div>
                        </div>

                        <div className="flex w-full justify-center sm:justify-end lg:w-auto lg:flex-shrink-0">
                            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                                {isEditing ? (
                                    <>
                                        <Button variant="ghost" onClick={handleCancelEdit}>
                                            Cancel
                                        </Button>
                                        <Button onClick={handleSave} disabled={isSaving}>
                                            {isSaving ? 'Saving...' : 'Save Changes'}
                                        </Button>
                                    </>
                                ) : (
                                    <Button className="w-full !text-white sm:w-auto" onClick={() => setIsEditing(true)}>
                                        <Icon name={IconName.Edit} className="w-4 h-4 mr-2" />
                                        Edit Company Setting
                                    </Button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {renderSectionHeader('Company Details', isCompanyOpen, () => setIsCompanyOpen(prev => !prev))}
                {isCompanyOpen && (isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Name</label>
                            <input type="text" name="companyName" value={formData.companyName} onChange={handleInputChange} placeholder="Company Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Short Name</label>
                            <input type="text" name="companyShortname" value={formData.companyShortname} onChange={handleInputChange} placeholder="Company Short Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">UEN</label>
                            <input type="text" name="uen" value={formData.uen} onChange={handleInputChange} placeholder="UEN" className={inputClasses} />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Address</label>
                            <input type="text" name="companyAddress" value={formData.companyAddress} onChange={handleInputChange} placeholder="Company Address" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Email</label>
                            <input type="email" name="companyEmail" value={formData.companyEmail} onChange={handleInputChange} placeholder="e.g. enquiry@company.com" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Tel</label>
                            <input type="tel" name="companyTel" value={formData.companyTel} onChange={handleInputChange} placeholder="e.g. +65 6123 4567" className={inputClasses} />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Company Website</label>
                            <input type="url" name="companyWebsite" value={formData.companyWebsite} onChange={handleInputChange} placeholder="e.g. https://www.company.com" className={inputClasses} />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                        <ProfileBioItem label="Company Name" value={formData.companyName} />
                        <ProfileBioItem label="Company Short Name" value={formData.companyShortname} />
                        <ProfileBioItem label="UEN" value={formData.uen} />
                        <div className="sm:col-span-2 lg:col-span-3">
                            <ProfileBioItem label="Company Address" value={formData.companyAddress} />
                        </div>
                        <ProfileBioItem label="Company Email" value={formData.companyEmail} />
                        <ProfileBioItem label="Company Tel" value={formData.companyTel} />
                        <ProfileBioItem label="Company Website" value={formData.companyWebsite} />
                    </div>
                ))}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Company Support Details', isContactOpen, () => setIsContactOpen(prev => !prev), 'text-xl font-bold')}
                {isContactOpen && (isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Support Name</label>
                            <input type="text" name="name" value={formData.contactPerson.name} onChange={handleContactChange} placeholder="Support Name" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Support Email</label>
                            <input type="email" name="email" value={formData.contactPerson.email} onChange={handleContactChange} placeholder="Support Email" className={inputClasses} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Support Telephone</label>
                            <input type="tel" name="tel" value={formData.contactPerson.tel} onChange={handleContactChange} placeholder="Support Telephone" className={inputClasses} />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mt-4">
                        <ProfileBioItem label="Support Name" value={formData.contactPerson.name} />
                        <ProfileBioItem label="Support Email" value={formData.contactPerson.email} />
                        <ProfileBioItem label="Support Telephone" value={formData.contactPerson.tel} />
                    </div>
                ))}

                <div className="border-t my-6"></div>
                {renderSectionHeader('SSG Funding', isSsgFundingOpen, () => setIsSsgFundingOpen(prev => !prev), 'text-xl font-bold')}
                {isSsgFundingOpen && (isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                                Normal Funding Rate
                            </label>
                            <select
                                name="normalFunding"
                                value={formData.fundingSettings.normalFunding}
                                onChange={handleFundingChange}
                                className={inputClasses}
                            >
                                <option value={50}>50%</option>
                                <option value={70}>70%</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                                Enhanced Funding Rate
                            </label>
                            <input
                                type="number"
                                name="enhancedFunding"
                                value={formData.fundingSettings.enhancedFunding}
                                onChange={handleFundingChange}
                                className={inputClasses}
                                min="0"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                        <ProfileBioItem
                            label="Normal Funding Rate"
                            value={`${formData.fundingSettings.normalFunding}%`}
                        />
                        <ProfileBioItem
                            label="Enhanced Funding Rate"
                            value={`${formData.fundingSettings.enhancedFunding}%`}
                        />
                    </div>
                ))}

                <div className="border-t my-6"></div>
                {renderSectionHeader('GST', isGstOpen, () => setIsGstOpen(prev => !prev), 'text-xl font-bold')}
                {isGstOpen && (isEditing ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                                GST Rate
                            </label>
                            <input
                                type="number"
                                step="0.1"
                                name="gstRate"
                                value={formData.fundingSettings.gstRate}
                                onChange={handleFundingChange}
                                className={inputClasses}
                                min="0"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                                GST Registration Number
                            </label>
                            <input
                                type="text"
                                name="gstRegistrationNumber"
                                value={formData.fundingSettings.gstRegistrationNumber || ''}
                                onChange={handleFundingChange}
                                className={inputClasses}
                                placeholder="e.g. 201509271W"
                            />
                        </div>

                        <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                            <label className="text-sm text-on-surface">GST Registered</label>
                            <button
                                type="button"
                                onClick={() => {
                                    const newValue = !formData.fundingSettings.isGstRegistered;
                                    setFormData((prev) => ({
                                        ...prev,
                                        fundingSettings: {
                                            ...prev.fundingSettings,
                                            isGstRegistered: newValue,
                                        },
                                    }));
                                }}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.fundingSettings.isGstRegistered ? 'bg-primary' : 'bg-gray-200'
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.fundingSettings.isGstRegistered ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-4">
                        <ProfileBioItem
                            label="GST Rate"
                            value={`${formData.fundingSettings.gstRate}%`}
                        />
                        <ProfileBioItem
                            label="GST Registration Number"
                            value={formData.fundingSettings.gstRegistrationNumber || '—'}
                        />
                        <ProfileBioItem
                            label="GST Registered"
                            value={formData.fundingSettings.isGstRegistered ? 'Yes' : 'No'}
                        />
                    </div>
                ))}


                <div className="border-t my-6"></div>
                {renderSectionHeader('Integrations', isIntegrationsOpen, () => setIsIntegrationsOpen(prev => !prev), 'text-xl font-bold')}
                {isIntegrationsOpen && <div className="space-y-6 font-semibold mt-4">

                    {/* ===== Virtual Meeting Subsection ===== */}
                    <div className="p-4 bg-surface-elevated rounded-lg border border-default">
                        <h3 className="text-lg font-bold text-on-surface mb-4">Virtual Meeting</h3>
                        <div className="p-3 bg-surface rounded-md border border-default">
                            <label className="block text-sm font-medium text-on-surface-secondary mb-3">Provider</label>
                            {(() => {
                                const selected = (formData.integrations as any).virtualMeetingProvider || 'google_meet';
                                const options: Array<{ value: 'google_meet' | 'zoom' | 'teams'; label: string; sub: string }> = [
                                    { value: 'google_meet', label: 'Google Meet', sub: 'Default' },
                                    { value: 'zoom', label: 'Zoom', sub: 'zoom.us' },
                                    { value: 'teams', label: 'Microsoft Teams', sub: 'teams.microsoft.com' },
                                ];
                                return (
                                    <div role="radiogroup" aria-label="Virtual meeting provider" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                        {options.map(opt => {
                                            const isSelected = selected === opt.value;
                                            return (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    role="radio"
                                                    aria-checked={isSelected}
                                                    onClick={() => {
                                                        if (!isEditing) setIsEditing(true);
                                                        if (opt.value === 'google_meet') {
                                                            setIsGoogleIntegrationOpen(true);
                                                            setIsZoomIntegrationOpen(false);
                                                        }
                                                        if (opt.value === 'zoom') {
                                                            setIsZoomIntegrationOpen(true);
                                                            setIsGoogleIntegrationOpen(false);
                                                        }
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            integrations: {
                                                                ...prev.integrations,
                                                                virtualMeetingProvider: opt.value,
                                                            },
                                                        }));
                                                    }}
                                                    className={[
                                                        'relative text-left p-4 rounded-lg border-2 transition-all',
                                                        isSelected
                                                            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                                                            : 'border-default bg-surface-elevated hover:border-primary/50',
                                                        'cursor-pointer',
                                                    ].join(' ')}
                                                >
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-on-surface'}`}>{opt.label}</p>
                                                            <p className="text-[11px] text-on-surface-secondary mt-0.5 truncate">{opt.sub}</p>
                                                        </div>
                                                        <span
                                                            className={[
                                                                'flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors',
                                                                isSelected ? 'border-primary bg-primary' : 'border-on-surface-secondary/40 bg-transparent',
                                                            ].join(' ')}
                                                            aria-hidden="true"
                                                        >
                                                            {isSelected && <span className="w-2 h-2 rounded-full bg-white" />}
                                                        </span>
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })()}
                            <p className="text-[10px] text-on-surface-secondary mt-3">
                                Determines the default conferencing provider used for new virtual meeting generation.
                            </p>
                            <p className="text-[10px] text-on-surface-secondary mt-1">
                                {isEditing ? 'Save changes to apply this default provider.' : 'Selecting a provider will enter edit mode. Configure Zoom OAuth credentials in the Zoom section below before generating Zoom meetings.'}
                            </p>
                        </div>
                    </div>

                    {/* ===== Google Subsection ===== */}
                    <div>
                    {renderIntegrationPanelHeader('Google', isGoogleIntegrationOpen, () => setIsGoogleIntegrationOpen(prev => !prev))}
                    {isGoogleIntegrationOpen && (
                    <div className="p-4 bg-surface-elevated rounded-b-md border border-t-0 border-default">
                        <div className="space-y-4">
                            {/* Gmail Configuration */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-on-surface pl-3">Gmail</h4>
                                <div className="p-3 bg-surface rounded-md border border-default ml-4">
                                    <h4 className="text-sm font-bold text-on-surface mb-3">Email Configuration (Google OAuth2)</h4>
                                    <div className="space-y-3">
                                    {[
                                        { key: 'emailUser', label: 'Email User', placeholder: 'e.g. sales@yourcompany.com', isSecret: false },
                                        { key: 'googleClientId', label: 'Google Client ID', placeholder: 'From Google Cloud Console', isSecret: false },
                                        { key: 'googleClientSecret', label: 'Google Client Secret', placeholder: 'From Google Cloud Console', isSecret: true, visible: isVisibleGoogleSecret, setVisible: setIsVisibleGoogleSecret },
                                        { key: 'googleRefreshToken', label: 'Google Refresh Token', placeholder: 'OAuth2 refresh token', isSecret: true, visible: isVisibleGoogleRefreshToken, setVisible: setIsVisibleGoogleRefreshToken, helpText: 'REQUIRED SCOPES: https://www.googleapis.com/auth/drive AND https://www.googleapis.com/auth/presentations AND https://www.googleapis.com/auth/calendar (separated by space)' },
                                    ].map(({ key, label, placeholder, helpText, isSecret, visible, setVisible }) => (
                                        <div key={key}>
                                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
                                            {isEditing ? (
                                                <>
                                                    <div className="relative">
                                                        <input
                                                            type={isSecret ? (visible ? 'text' : 'password') : 'text'}
                                                            value={(formData.integrations as any)[key] || ''}
                                                            onChange={(e) =>
                                                                setFormData((prev) => ({
                                                                    ...prev,
                                                                    integrations: {
                                                                        ...prev.integrations,
                                                                        [key]: e.target.value,
                                                                    },
                                                                }))
                                                            }
                                                            className={`${inputClasses} ${isSecret ? 'pr-10' : ''}`}
                                                            placeholder={placeholder}
                                                        />
                                                        {isSecret && setVisible && (
                                                            <button
                                                                type="button"
                                                                onClick={() => setVisible(!visible)}
                                                                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary p-1"
                                                            >
                                                                <Icon
                                                                    name={visible ? IconName.EyeOff : IconName.Eye}
                                                                    className="w-4 h-4"
                                                                />
                                                            </button>
                                                        )}
                                                    </div>
                                                    {helpText && <p className="text-[10px] text-primary mt-1 font-semibold">{helpText}</p>}
                                                </>
                                            ) : (
                                                <div className="flex items-center gap-2 group">
                                                    <p className="text-sm text-on-surface truncate flex-grow">
                                                        {isSecret
                                                            ? ((formData.integrations as any)[key] ? (visible ? (formData.integrations as any)[key] : '••••••••') : 'Not Set')
                                                            : ((formData.integrations as any)[key] || 'Not Set')}
                                                    </p>
                                                    {isSecret && setVisible && (formData.integrations as any)[key] && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setVisible(!visible)}
                                                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <Icon
                                                                name={visible ? IconName.EyeOff : IconName.Eye}
                                                                className="w-4 h-4"
                                                            />
                                                        </button>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    </div>
                                </div>
                            </div>

                            {/* Service Account Configuration */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-on-surface pl-3">Service Account</h4>
                                <div className="p-3 bg-surface rounded-md border border-default ml-4">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Service Account Key File</label>
                                            {isEditing ? (
                                                <>
                                                    <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                                        <span className="text-sm text-on-surface-secondary flex-grow">
                                                            {serviceAccountKeyFile ? serviceAccountKeyFile.name : (formData.integrations as any).googleServiceAccountJson?.split('/').pop() || 'No file uploaded'}
                                                        </span>
                                                        <Button variant="ghost" size="sm" onClick={() => document.getElementById('service-account-upload')?.click()}>
                                                            <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                                        </Button>
                                                        <input type="file" id="service-account-upload" accept=".json" className="hidden" onChange={(e) => handleTemplateUpload(e, 'serviceAccountKeyFile')} />
                                                    </div>
                                                    <p className="text-[10px] text-on-surface-secondary mt-1">
                                                        Google service account JSON file for bulk proforma invoice generation.
                                                    </p>
                                                </>
                                            ) : (
                                                <p className="text-sm text-on-surface truncate">
                                                    {(formData.integrations as any).googleServiceAccountJson?.split('/').pop() || 'Not Uploaded'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Google Sheet Configuration */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-on-surface pl-3">Google Sheet</h4>
                                <div className="p-3 bg-surface rounded-md border border-default ml-4">
                                    <div className="space-y-3">
                                        {[
                                            { key: 'masterListUrl' as const, label: 'Master List' },
                                            { key: 'tertiaryTmsUrl' as const, label: 'Tertiary TMS' },
                                            { key: 'tertiaryFmsUrl' as const, label: 'Tertiary FMS' },
                                            { key: 'tertiaryMmsUrl' as const, label: 'Tertiary MMS' },
                                            { key: 'tertiaryTpmsUrl' as const, label: 'Tertiary TPMS' },
                                        ].map(({ key, label }) => (
                                            <div key={key}>
                                                <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={formData.integrations[key] || ''}
                                                        onChange={(e) =>
                                                            setFormData((prev) => ({
                                                                ...prev,
                                                                integrations: {
                                                                    ...prev.integrations,
                                                                    [key]: e.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className={inputClasses}
                                                        placeholder={`${label} URL`}
                                                    />
                                                ) : (
                                                    <p className="text-sm text-on-surface truncate">
                                                        {formData.integrations[key] ? (
                                                            <a href={formData.integrations[key]} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                                                {formData.integrations[key]}
                                                            </a>
                                                        ) : 'Not Set'}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Google Drive Configuration */}
                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-on-surface pl-3">Google Drive</h4>
                                <div className="p-3 bg-surface rounded-md border border-default ml-4">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Trainre Profile Image Folder</label>
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={formData.integrations.trainerProfileImageUrl || ''}
                                                    onChange={(e) =>
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            integrations: {
                                                                ...prev.integrations,
                                                                trainerProfileImageUrl: e.target.value,
                                                            },
                                                        }))
                                                    }
                                                    className={inputClasses}
                                                    placeholder="Google Drive URL for trainer profile images"
                                                />
                                            ) : (
                                                <p className="text-sm text-on-surface truncate">
                                                    {formData.integrations.trainerProfileImageUrl || 'Not Set'}
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Certificate Folder</label>
                                            {isEditing ? (
                                                <input
                                                    type="text"
                                                    value={formData.integrations.certificateFolderUrl || ''}
                                                    onChange={(e) =>
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            integrations: {
                                                                ...prev.integrations,
                                                                certificateFolderUrl: e.target.value,
                                                            },
                                                        }))
                                                    }
                                                    className={inputClasses}
                                                    placeholder="Google Drive folder URL for storing certificates"
                                                />
                                            ) : (
                                                <p className="text-sm text-on-surface truncate">
                                                    {formData.integrations.certificateFolderUrl || 'Not Set'}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <ToggleSwitch
                                checked={formData.integrations.syncGoogleCalendar}
                                onChange={(checked) => handleToggleChange('integrations', 'syncGoogleCalendar')}
                                label="Calendar"
                                isEditing={isEditing}
                            />
                            {formData.integrations.syncGoogleCalendar && (
                                <div className="p-3 bg-surface rounded-md border border-default ml-4">
                                    <label className="block text-sm font-medium text-on-surface-secondary mb-1">
                                        Calendar Embed URL
                                    </label>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.integrations.googleCalendarUrl || ''}
                                            onChange={(e) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    integrations: {
                                                        ...prev.integrations,
                                                        googleCalendarUrl: e.target.value,
                                                    },
                                                }))
                                            }
                                            className={inputClasses}
                                            placeholder="Paste your calendar embed URL (Google Calendar, Outlook, etc.)"
                                        />
                                    ) : (
                                        <p className="text-sm text-on-surface truncate">
                                            {formData.integrations.googleCalendarUrl || 'Not Set'}
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    )}
                    </div>

                    {/* ===== Zoom Subsection ===== */}
                    <div>
                    {renderIntegrationPanelHeader('Zoom', isZoomIntegrationOpen, () => setIsZoomIntegrationOpen(prev => !prev))}
                    {isZoomIntegrationOpen && (
                    <div className="p-4 bg-surface-elevated rounded-b-md border border-t-0 border-default">
                        <div className="p-3 bg-surface rounded-md border border-default">
                            <div className="space-y-3">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface-secondary mb-1">Zoom OAuth App Client ID</label>
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={(formData.integrations as any).zoomClientId || ''}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        integrations: {
                                                            ...prev.integrations,
                                                            zoomClientId: e.target.value,
                                                        },
                                                    }))
                                                }
                                                className={inputClasses}
                                                placeholder="Zoom OAuth app client ID"
                                            />
                                        ) : (
                                            <p className="text-sm text-on-surface truncate">{(formData.integrations as any).zoomClientId || 'Not Set'}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface-secondary mb-1">Zoom OAuth App Client Secret</label>
                                        {isEditing ? (
                                            <input
                                                type="password"
                                                value={(formData.integrations as any).zoomClientSecret || ''}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        integrations: {
                                                            ...prev.integrations,
                                                            zoomClientSecret: e.target.value,
                                                        },
                                                    }))
                                                }
                                                className={inputClasses}
                                                placeholder="Zoom OAuth app client secret"
                                            />
                                        ) : (
                                            <p className="text-sm text-on-surface">{(formData.integrations as any).zoomClientSecret ? 'Configured' : 'Not Set'}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className={`text-xs font-semibold px-2 py-1 rounded ${zoomStatus.connected ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                                        {zoomStatus.connected ? `Connected${zoomStatus.userEmail ? `: ${zoomStatus.userEmail}` : ''}` : 'Not connected'}
                                    </span>
                                    <Button size="sm" variant="secondary" onClick={handleConnectZoom} disabled={isEditing || zoomBusy || !hasZoomCredentialsInForm}>
                                        {zoomConnectButtonLabel}
                                    </Button>
                                    <Button size="sm" variant="secondary" onClick={handleTestZoom} disabled={isEditing || zoomBusy || !zoomStatus.connected}>
                                        Test
                                    </Button>
                                    <Button size="sm" variant="danger" onClick={handleDisconnectZoom} disabled={isEditing || zoomBusy || !zoomStatus.connected}>
                                        Disconnect
                                    </Button>
                                </div>
                                {isEditing ? (
                                    <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-700/70 dark:bg-amber-900/20 dark:text-amber-200">
                                        Save the Zoom OAuth App Client ID and Secret before connecting. The Connect Zoom button will unlock after the credentials are saved.
                                    </div>
                                ) : (
                                    <p className="text-[10px] text-on-surface-secondary">
                                        Click Connect Zoom to authorize the Zoom account after the saved credentials are configured.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                    )}
                    </div>

                            {/* Nemo OpenClaw Configuration */}
                    <div>
                    {renderIntegrationPanelHeader('Nemo OpenClaw', isOpenClawIntegrationOpen, () => setIsOpenClawIntegrationOpen(prev => !prev))}
                    {isOpenClawIntegrationOpen && (
                            <div className="p-4 bg-surface-elevated rounded-b-md border border-t-0 border-default">
                                <div className="p-3 bg-surface rounded-md border border-default">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-on-surface-secondary mb-1">Mode</label>
                                            {isEditing ? (
                                                <select
                                                    value={formData.integrations.openClawMode || 'live'}
                                                    onChange={(e) =>
                                                        setFormData((prev) => ({
                                                            ...prev,
                                                            integrations: {
                                                                ...prev.integrations,
                                                                openClawMode: e.target.value as 'live' | 'local',
                                                            },
                                                        }))
                                                    }
                                                    className={inputClasses}
                                                >
                                                    <option value="live">Remote Live Mode</option>
                                                    <option value="local">Local Test Mode</option>
                                                </select>
                                            ) : (
                                                <p className="text-sm text-on-surface">
                                                    {formData.integrations.openClawMode === 'local' ? 'Local Test Mode' : 'Remote Live Mode'}
                                                </p>
                                            )}
                                        </div>
                                        {[
                                            { key: 'openClawGatewayUrl' as const, label: 'Live Gateway URL', placeholder: 'e.g. http://10.0.0.1:18789' },
                                            { key: 'openClawLocalGatewayUrl' as const, label: 'Local Testing URL', placeholder: 'e.g. http://76.13.180.29:18789' },
                                            { key: 'openClawHooksPath' as const, label: 'Hooks Path', placeholder: 'e.g. /hooks' },
                                            { key: 'openClawAgentId' as const, label: 'Agent ID', placeholder: 'e.g. main' },
                                            { key: 'openClawCallbackUrl' as const, label: 'Callback URL', placeholder: 'e.g. https://your-app.example.com/api/openclaw/callback' },
                                        ].map(({ key, label, placeholder }) => (
                                            <div key={key}>
                                                <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={(formData.integrations as any)[key] || ''}
                                                        onChange={(e) =>
                                                            setFormData((prev) => ({
                                                                ...prev,
                                                                integrations: {
                                                                    ...prev.integrations,
                                                                    [key]: e.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className={inputClasses}
                                                        placeholder={placeholder}
                                                    />
                                                ) : (
                                                    <p className="text-sm text-on-surface truncate">
                                                        {(formData.integrations as any)[key] ? (
                                                            <a href={(formData.integrations as any)[key]} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
                                                                {(formData.integrations as any)[key]}
                                                            </a>
                                                        ) : 'Not Set'}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                    )}
                    </div>

                            {/* Magento Configuration */}
                    <div>
                    {renderIntegrationPanelHeader('Magento', isMagentoIntegrationOpen, () => setIsMagentoIntegrationOpen(prev => !prev))}
                    {isMagentoIntegrationOpen && (
                            <div className="p-4 bg-surface-elevated rounded-b-md border border-t-0 border-default">
                                <div className="p-3 bg-surface rounded-md border border-default">
                                    <div>
                                        <label className="block text-sm font-medium text-on-surface-secondary mb-1">Magento Backend URL</label>
                                        {isEditing ? (
                                            <input
                                                type="text"
                                                value={(formData.integrations as any).magentoBackendUrl || ''}
                                                onChange={(e) =>
                                                    setFormData((prev) => ({
                                                        ...prev,
                                                        integrations: {
                                                            ...prev.integrations,
                                                            magentoBackendUrl: e.target.value,
                                                        },
                                                    }))
                                                }
                                                className={inputClasses}
                                                placeholder="e.g. https://magento.example.com/admin"
                                            />
                                        ) : (
                                            <p className="text-sm text-on-surface truncate">
                                                {(formData.integrations as any).magentoBackendUrl || 'Not Set'}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                    )}
                    </div>

                            {/* n8n Configuration */}
                    <div>
                    {renderIntegrationPanelHeader('n8n', isN8nIntegrationOpen, () => setIsN8nIntegrationOpen(prev => !prev))}
                    {isN8nIntegrationOpen && (
                            <div className="p-4 bg-surface-elevated rounded-b-md border border-t-0 border-default">
                                <div className="p-3 bg-surface rounded-md border border-default">
                                    <div className="space-y-3">
                                        {[
                                            { key: 'n8nHost1Url' as const, label: 'Host 1 URL', placeholder: 'e.g. https://n8n-host1.example.com' },
                                            { key: 'n8nHost2Url' as const, label: 'Host 2 URL', placeholder: 'e.g. https://n8n-host2.example.com' },
                                        ].map(({ key, label, placeholder }) => (
                                            <div key={key}>
                                                <label className="block text-sm font-medium text-on-surface-secondary mb-1">{label}</label>
                                                {isEditing ? (
                                                    <input
                                                        type="text"
                                                        value={(formData.integrations as any)[key] || ''}
                                                        onChange={(e) =>
                                                            setFormData((prev) => ({
                                                                ...prev,
                                                                integrations: {
                                                                    ...prev.integrations,
                                                                    [key]: e.target.value,
                                                                },
                                                            }))
                                                        }
                                                        className={inputClasses}
                                                        placeholder={placeholder}
                                                    />
                                                ) : (
                                                    <p className="text-sm text-on-surface truncate">
                                                        {(formData.integrations as any)[key] || 'Not Set'}
                                                    </p>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                    )}
                    </div>

                </div>}

                <div className="border-t my-6"></div>

                {renderSectionHeader('Document Templates', isDocTemplatesOpen, () => setIsDocTemplatesOpen(prev => !prev), 'text-xl font-bold')}
                {isDocTemplatesOpen && <div className="space-y-4 mt-4">
                    {/* Proforma Invoice Template ID */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Proforma Invoice Template ID</label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.proFormaInvoiceTemplateUrl || ''}
                                onChange={(e) => setFormData((prev) => ({ ...prev, proFormaInvoiceTemplateUrl: e.target.value }))}
                                className={inputClasses}
                                placeholder="Google Docs URL or template ID"
                            />
                        ) : (
                            <p className="text-sm text-on-surface truncate">{formData.proFormaInvoiceTemplateUrl || 'Not Set'}</p>
                        )}
                    </div>

                    {/* Invoice Template ID */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Invoice Template ID</label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.invoiceTemplateUrl || ''}
                                onChange={(e) => setFormData((prev) => ({ ...prev, invoiceTemplateUrl: e.target.value }))}
                                className={inputClasses}
                                placeholder="Google Docs URL or template ID"
                            />
                        ) : (
                            <p className="text-sm text-on-surface truncate">{formData.invoiceTemplateUrl || 'Not Set'}</p>
                        )}
                    </div>

                    {/* Receipt Template ID */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Receipt Template ID</label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.receiptTemplateUrl || ''}
                                onChange={(e) => setFormData((prev) => ({ ...prev, receiptTemplateUrl: e.target.value }))}
                                className={inputClasses}
                                placeholder="Google Docs URL or template ID"
                            />
                        ) : (
                            <p className="text-sm text-on-surface truncate">{formData.receiptTemplateUrl || 'Not Set'}</p>
                        )}
                    </div>

                    {/* Certificate Template ID */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Certificate Template ID</label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.integrations.googleSlidesTemplateId || ''}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        integrations: {
                                            ...prev.integrations,
                                            googleSlidesTemplateId: e.target.value,
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="Google Slides template ID for certificates"
                            />
                        ) : (
                            <p className="text-sm text-on-surface truncate">
                                {formData.integrations.googleSlidesTemplateId || 'Not Set'}
                            </p>
                        )}
                    </div>
                </div>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Admin Setting', isAdminSettingsOpen, () => setIsAdminSettingsOpen(prev => !prev), 'text-xl font-bold')}
                {isAdminSettingsOpen && <div className="space-y-4 font-semibold mt-4">
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Upcoming Classes Threshold (Days)
                        </label>
                        {isEditing ? (
                            <input
                                type="number"
                                min={1}
                                max={365}
                                value={formData.adminSettings.upcomingClassesThresholdDays ?? 21}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            upcomingClassesThresholdDays: Math.max(1, parseInt(e.target.value || '21', 10) || 21),
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="21"
                            />
                        ) : (
                            <p className="text-sm text-on-surface">
                                {(formData.adminSettings.upcomingClassesThresholdDays ?? 21)} days
                            </p>
                        )}
                    </div>
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Certificate Attendance Threshold (%)
                        </label>
                        {isEditing ? (
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={formData.adminSettings.certificateAttendanceThreshold ?? 60}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            certificateAttendanceThreshold: Math.min(100, Math.max(1, parseInt(e.target.value || '60', 10) || 60)),
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="60"
                            />
                        ) : (
                            <p className="text-sm text-on-surface">
                                {(formData.adminSettings.certificateAttendanceThreshold ?? 60)}%
                            </p>
                        )}
                    </div>
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            CAS Threshold (%)
                        </label>
                        {isEditing ? (
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={formData.adminSettings.casThreshold ?? 70}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            casThreshold: Math.min(100, Math.max(0, parseInt(e.target.value || '70', 10) || 70)),
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="70"
                            />
                        ) : (
                            <p className="text-sm text-on-surface">
                                {(formData.adminSettings.casThreshold ?? 70)}%
                            </p>
                        )}
                    </div>
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            ES Threshold (%)
                        </label>
                        {isEditing ? (
                            <input
                                type="number"
                                min={0}
                                max={100}
                                value={formData.adminSettings.esThreshold ?? 40}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            esThreshold: Math.min(100, Math.max(0, parseInt(e.target.value || '40', 10) || 40)),
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="40"
                            />
                        ) : (
                            <p className="text-sm text-on-surface">
                                {(formData.adminSettings.esThreshold ?? 40)}%
                            </p>
                        )}
                    </div>
                    {Object.entries(adminSettingLabels).map(([key, label]) => (
                        <ToggleSwitch
                            key={key}
                            checked={!!formData.adminSettings[key as keyof typeof formData.adminSettings]}
                            onChange={(checked) => handleToggleChange('adminSettings', key)}
                            label={label}
                            isEditing={true}
                        />
                    ))}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Certificate Delivery Label
                        </label>
                        <p className="text-xs text-on-surface-secondary mb-2 font-normal">
                            Title shown on the Certificate Delivery card on the course page (when enabled above).
                        </p>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.adminSettings.certificateDeliveryLabel ?? 'TP Course Evaluation'}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            certificateDeliveryLabel: e.target.value,
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="TP Course Evaluation"
                            />
                        ) : (
                            <p className="text-sm text-on-surface">
                                {formData.adminSettings.certificateDeliveryLabel ?? 'TP Course Evaluation'}
                            </p>
                        )}
                    </div>
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Certificate Delivery Link
                        </label>
                        <p className="text-xs text-on-surface-secondary mb-2 font-normal">
                            URL for the Certificate Delivery survey/form. A QR code will be auto-generated from this link on the course page.
                        </p>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.adminSettings.certificateDeliveryLink ?? 'https://goo.gl/R2eumq'}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        adminSettings: {
                                            ...prev.adminSettings,
                                            certificateDeliveryLink: e.target.value,
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="https://goo.gl/R2eumq"
                            />
                        ) : (
                            <p className="text-sm text-on-surface break-all">
                                {formData.adminSettings.certificateDeliveryLink ?? 'https://goo.gl/R2eumq'}
                            </p>
                        )}
                    </div>
                </div>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Payroll', isPayrollOpen, () => setIsPayrollOpen(prev => !prev), 'text-xl font-bold')}
                {isPayrollOpen && <div className="mt-4">
                    <PayrollSettingsView />
                </div>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Security Setting', isSecurityOpen, () => setIsSecurityOpen(prev => !prev), 'text-xl font-bold')}
                {isSecurityOpen && <div className="space-y-4 mt-4">
                    {/* Auto Sanitise Data */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <div className="flex justify-between items-center">
                            <p className="font-semibold text-sm text-on-surface">Auto Sanitise Data</p>
                            {isEditing ? (
                                <button
                                    type="button"
                                    onClick={() => handleToggleChange('securitySettings', 'autoMaskSensitiveData')}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.securitySettings.autoMaskSensitiveData ? 'bg-primary' : 'bg-gray-200'
                                        }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.securitySettings.autoMaskSensitiveData ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                    />
                                </button>
                            ) : (
                                <span
                                    className={`text-sm font-medium ${formData.securitySettings.autoMaskSensitiveData ? 'text-green-600' : 'text-gray-400'
                                        }`}
                                >
                                    {formData.securitySettings.autoMaskSensitiveData ? 'Enabled' : 'Disabled'}
                                </span>
                            )}
                        </div>

                        {/* Retention months input */}
                        <div className="mt-3 flex items-center gap-3">
                            <label className="text-xs font-medium text-on-surface-secondary whitespace-nowrap">
                                Sanitise data older than
                            </label>
                            {isEditing ? (
                                <input
                                    type="number"
                                    min={1}
                                    max={60}
                                    value={formData.securitySettings.sanitiseAfterMonths ?? 6}
                                    onChange={(e) => {
                                        const v = Math.max(1, Math.min(60, parseInt(e.target.value || '6', 10) || 6));
                                        setFormData(prev => ({
                                            ...prev,
                                            securitySettings: { ...prev.securitySettings, sanitiseAfterMonths: v },
                                        }));
                                    }}
                                    className="w-20 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1 text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            ) : (
                                <span className="text-sm font-semibold text-on-surface tabular-nums">
                                    {formData.securitySettings.sanitiseAfterMonths ?? 6}
                                </span>
                            )}
                            <span className="text-xs font-medium text-on-surface-secondary">months</span>
                        </div>
                        <p className="mt-2 text-xs text-on-surface-secondary leading-snug">
                            When enabled, NRIC and phone digits are redacted in place on rows older than this window
                            (e.g. <code className="font-mono">S1808997A → Sxxxx997A</code>, <code className="font-mono">96983371 → 9xxxx371</code>).
                            Runs every Sunday 02:00 SGT — adjust the schedule from Task Scheduler.
                        </p>
                    </div>


                    {/* Enable OTP Login */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <p className="font-semibold text-sm text-on-surface">Enable OTP Login</p>
                        {isEditing ? (
                            <button
                                type="button"
                                onClick={() => handleToggleChange('securitySettings', 'enableOtpLogin')}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.securitySettings.enableOtpLogin ? 'bg-primary' : 'bg-gray-200'
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.securitySettings.enableOtpLogin ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        ) : (
                            <span
                                className={`text-sm font-medium ${formData.securitySettings.enableOtpLogin ? 'text-green-600' : 'text-gray-400'
                                    }`}
                            >
                                {formData.securitySettings.enableOtpLogin ? 'Enabled' : 'Disabled'}
                            </span>
                        )}
                    </div>

                    {/* Set Default OTP (only if OTP login enabled) */}
                    {formData.securitySettings.enableOtpLogin && (
                        <>
                            <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                                <p className="font-semibold text-sm text-on-surface">Set Default OTP</p>
                                {isEditing ? (
                                    <button
                                        type="button"
                                        onClick={() => handleToggleChange('securitySettings', 'enableDefaultOtp')}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.securitySettings.enableDefaultOtp ? 'bg-primary' : 'bg-gray-200'
                                            }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.securitySettings.enableDefaultOtp ? 'translate-x-6' : 'translate-x-1'
                                                }`}
                                        />
                                    </button>
                                ) : (
                                    <span
                                        className={`text-sm font-medium ${formData.securitySettings.enableDefaultOtp ? 'text-green-600' : 'text-gray-400'
                                            }`}
                                    >
                                        {formData.securitySettings.enableDefaultOtp ? 'Enabled' : 'Disabled'}
                                    </span>
                                )}
                            </div>

                            {/* Default OTP Value (only if both OTP and default OTP enabled) */}
                            {formData.securitySettings.enableDefaultOtp && (
                                <div className="p-3 bg-surface-elevated rounded-md border border-default">
                                    <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                                        Default OTP Value
                                    </label>
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={formData.securitySettings.defaultOtpValue || ''}
                                            onChange={(e) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    securitySettings: {
                                                        ...prev.securitySettings,
                                                        defaultOtpValue: e.target.value,
                                                    },
                                                }))
                                            }
                                            className={inputClasses}
                                            placeholder="Enter default OTP (e.g. 12345)"
                                        />
                                    ) : (
                                        <p className="font-mono text-sm">
                                            {formData.securitySettings.defaultOtpValue || 'Not Set'}
                                        </p>
                                    )}
                                </div>
                            )}
                        </>
                    )}

                    {/* Forced First Time Password Change */}
                    <div className="flex justify-between items-center p-3 bg-surface-elevated rounded-md border border-default">
                        <p className="font-semibold text-sm text-on-surface">Forced First Time Password Change</p>
                        {isEditing ? (
                            <button
                                type="button"
                                onClick={() => handleToggleChange('securitySettings', 'forceFirstPasswordChange')}
                                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${formData.securitySettings.forceFirstPasswordChange ? 'bg-primary' : 'bg-gray-200'
                                    }`}
                            >
                                <span
                                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${formData.securitySettings.forceFirstPasswordChange ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                />
                            </button>
                        ) : (
                            <span
                                className={`text-sm font-medium ${formData.securitySettings.forceFirstPasswordChange ? 'text-green-600' : 'text-gray-400'
                                    }`}
                            >
                                {formData.securitySettings.forceFirstPasswordChange ? 'Enabled' : 'Disabled'}
                            </span>
                        )}
                    </div>

                    {/* Default Password */}
                    <div className="p-3 bg-surface-elevated rounded-md border border-default">
                        <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">
                            Set Default Password
                        </label>
                        {isEditing ? (
                            <input
                                type="text"
                                value={formData.securitySettings.defaultPassword || ''}
                                onChange={(e) =>
                                    setFormData((prev) => ({
                                        ...prev,
                                        securitySettings: {
                                            ...prev.securitySettings,
                                            defaultPassword: e.target.value,
                                        },
                                    }))
                                }
                                className={inputClasses}
                                placeholder="Enter default password (e.g. password123)"
                            />
                        ) : (
                            <p className="font-mono text-sm">
                                {formData.securitySettings.defaultPassword || 'Not Set'}
                            </p>
                        )}
                    </div>
                </div>}


                <div className="border-t my-6"></div>

                {renderSectionHeader('SSG Authentication Setting', isSsgOpen, () => setIsSsgOpen(prev => !prev), 'text-xl font-bold')}
                {isSsgOpen && <div className="space-y-4 mt-2">

                    {/* App count + per-app name editor (edit mode only) */}
                    {isEditing && (
                        <div className="rounded-md border border-default bg-surface-elevated p-4 space-y-3">
                            <div>
                                <label htmlFor="ssgAppCount" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Number of SSG Apps</label>
                                <select
                                    id="ssgAppCount"
                                    value={ssgAppCount}
                                    onChange={(e) => setFormData(prev => ({ ...prev, ssgAppCount: parseInt(e.target.value, 10) }))}
                                    className={inputClasses}
                                >
                                    {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
                                </select>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                {(['app1', 'app2', 'app3', 'app4'] as const).slice(0, ssgAppCount).map(key => (
                                    <div key={key}>
                                        <label htmlFor={`ssgAppName-${key}`} className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">App {key.replace('app', '')} Name</label>
                                        <input
                                            type="text"
                                            id={`ssgAppName-${key}`}
                                            value={formData.ssgAppNames?.[key] || ''}
                                            onChange={(e) => setFormData(prev => ({ ...prev, ssgAppNames: { ...(prev.ssgAppNames || {}), [key]: e.target.value } }))}
                                            className={inputClasses}
                                            placeholder={`App ${key.replace('app', '')} name`}
                                        />
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* App 1 */}
                    {ssgAppCount >= 1 && renderSsgAppHeader(getSsgAppLabel('app1'), 'app1', isSsgApp1Open, () => setIsSsgApp1Open(prev => !prev))}
                    {isSsgApp1Open && (isEditing ? (
                        <div className="space-y-4 ml-4">
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Self Signing Cert File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgApp1CertFile ? getCleanDisplayName(ssgApp1CertFile.name) : formData.ssgApp1CertFile?.split('/').pop() ? getCleanDisplayName(formData.ssgApp1CertFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-app1-cert-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-app1-cert-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgApp1CertFile')} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Private Key File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgApp1PrivateKeyFile ? getCleanDisplayName(ssgApp1PrivateKeyFile.name) : formData.ssgApp1PrivateKeyFile?.split('/').pop() ? getCleanDisplayName(formData.ssgApp1PrivateKeyFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-app1-key-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-app1-key-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgApp1PrivateKeyFile')} />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="ssgApp1EncryptionKey" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Encryption Key</label>
                                <div className="relative">
                                    <input type={isApp1EncryptionKeyVisible ? "text" : "password"} id="ssgApp1EncryptionKey" value={formData.ssgApp1EncryptionKey || ''} onChange={(e) => setFormData((prev) => ({ ...prev, ssgApp1EncryptionKey: e.target.value }))} className={`${inputClasses} pr-10`} placeholder="Enter your encryption key" />
                                    <button type="button" onClick={() => setIsApp1EncryptionKeyVisible(!isApp1EncryptionKeyVisible)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary">
                                        <Icon name={isApp1EncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {renderDefaultRadio('app1')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 ml-4">
                            <ProfileBioItem label="Self Signing Cert File" value={formData.ssgApp1CertFile ? getCleanDisplayName(formData.ssgApp1CertFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Private Key File" value={formData.ssgApp1PrivateKeyFile ? getCleanDisplayName(formData.ssgApp1PrivateKeyFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Encryption Key" value={
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-on-surface break-words">{formData.ssgApp1EncryptionKey ? (isApp1EncryptionKeyVisible ? formData.ssgApp1EncryptionKey : '••••••••••••••••') : 'Not Set'}</span>
                                    {formData.ssgApp1EncryptionKey && (<button type="button" onClick={() => setIsApp1EncryptionKeyVisible(!isApp1EncryptionKeyVisible)} className="text-subtle hover:text-primary p-1 rounded-full"><Icon name={isApp1EncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" /></button>)}
                                </div>
                            } />
                            {renderDefaultRadio('app1')}
                        </div>
                    ))}

                    {/* App 2 */}
                    {ssgAppCount >= 2 && renderSsgAppHeader(getSsgAppLabel('app2'), 'app2', isSsgApp2Open, () => setIsSsgApp2Open(prev => !prev))}
                    {ssgAppCount >= 2 && isSsgApp2Open && (isEditing ? (
                        <div className="space-y-4 ml-4">
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Self Signing Cert File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgCertFile ? getCleanDisplayName(ssgCertFile.name) : formData.ssgCertFile?.split('/').pop() ? getCleanDisplayName(formData.ssgCertFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-cert-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-cert-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgCertFile')} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Private Key File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgPrivateKeyFile ? getCleanDisplayName(ssgPrivateKeyFile.name) : formData.ssgPrivateKeyFile?.split('/').pop() ? getCleanDisplayName(formData.ssgPrivateKeyFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-privatekey-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-privatekey-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgPrivateKeyFile')} />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="ssgEncryptionKey" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Encryption Key</label>
                                <div className="relative">
                                    <input type={isEncryptionKeyVisible ? "text" : "password"} id="ssgEncryptionKey" value={formData.ssgEncryptionKey || ''} onChange={(e) => setFormData((prev) => ({ ...prev, ssgEncryptionKey: e.target.value }))} className={`${inputClasses} pr-10`} placeholder="Enter your encryption key" />
                                    <button type="button" onClick={() => setIsEncryptionKeyVisible(!isEncryptionKeyVisible)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary">
                                        <Icon name={isEncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {renderDefaultRadio('app2')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 ml-4">
                            <ProfileBioItem label="Self Signing Cert File" value={formData.ssgCertFile ? getCleanDisplayName(formData.ssgCertFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Private Key File" value={formData.ssgPrivateKeyFile ? getCleanDisplayName(formData.ssgPrivateKeyFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Encryption Key" value={
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-on-surface break-words">{formData.ssgEncryptionKey ? (isEncryptionKeyVisible ? formData.ssgEncryptionKey : '••••••••••••••••') : 'Not Set'}</span>
                                    {formData.ssgEncryptionKey && (<button type="button" onClick={() => setIsEncryptionKeyVisible(!isEncryptionKeyVisible)} className="text-subtle hover:text-primary p-1 rounded-full"><Icon name={isEncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" /></button>)}
                                </div>
                            } />
                            {renderDefaultRadio('app2')}
                        </div>
                    ))}

                    {/* App 3 */}
                    {ssgAppCount >= 3 && renderSsgAppHeader(getSsgAppLabel('app3'), 'app3', isSsgApp3Open, () => setIsSsgApp3Open(prev => !prev))}
                    {ssgAppCount >= 3 && isSsgApp3Open && (isEditing ? (
                        <div className="space-y-4 ml-4">
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Self Signing Cert File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgApp3CertFile ? getCleanDisplayName(ssgApp3CertFile.name) : formData.ssgApp3CertFile?.split('/').pop() ? getCleanDisplayName(formData.ssgApp3CertFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-app3-cert-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-app3-cert-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgApp3CertFile')} />
                                </div>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Private Key File</label>
                                <div className="flex items-center gap-2 p-2 bg-surface-elevated rounded-md border border-default">
                                    <span className="text-sm text-on-surface-secondary flex-grow">
                                        {ssgApp3PrivateKeyFile ? getCleanDisplayName(ssgApp3PrivateKeyFile.name) : formData.ssgApp3PrivateKeyFile?.split('/').pop() ? getCleanDisplayName(formData.ssgApp3PrivateKeyFile.split('/').pop() || '') : 'No file uploaded'}
                                    </span>
                                    <Button variant="ghost" size="sm" onClick={() => document.getElementById('ssg-app3-key-upload')?.click()}>
                                        <Icon name={IconName.Upload} className="w-4 h-4 mr-2" />Upload
                                    </Button>
                                    <input type="file" id="ssg-app3-key-upload" accept="*/*" className="hidden" onChange={(e) => handleTemplateUpload(e, 'ssgApp3PrivateKeyFile')} />
                                </div>
                            </div>
                            <div>
                                <label htmlFor="ssgApp3EncryptionKey" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Encryption Key</label>
                                <div className="relative">
                                    <input type={isApp3EncryptionKeyVisible ? "text" : "password"} id="ssgApp3EncryptionKey" value={formData.ssgApp3EncryptionKey || ''} onChange={(e) => setFormData((prev) => ({ ...prev, ssgApp3EncryptionKey: e.target.value }))} className={`${inputClasses} pr-10`} placeholder="Enter your encryption key" />
                                    <button type="button" onClick={() => setIsApp3EncryptionKeyVisible(!isApp3EncryptionKeyVisible)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary">
                                        <Icon name={isApp3EncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {renderDefaultRadio('app3')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 ml-4">
                            <ProfileBioItem label="Self Signing Cert File" value={formData.ssgApp3CertFile ? getCleanDisplayName(formData.ssgApp3CertFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Private Key File" value={formData.ssgApp3PrivateKeyFile ? getCleanDisplayName(formData.ssgApp3PrivateKeyFile.split('/').pop() || '') : 'Not Uploaded'} />
                            <ProfileBioItem label="Encryption Key" value={
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-on-surface break-words">{formData.ssgApp3EncryptionKey ? (isApp3EncryptionKeyVisible ? formData.ssgApp3EncryptionKey : '••••••••••••••••') : 'Not Set'}</span>
                                    {formData.ssgApp3EncryptionKey && (<button type="button" onClick={() => setIsApp3EncryptionKeyVisible(!isApp3EncryptionKeyVisible)} className="text-subtle hover:text-primary p-1 rounded-full"><Icon name={isApp3EncryptionKeyVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" /></button>)}
                                </div>
                            } />
                            {renderDefaultRadio('app3')}
                        </div>
                    ))}

                    {/* App 4 */}
                    {ssgAppCount >= 4 && renderSsgAppHeader(getSsgAppLabel('app4'), 'app4', isSsgApp4Open, () => setIsSsgApp4Open(prev => !prev))}
                    {ssgAppCount >= 4 && isSsgApp4Open && (isEditing ? (
                        <div className="space-y-4 ml-4">
                            <div>
                                <label htmlFor="ssgApp4ClientId" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Client ID</label>
                                <input type="text" id="ssgApp4ClientId" value={formData.ssgApp4ClientId || ''} onChange={(e) => setFormData((prev) => ({ ...prev, ssgApp4ClientId: e.target.value }))} className={inputClasses} placeholder="Enter Client ID" />
                            </div>
                            <div>
                                <label htmlFor="ssgApp4ClientSecret" className="block text-sm font-medium text-on-surface-secondary mb-1 font-semibold">Client Secret</label>
                                <div className="relative">
                                    <input type={isApp4ClientSecretVisible ? "text" : "password"} id="ssgApp4ClientSecret" value={formData.ssgApp4ClientSecret || ''} onChange={(e) => setFormData((prev) => ({ ...prev, ssgApp4ClientSecret: e.target.value }))} className={`${inputClasses} pr-10`} placeholder="Enter Client Secret" />
                                    <button type="button" onClick={() => setIsApp4ClientSecretVisible(!isApp4ClientSecretVisible)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-subtle hover:text-primary">
                                        <Icon name={isApp4ClientSecretVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                            {renderDefaultRadio('app4')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 ml-4">
                            <ProfileBioItem label="Client ID" value={formData.ssgApp4ClientId || 'Not Set'} />
                            <ProfileBioItem label="Client Secret" value={
                                <div className="flex items-center gap-2">
                                    <span className="font-semibold text-on-surface break-words">{formData.ssgApp4ClientSecret ? (isApp4ClientSecretVisible ? formData.ssgApp4ClientSecret : '••••••••••••••••') : 'Not Set'}</span>
                                    {formData.ssgApp4ClientSecret && (<button type="button" onClick={() => setIsApp4ClientSecretVisible(!isApp4ClientSecretVisible)} className="text-subtle hover:text-primary p-1 rounded-full"><Icon name={isApp4ClientSecretVisible ? IconName.EyeOff : IconName.Eye} className="w-4 h-4" /></button>)}
                                </div>
                            } />
                            {renderDefaultRadio('app4')}
                        </div>
                    ))}

                </div>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Credentials', isApiKeysOpen, () => setIsApiKeysOpen(prev => !prev), 'text-xl font-bold')}
                {isApiKeysOpen && <><div className="space-y-4 mt-4">
                    <div className="space-y-4">
                        {renderSubsectionHeader('LLM', isLlmCredentialsOpen, () => setIsLlmCredentialsOpen(prev => !prev))}
                        {isLlmCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5">
                                {renderCredentialInputs(LLM_API_KEY_NAMES)}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        {renderSubsectionHeader('OpenClaw', isOpenClawCredentialsOpen, () => setIsOpenClawCredentialsOpen(prev => !prev))}
                        {isOpenClawCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5">
                                {renderCredentialInputs(OPENCLAW_API_KEY_NAMES)}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        {renderSubsectionHeader('n8n', isN8nCredentialsOpen, () => setIsN8nCredentialsOpen(prev => !prev))}
                        {isN8nCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5">
                                {renderCredentialInputs(N8N_API_KEY_NAMES)}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        {renderSubsectionHeader('Firecrawl', isFirecrawlCredentialsOpen, () => setIsFirecrawlCredentialsOpen(prev => !prev))}
                        {isFirecrawlCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5">
                                {renderCredentialInputs(FIRECRAWL_API_KEY_NAMES)}
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        {renderSubsectionHeader('Bizfile', isBizfileCredentialsOpen, () => setIsBizfileCredentialsOpen(prev => !prev))}
                        {isBizfileCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {BIZFILE_API_KEY_NAMES.map((keyName) => {
                                        const keyValue = (formData.apiKeys || {})[keyName] || '';
                                        const isVisible = visibleApiKeys[keyName];
                                        const config = API_KEY_CONFIGS[keyName];
                                        return (
                                            <div key={keyName}>
                                                <label className="block text-xs font-medium text-muted mb-1">{config?.label || keyName}</label>
                                                <div className="flex items-center gap-2">
                                                    <input
                                                        type={isVisible ? 'text' : 'password'}
                                                        value={keyValue}
                                                        onChange={(e) => {
                                                            setFormData(prev => ({
                                                                ...prev,
                                                                apiKeys: { ...prev.apiKeys, [keyName]: e.target.value }
                                                            }));
                                                        }}
                                                        disabled={!isEditing}
                                                        placeholder={config?.label || keyName}
                                                        className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                        className="p-2 text-muted hover:text-on-surface transition-colors"
                                                    >
                                                        {isVisible
                                                            ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                                                            : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                        }
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="space-y-4">
                        {renderSubsectionHeader('Quickbooks', isQuickbooksCredentialsOpen, () => setIsQuickbooksCredentialsOpen(prev => !prev))}
                        {isQuickbooksCredentialsOpen && (
                            <div className="rounded-md border border-default bg-surface p-5 space-y-4">
                                {(['app1', 'app2'] as const).map((appKey) => {
                                    const keyNames = appKey === 'app1' ? QUICKBOOKS_APP1_KEY_NAMES : QUICKBOOKS_APP2_KEY_NAMES;
                                    const isDefault = (formData.apiKeys?.QUICKBOOKS_DEFAULT_APP || 'app1') === appKey;
                                    const appLabel = appKey === 'app1' ? 'App 1' : 'App 2';
                                    return (
                                        <div
                                            key={appKey}
                                            className={`rounded-lg border-2 p-4 transition-colors ${isDefault ? 'border-green-500 bg-green-50/50 dark:bg-green-900/10' : 'border-gray-200 dark:border-gray-600'}`}
                                        >
                                            <div className="flex items-center gap-3 mb-3">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="radio"
                                                        name="quickbooks_default_app"
                                                        checked={isDefault}
                                                        disabled={!isEditing}
                                                        onChange={() => {
                                                            setFormData(prev => ({
                                                                ...prev,
                                                                apiKeys: { ...prev.apiKeys, QUICKBOOKS_DEFAULT_APP: appKey }
                                                            }));
                                                        }}
                                                        className="w-4 h-4 text-green-600 accent-green-600"
                                                    />
                                                    <span className="font-semibold text-on-surface">{appLabel}</span>
                                                </label>
                                                {isDefault && (
                                                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-800/30 dark:text-green-400">
                                                        Default
                                                    </span>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                                {keyNames.map((keyName) => {
                                                    const keyValue = (formData.apiKeys || {})[keyName] || '';
                                                    const isVisible = visibleApiKeys[keyName];
                                                    const config = API_KEY_CONFIGS[keyName];
                                                    return (
                                                        <div key={keyName}>
                                                            <label className="block text-xs font-medium text-muted mb-1">{config?.label || keyName}</label>
                                                            <div className="flex items-center gap-2">
                                                                <input
                                                                    type={isVisible ? 'text' : 'password'}
                                                                    value={keyValue}
                                                                    onChange={(e) => {
                                                                        setFormData(prev => ({
                                                                            ...prev,
                                                                            apiKeys: { ...prev.apiKeys, [keyName]: e.target.value }
                                                                        }));
                                                                    }}
                                                                    disabled={!isEditing}
                                                                    placeholder={config?.label || keyName}
                                                                    className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                                    className="p-2 text-muted hover:text-on-surface transition-colors"
                                                                >
                                                                    {isVisible
                                                                        ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                                                                        : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                                    }
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Shared Quickbooks fields */}
                                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        {(['QUICKBOOKS_REFRESH_TOKEN', 'QUICKBOOKS_REALM_ID'] as const).map((keyName) => {
                                            const keyValue = (formData.apiKeys || {})[keyName] || '';
                                            const isVisible = visibleApiKeys[keyName];
                                            const config = API_KEY_CONFIGS[keyName];
                                            return (
                                                <div key={keyName}>
                                                    <label className="block text-xs font-medium text-muted mb-1">{config?.label || keyName}</label>
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type={isVisible ? 'text' : 'password'}
                                                            value={keyValue}
                                                            onChange={(e) => {
                                                                setFormData(prev => ({
                                                                    ...prev,
                                                                    apiKeys: { ...prev.apiKeys, [keyName]: e.target.value }
                                                                }));
                                                            }}
                                                            disabled={!isEditing}
                                                            placeholder={config?.label || keyName}
                                                            className="flex-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-slate-700 text-on-surface px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-60"
                                                        />
                                                        <button
                                                            type="button"
                                                            onClick={() => setVisibleApiKeys(prev => ({ ...prev, [keyName]: !prev[keyName] }))}
                                                            className="p-2 text-muted hover:text-on-surface transition-colors"
                                                        >
                                                            {isVisible
                                                                ? <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878L3 3m6.878 6.878L21 21" /></svg>
                                                                : <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                                                            }
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {/* Connect QuickBooks button */}
                                    <div className="mt-4">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const defaultApp = (formData.apiKeys || {} as any)['QUICKBOOKS_DEFAULT_APP'] || 'app1';
                                                window.open(`/api/quickbooks/oauth/connect?app=${defaultApp}`, '_blank', 'width=600,height=700');
                                            }}
                                            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                            </svg>
                                            Connect QuickBooks (Generate Refresh Token)
                                        </button>
                                        <p className="mt-1 text-xs text-muted">Opens Intuit OAuth to authorize and automatically save the refresh token.</p>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
                </>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Gamification Setting', isGamificationOpen, () => setIsGamificationOpen(prev => !prev), 'text-xl font-bold')}
                {isGamificationOpen && <div className="space-y-4 font-semibold mt-4">
                    <ToggleSwitch
                        checked={formData.gamingSettings.enableLeaderboard}
                        onChange={(checked) => handleToggleChange('gamingSettings', 'enableLeaderboard')}
                        label="Enable Leaderboard"
                        isEditing={isEditing}
                    />
                    <ToggleSwitch
                        checked={formData.gamingSettings.enablePoints}
                        onChange={(checked) => handleToggleChange('gamingSettings', 'enablePoints')}
                        label="Enable Points System"
                        isEditing={isEditing}
                    />
                </div>}

                <div className="border-t my-6"></div>
                {renderSectionHeader('Appearance', isAppearanceOpen, () => setIsAppearanceOpen(prev => !prev), 'text-xl font-bold')}

                {isAppearanceOpen && <>{/* Theme Mode Toggle */}
                <div className="space-y-4">
                    <div className="flex justify-between items-center p-4 bg-surface-elevated rounded-lg border border-default">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${themeMode === 'dark' ? 'bg-gray-700' : 'bg-blue-100'}`}>
                                {themeMode === 'dark' ? (
                                    <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                                        <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                                    </svg>
                                )}
                            </div>
                            <div>
                                <p className="font-semibold text-on-surface">Theme Mode</p>
                                <p className="text-sm text-on-surface-secondary">
                                    {themeMode === 'dark' ? 'Dark theme active' : 'Light theme active'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleThemeToggle}
                            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors duration-300 ${themeMode === 'dark' ? 'bg-primary' : 'bg-gray-300'
                                }`}
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ${themeMode === 'dark' ? 'translate-x-8' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Primary Color */}
                    <div className="flex justify-between items-center p-4 bg-surface-elevated rounded-lg border border-default">
                        <div className="flex items-center gap-3">
                            <div
                                className="w-9 h-9 rounded-lg border-2 border-white shadow-md"
                                style={{ backgroundColor: formData.colorScheme || '#3B82F6' }}
                            />
                            <div>
                                <p className="font-semibold text-on-surface">Primary Color</p>
                                <p className="text-sm text-on-surface-secondary">
                                    {isEditing ? 'Click color to change' : (formData.colorScheme || '#3B82F6').toUpperCase()}
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isEditing ? (
                                <>
                                    <input
                                        type="color"
                                        name="primary"
                                        value={formData.colorScheme || '#3B82F6'}
                                        onChange={handleColorChange}
                                        className="w-10 h-10 rounded-md border-2 border-gray-300 cursor-pointer hover:border-primary transition-colors"
                                    />
                                    <span className="font-mono text-sm text-on-surface-secondary">{formData.colorScheme || '#3B82F6'}</span>
                                </>
                            ) : (
                                <span className="font-mono text-sm text-on-surface bg-surface px-3 py-1 rounded-md border border-default">
                                    {formData.colorScheme || '#3B82F6'}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
                </>}

            </Card>
        </>
    );
};
