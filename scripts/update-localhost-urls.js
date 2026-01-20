/**
 * Script to update hardcoded localhost:3001 URLs to use the centralized config
 *
 * This is a helper script to identify files that need manual review
 * Run with: node scripts/update-localhost-urls.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔍 Searching for hardcoded localhost URLs...\n');

try {
  // Use grep to find all files with localhost references
  const result = execSync('git grep -l "localhost:3001"', { encoding: 'utf-8' });
  const files = result.trim().split('\n').filter(f =>
    // Filter out non-code files
    !f.includes('.md') &&
    !f.includes('package-lock.json') &&
    !f.includes('scripts/update-localhost-urls.js')
  );

  console.log(`Found ${files.length} files with hardcoded localhost:3001:\n`);
  files.forEach(file => console.log(`  - ${file}`));

  console.log('\n📝 Recommended changes:');
  console.log('1. Import getBaseUrl or getApiBaseUrl from lib/config');
  console.log('2. Replace hardcoded URLs with template literals using the config');
  console.log('3. Test the changes locally');
  console.log('4. Update .env file with NEXT_PUBLIC_BASE_URL=http://localhost:3000');

} catch (error) {
  console.error('Error running git grep:', error.message);
  console.log('\n💡 Make sure you have git installed and are in a git repository');
}
