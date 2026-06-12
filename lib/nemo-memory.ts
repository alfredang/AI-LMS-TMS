import fs from 'fs';
import path from 'path';

const MEMORY_PATH = path.join(process.cwd(), 'data', 'nemo-memory.md');

const DEFAULT_MEMORY = `# Nemo Memory

## User Preferences

## Operational Context

## Recent Actions Log

## Known Issues
`;

function ensureMemoryFile(): void {
  const dir = path.dirname(MEMORY_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(MEMORY_PATH)) fs.writeFileSync(MEMORY_PATH, DEFAULT_MEMORY, 'utf8');
}

export function readMemory(): string {
  ensureMemoryFile();
  return fs.readFileSync(MEMORY_PATH, 'utf8');
}

export function appendMemory(section: string, entry: string): void {
  ensureMemoryFile();
  let content = fs.readFileSync(MEMORY_PATH, 'utf8');

  const sectionHeader = `## ${section}`;
  const idx = content.indexOf(sectionHeader);
  if (idx === -1) {
    // Section doesn't exist — add it at the end
    content += `\n${sectionHeader}\n- ${entry}\n`;
  } else {
    // Find the end of the section header line
    const headerEnd = content.indexOf('\n', idx);
    // Find the next section or end of file
    const nextSection = content.indexOf('\n## ', headerEnd + 1);
    const insertAt = nextSection === -1 ? content.length : nextSection;
    const datestamp = new Date().toISOString().split('T')[0];
    const newEntry = `- [${datestamp}] ${entry}\n`;
    content = content.slice(0, insertAt) + newEntry + content.slice(insertAt);
  }

  fs.writeFileSync(MEMORY_PATH, content, 'utf8');
}

export function getMemoryForSystemPrompt(): string {
  const memory = readMemory();
  if (!memory || memory.trim() === DEFAULT_MEMORY.trim()) {
    return '';
  }
  return `\n\n--- PERSISTENT MEMORY (from previous sessions) ---\n${memory}\n--- END MEMORY ---\n`;
}
