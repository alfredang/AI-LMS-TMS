import { IconName } from '@components/ui/Icon';

// Shared tool-link catalogue for the sidebar TOOLS section. Rendered by both
// the Trainer sidebar (components/trainer/TrainerSidebar.tsx, page-aware) and
// the Learner sidebar (components/ToolsMenu.tsx, links only) — edit here so
// the two roles never drift.

export interface ToolLinkItem {
  label: string;
  icon: IconName;
  href: string;
}

export interface ToolLinkGroup {
  category: string;
  items: ToolLinkItem[];
}

export const ED_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Ice Breaker',    icon: IconName.Users,    href: 'https://alfredang.github.io/ice-breaker/' },
  { label: 'Pinboard',       icon: IconName.Bookmark, href: 'https://alfredang.github.io/pinboard/' },
  { label: 'Break Timer',    icon: IconName.Clock,    href: 'https://alfredang.github.io/musical-timer-countdown/' },
  { label: 'Word Cloud',     icon: IconName.Cloud,    href: 'https://alfredang.github.io/wordcloud/' },
  { label: 'Flash Cards',    icon: IconName.FileText,  href: 'https://alfredang.github.io/flashcard/' },
  { label: 'Live Q&A',       icon: IconName.Help,     href: 'https://alfredang.github.io/live-qna/' },
  { label: 'Whiteboard',     icon: IconName.Edit,     href: 'https://alfredang.github.io/whiteboard/' },
  { label: 'QR Code Generator', icon: IconName.QrCode, href: 'https://alfredang.github.io/qrcodegenerator/' },
  { label: 'Padlet',         icon: IconName.Bookmark, href: 'https://alfredang.github.io/padlet/' },
  { label: 'Collaborative Note', icon: IconName.FileText, href: 'https://alfredang.github.io/collabnote/' },
  { label: 'Collaborative Flow', icon: IconName.Link, href: 'https://alfredang.github.io/collabflow/' },
  { label: 'Collaborative Kanban', icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/kanban/' },
  { label: 'Live Poll',      icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/livepoll/' },
  { label: 'MindMaps', icon: IconName.Link, href: 'https://alfredang.github.io/mindmapping/' },
  { label: 'Spinning Wheel', icon: IconName.Spinner,  href: 'https://alfredang.github.io/spinning-wheel/' },
];

export const PROJECT_MGT_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'RACI Matrix', icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/raci/' },
  { label: 'Digital/AI Transformation', icon: IconName.Analytics, href: 'https://alfredang.github.io/digitaltransformation/' },
  { label: 'Agile/Scrum', icon: IconName.ClipboardCheck, href: 'https://alfredang.github.io/scrum/' },
  { label: 'Design Thinking Studio', icon: IconName.Create, href: 'https://alfredang.github.io/designthinking/' },
  { label: 'BMC Studio', icon: IconName.Create, href: 'https://alfredang.github.io/bcm/' },
];

// Six Sigma tools — split out from Ed Tools so root-cause analysis
// tools have their own discoverable home in the sidebar.
export const PROBLEM_SOLVING_TOOL_ITEMS: ToolLinkItem[] = [
  { label: '5 Whys',          icon: IconName.Help, href: 'https://alfredang.github.io/5whys/' },
  { label: 'Fishbone Diagram', icon: IconName.Link, href: 'https://alfredang.github.io/fishbone/' },
  { label: 'Pareto Chart',    icon: IconName.Link, href: 'https://alfredang.github.io/paretochart/' },
  { label: 'System Thinking', icon: IconName.Link, href: 'https://alfredang.github.io/systemloop/' },
  { label: 'SIPOC',           icon: IconName.Link, href: 'https://alfredang.github.io/sipoc/' },
];

export const CYBER_SECURITY_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Cyber Labs', icon: IconName.Shield, href: 'https://alfredang.github.io/cybersecuritysimulator/' },
  { label: 'Ethical Hacking Labs', icon: IconName.Shield, href: 'https://alfredang.github.io/ethnicalhacking/' },
  { label: 'Pentest Labs', icon: IconName.Shield, href: 'https://pentest-fauxbank.vercel.app/' },
  { label: 'Cryptography', icon: IconName.Shield, href: 'https://alfredang.github.io/cryptography-toolkit/' },
];

export const VIRTUAL_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Google Meet',      icon: IconName.Video, href: 'https://meet.google.com/landing' },
  { label: 'Microsoft Teams',  icon: IconName.Video, href: 'https://www.microsoft.com/en-sg/microsoft-teams/log-in' },
  { label: 'Zoom',             icon: IconName.Video, href: 'https://www.zoom.com/' },
];

