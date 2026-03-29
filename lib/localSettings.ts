import fs from 'fs';
import path from 'path';

const SETTINGS_FILE = path.join(process.cwd(), 'config', 'local-settings.json');

interface LocalSettings {
  defaultPassword: string;
}

const DEFAULT_SETTINGS: LocalSettings = {
  defaultPassword: '',
};

export function getLocalSettings(): LocalSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
    }
  } catch (e) {
    console.error('Failed to read local settings:', e);
  }
  return { ...DEFAULT_SETTINGS };
}

export function updateLocalSettings(updates: Partial<LocalSettings>): LocalSettings {
  const current = getLocalSettings();
  const updated = { ...current, ...updates };
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2) + '\n');
  } catch (e) {
    console.error('Failed to write local settings:', e);
  }
  return updated;
}
