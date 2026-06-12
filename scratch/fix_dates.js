const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetRegex = /\.toISOString\(\)\.slice\(0, 10\)/g;

function getRelativeImportPath(filePath) {
    const dir = path.dirname(filePath);
    let relPath = path.relative(dir, 'lib/dateHelpers');
    if (!relPath.startsWith('.')) {
        relPath = './' + relPath;
    }
    return relPath;
}

function processFile(filePath) {
    const absPath = path.resolve(filePath);
    let content = fs.readFileSync(absPath, 'utf8');

    if (!targetRegex.test(content) && !content.includes('+ 8 * 3600 * 1000')) {
        return; // No match
    }

    console.log(`Processing ${filePath}`);

    // Replace occurrences like: new Date().toISOString().slice(0, 10)
    // We will do a generic regex replace, but we must ensure what we replace is wrapped in getLocalYMD(...)
    // Actually, it's easier to do targeted string replacements for common patterns.
    
    let modified = content;

    // Pattern 1: x.toISOString().slice(0, 10) -> getLocalYMD(x)
    modified = modified.replace(/([a-zA-Z0-9_.]+)\.toISOString\(\)\.slice\(0,\s*10\)/g, 'getLocalYMD($1)');

    // Pattern 2: new Date(...).toISOString().slice(0, 10) -> getLocalYMD(new Date(...))
    // We can handle `new Date(stuff).toISOString().slice(0, 10)`
    // This is a bit tricky with regex, let's use a simpler approach. 
    // `new Date().toISOString().slice(0, 10)` -> `getLocalYMD(new Date())`
    modified = modified.replace(/(new Date\([^)]*\))\.toISOString\(\)\.slice\(0,\s*10\)/g, 'getLocalYMD($1)');
    
    // Some complex ones might have nested parens. E.g. `new Date(Date.now() + ...)`
    // Let's do a loop for `new Date(` to `).toISOString().slice(0, 10)`
    let count = 0;
    while (modified.includes('.toISOString().slice(0, 10)')) {
        const idx = modified.indexOf('.toISOString().slice(0, 10)');
        if (idx === -1) break;
        
        // Find the start of the expression before .toISOString()
        // For simplicity, let's just do manual string extraction
        // Look backwards for `new Date(` or a variable name.
        let startIdx = idx - 1;
        let pCount = 0;
        let inDate = false;
        if (modified[startIdx] === ')') {
            inDate = true;
            pCount = 1;
            startIdx--;
            while (startIdx >= 0 && pCount > 0) {
                if (modified[startIdx] === ')') pCount++;
                if (modified[startIdx] === '(') pCount--;
                startIdx--;
            }
            // Now startIdx is before the `(`. Look for `new Date` or similar.
            let pre = modified.slice(Math.max(0, startIdx - 10), startIdx + 1);
            if (pre.endsWith('new Date')) {
                startIdx -= 8;
            } else if (pre.endsWith('Date')) {
                // ... maybe just `Date`?
            }
        } else {
            // It's a variable or property e.g. `d`, `sgt`, `cr.start_date`
            while (startIdx >= 0 && /[a-zA-Z0-9_.]/.test(modified[startIdx])) {
                startIdx--;
            }
        }
        
        // Extract the target expression
        const expr = modified.substring(startIdx + 1, idx);
        
        const before = modified.substring(0, startIdx + 1);
        const after = modified.substring(idx + 29); // length of '.toISOString().slice(0, 10)'
        
        modified = before + `getLocalYMD(${expr})` + after;
        
        count++;
        if (count > 50) break; // prevent infinite loops
    }

    // Pattern 3: new Date(d.getTime() + 8 * 3600 * 1000) -> just getLocalYMD(d)
    modified = modified.replace(/new Date\(\s*([a-zA-Z0-9_.]+)\.getTime\(\)\s*\+\s*8\s*\*\s*3600\s*\*\s*1000\s*\)/g, 'getLocalYMD($1)');
    // We might have replaced `.toISOString().slice(0, 10)` to `getLocalYMD(getLocalYMD(d))` if both matched.
    modified = modified.replace(/getLocalYMD\(getLocalYMD\((.*?)\)\)/g, 'getLocalYMD($1)');

    if (modified !== content) {
        // Ensure import
        if (!modified.includes('getLocalYMD')) {
             // wait, if it doesn't include it, we didn't add it.
        } else if (!modified.includes('import { getLocalYMD }')) {
            const relPath = getRelativeImportPath(filePath);
            const importStmt = `import { getLocalYMD } from '${relPath.replace(/\\/g, '/')}';\n`;
            
            // Insert after the last import, or at the top
            const importsEnd = modified.lastIndexOf('import ');
            if (importsEnd !== -1) {
                const endOfLine = modified.indexOf('\n', importsEnd);
                modified = modified.slice(0, endOfLine + 1) + importStmt + modified.slice(endOfLine + 1);
            } else {
                modified = importStmt + modified;
            }
        }
        fs.writeFileSync(absPath, modified, 'utf8');
    }
}

const files = execSync('git grep -l ".toISOString().slice(0, 10)"').toString().trim().split('\n');
const extraFiles = execSync('git grep -l "8 \\* 3600 \\* 1000"').toString().trim().split('\n');
const allFiles = [...new Set([...files, ...extraFiles])].filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));

allFiles.forEach(f => {
    if (!f.includes('scratch/') && !f.includes('components/UpcomingClassesTable.tsx') && !f.includes('components/admin/FundingValidityView.tsx') && !f.includes('components/admin/MasterListView.tsx') && !f.includes('components/finance/AllCourseRunsView.tsx') && !f.includes('components/trainer/TrainingHoursPage.tsx')) {
        processFile(f);
    }
});