export const DATA_ANALYTICS_ITEMS: ToolLinkItem[] = [
  { label: 'Pivot Visualization', icon: IconName.Analytics, href: 'https://alfredang.github.io/novapivot/' },
  { label: 'Anomaly Detection', icon: IconName.Warning, href: 'https://alfredang.github.io/anamolydetection2/' },
  { label: 'Factor Analysis', icon: IconName.Analytics, href: 'https://multifactoranalysis.streamlit.app/' },
  { label: 'Mock Data Generator', icon: IconName.FileText, href: 'https://alfredang.github.io/mockdatagen/' },
];

export const ML_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Classification', icon: IconName.Analytics, href: 'https://ml-classification-888.streamlit.app/' },
  { label: 'Clustering', icon: IconName.Analytics, href: 'https://mlclustering-888.streamlit.app/' },
];

export const FINANCE_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Tax Calculator', icon: IconName.Analytics, href: 'https://alfredang.github.io/novataxsg/' },
  { label: 'Financial Planning & Analysis', icon: IconName.Analytics, href: 'https://alfredang.github.io/novafinance/' },
  { label: 'Financial Ratio Calculators', icon: IconName.Analytics, href: 'https://alfredang.github.io/novafinancialratiocalculator/' },
  { label: 'Financial Trend Analysis', icon: IconName.Analytics, href: 'https://alfredang.github.io/financialtrend/' },
  { label: 'Credit Loan Anal...', icon: IconName.Analytics, href: 'https://creditloananalysis.streamlit.app/' },
];

export const HR_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'MBTI', icon: IconName.Analytics, href: 'https://alfredang.github.io/mbti/#landing' },
  { label: 'AI Interview Coach', icon: IconName.Chat, href: 'https://alfredang.github.io/ai-interviewing/' },
  { label: 'HR Interview Gen', icon: IconName.Assignment, href: 'https://alfredang.github.io/hr-interviewing/' },
];

export const STAT_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Probability',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#probability' },
  { label: 'Descriptive',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/descriptive' },
  { label: 'Correlation',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/correlation' },
  { label: 'Regression',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/regression' },
  { label: 'Hypothesis',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#/hypothesis' },
  { label: 'Confidence Interval', icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#confidence' },
  { label: 'Bayesian Inference', icon: IconName.Analytics, href: 'https://alfredang.github.io/novastats/#bayesian' },
];

export const DOE_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Full Factorial',        icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#full-factorial' },
  { label: 'Fractional Factorial',  icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#fractional-factorial' },
  { label: 'Taguchi',               icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#taguchi' },
  { label: 'Central Composite',     icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#central-composite' },
  { label: 'Box-Behnken',           icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#box-behnken' },
  { label: 'Plackett-Burman',       icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#plackett-burman' },
  { label: 'Latin Square',          icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#latin-square' },
  { label: 'Response Surface',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novadoe/#response-surface' },
];

export const SPC_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'c Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#c-chart' },
  { label: 'u Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#u-chart' },
  { label: 'np Chart',             icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#np-chart' },
  { label: 'p Chart',              icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#p-chart' },
  { label: 'X-mR Chart',           icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#x-mr-chart' },
  { label: 'X̄-R Chart',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#xbar-r-chart' },
  { label: 'X̄-s Chart',      icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#xbar-s-chart' },
  { label: 'Distribution',         icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#distribution' },
  { label: 'Process Capability',   icon: IconName.Analytics, href: 'https://alfredang.github.io/novaspc/#process-capability' },
];

export const VIDEO_CREATION_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Video Creation', icon: IconName.Video, href: 'https://github.com/alfredang/videocreation' },
];

export const SUSTAINABILITY_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Carbon Footprint Calculator', icon: IconName.Analytics, href: 'https://alfredang.github.io/sgcarboncalculator/' },
];

export const NETWORKING_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'IP Calculator', icon: IconName.Analytics, href: 'https://alfredang.github.io/ipcalculator/' },
  { label: 'PCAP Analyzer', icon: IconName.Analytics, href: 'https://alfredang.github.io/pcapanalyzer/' },
  { label: 'Regex Generator', icon: IconName.Analytics, href: 'https://alfredang.github.io/regexgenerator/' },
];

export const K8S_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Ubuntu', icon: IconName.Analytics, href: 'https://killercoda.com/playgrounds/scenario/ubuntu' },
  { label: 'Kubernetes', icon: IconName.Analytics, href: 'https://killercoda.com/playgrounds/scenario/kubernetes' },
];

export const BLOCKCHAIN_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Certify NFT', icon: IconName.Award, href: 'https://alfredang.github.io/certifynft/' },
  { label: 'Supply Verify', icon: IconName.Link, href: 'https://alfredang.github.io/supplyverify/' },
  { label: 'Hashing Tool', icon: IconName.Shield, href: 'https://alfredang.github.io/hashgenerator/' },
];

export const QUANTUM_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Quantum Labs', icon: IconName.Sync, href: 'https://alfredang.github.io/quantumlabs/' },
  { label: 'IBM Composer', icon: IconName.Edit, href: 'https://quantum.cloud.ibm.com/composer' },
  { label: 'Quantum Programming Studio', icon: IconName.Create, href: 'https://quantum-circuit.com/' },
];

export const DESIGN_TOOL_ITEMS: ToolLinkItem[] = [
  { label: 'Logo Maker', icon: IconName.Create, href: 'https://alfredang.github.io/logomaker/' },
];

export const GENAI_LINK_GROUPS: ToolLinkGroup[] = [
  {
    category: 'Text',
    items: [
      { label: 'ChatGPT',            icon: IconName.Chat,   href: 'https://chatgpt.com/' },
      { label: 'Gemini',             icon: IconName.Chat,   href: 'https://gemini.google.com/app' },
      { label: 'Claude',             icon: IconName.Chat,   href: 'https://claude.ai/new' },
      { label: 'Grok',               icon: IconName.Chat,   href: 'https://grok.com/' },
      { label: 'DeepSeek',           icon: IconName.Chat,   href: 'https://chat.deepseek.com/' },
      { label: 'Kimi',               icon: IconName.Chat,   href: 'https://www.kimi.com/en' },
      { label: 'Qwen',               icon: IconName.Chat,   href: 'https://qwen.ai/home' },
      { label: 'Perplexity',          icon: IconName.Chat,   href: 'https://www.perplexity.ai/' },
    ],
  },
  {
    category: 'Image',
    items: [
      { label: 'Firefly',            icon: IconName.Create, href: 'https://firefly.adobe.com/' },
      { label: 'Nano Banana',        icon: IconName.Create, href: 'https://gemini.google.com/app' },
      { label: 'Microsoft Designer', icon: IconName.Create, href: 'https://designer.microsoft.com/' },
      { label: 'Leonardo',           icon: IconName.Create, href: 'https://app.leonardo.ai/' },
      { label: 'Face Swap',          icon: IconName.Create, href: 'https://huggingface.co/spaces/alfredang/faceswap' },
    ],
  },
  {
    category: 'Video',
    items: [
      { label: 'Kling',              icon: IconName.Video,  href: 'https://kling.ai/' },
      { label: 'Invideo',            icon: IconName.Video,  href: 'https://invideo.io/' },
      { label: 'Veed',               icon: IconName.Video,  href: 'https://www.veed.io/' },
      { label: 'Descript',           icon: IconName.Video,  href: 'https://www.descript.com/' },
      { label: 'Pictory',            icon: IconName.Video,  href: 'https://pictory.ai/' },
    ],
  },
  {
    category: 'Music',
    items: [
      { label: 'Suno',               icon: IconName.Globe,  href: 'https://suno.com/' },
    ],
  },
  {
    category: 'Presentation',
    items: [
      { label: 'Gamma',              icon: IconName.FileText, href: 'https://gamma.app/' },
      { label: 'NotebookLM',         icon: IconName.FileText, href: 'https://notebooklm.google/' },
      { label: 'Napkin',             icon: IconName.FileText, href: 'https://www.napkin.ai/' },
    ],
  },
  {
    category: 'UI Design',
    items: [
      { label: 'Figma',              icon: IconName.Edit,   href: 'https://www.figma.com/make/' },
      { label: 'Stitch',             icon: IconName.Edit,   href: 'https://stitch.withgoogle.com/' },
    ],
  },
];

export const AGENTIC_AI_GROUPS: ToolLinkGroup[] = [
  {
    category: 'No Code Platforms',
    items: [
      { label: 'AgentX',       icon: IconName.Globe, href: 'https://www.agentx.so/' },
      { label: 'Opal',         icon: IconName.Globe, href: 'https://opal.google/landing/' },
      { label: 'Relevance AI', icon: IconName.Globe, href: 'https://relevanceai.com/' },
      { label: 'Promptly AI',  icon: IconName.Globe, href: 'https://www.promptly.fyi/' },
    ],
  },
  {
    category: 'Low Code Platforms',
    items: [
      { label: 'n8n',      icon: IconName.Globe, href: 'https://n8n.io/' },
      { label: 'Langflow',  icon: IconName.Globe, href: 'https://www.langflow.org/' },
      { label: 'Flowise',   icon: IconName.Globe, href: 'https://flowiseai.com/' },
    ],
  },
  {
    category: 'Voice Agents',
    items: [
      { label: 'ElevenLabs', icon: IconName.Globe, href: 'https://elevenlabs.io/' },
      { label: 'Retell AI',  icon: IconName.Globe, href: 'https://www.retellai.com/' },
      { label: 'Vapi',       icon: IconName.Globe, href: 'https://vapi.ai/' },
    ],
  },
  {
    category: 'Video Agents',
    items: [
      { label: 'HeyGen',    icon: IconName.Globe, href: 'https://www.heygen.com/' },
      { label: 'Synthesia',  icon: IconName.Globe, href: 'https://www.synthesia.io/' },
    ],
  },
];

// Ordered catalogue of every tool group as shown in the trainer sidebar.
// `items` groups are flat link lists; `groups` entries render nested
// category sub-accordions (GenAI / Agentic AI).
export type ToolGroupEntry =
  | { key: string; label: string; icon: IconName; items: ToolLinkItem[] }
  | { key: string; label: string; icon: IconName; groups: ToolLinkGroup[] };

export const TOOL_GROUPS: ToolGroupEntry[] = [
  { key: 'edTools',        label: 'Ed Tools',             icon: IconName.BookOpen,       items: ED_TOOL_ITEMS },
  { key: 'projectMgt',     label: 'Project Mgt Tools',    icon: IconName.ClipboardCheck, items: PROJECT_MGT_TOOL_ITEMS },
  { key: 'sixSigma',       label: 'Six Sigma Tools',      icon: IconName.Help,           items: PROBLEM_SOLVING_TOOL_ITEMS },
  { key: 'cyberSecurity',  label: 'Cyber Security Tools', icon: IconName.Shield,         items: CYBER_SECURITY_TOOL_ITEMS },
  { key: 'finance',        label: 'Finance Tools',        icon: IconName.Analytics,      items: FINANCE_TOOL_ITEMS },
  { key: 'hr',             label: 'HR Tools',             icon: IconName.Analytics,      items: HR_TOOL_ITEMS },
  { key: 'dataAnalytics',  label: 'Data Analytics Tools', icon: IconName.Analytics,      items: DATA_ANALYTICS_ITEMS },
  { key: 'ml',             label: 'ML Tools',             icon: IconName.Analytics,      items: ML_TOOL_ITEMS },
  { key: 'stat',           label: 'Statistical Tools',    icon: IconName.Analytics,      items: STAT_TOOL_ITEMS },
  { key: 'doe',            label: 'DOE Tools',            icon: IconName.Analytics,      items: DOE_TOOL_ITEMS },
  { key: 'spc',            label: 'SPC Tools',            icon: IconName.Analytics,      items: SPC_TOOL_ITEMS },
  { key: 'sustainability', label: 'Sustainability Tools', icon: IconName.Analytics,      items: SUSTAINABILITY_TOOL_ITEMS },
  { key: 'networking',     label: 'Networking Tools',     icon: IconName.Analytics,      items: NETWORKING_TOOL_ITEMS },
  { key: 'k8s',            label: 'K8s Tools',            icon: IconName.Analytics,      items: K8S_TOOL_ITEMS },
  { key: 'blockchain',     label: 'Blockchain Tools',     icon: IconName.Award,          items: BLOCKCHAIN_TOOL_ITEMS },
  { key: 'quantum',        label: 'Quantum Tools',        icon: IconName.Sync,           items: QUANTUM_TOOL_ITEMS },
  { key: 'design',         label: 'Design Tools',         icon: IconName.Create,         items: DESIGN_TOOL_ITEMS },
  { key: 'genAi',          label: 'GenAI Tools',          icon: IconName.Create,         groups: GENAI_LINK_GROUPS },
  { key: 'agenticAi',      label: 'Agentic AI Tools',     icon: IconName.Link,           groups: AGENTIC_AI_GROUPS },
  { key: 'virtual',        label: 'Virtual Tools',        icon: IconName.Video,          items: VIRTUAL_TOOL_ITEMS },
];
