const fs = require('fs');

const filePath = 'c:\\Users\\lz624\\Tertiary\\Test_backend\\LmsTmsSystem\\client\\src\\components\\ssg\\AddCourseRuns.tsx';

// Read the file
let content = fs.readFileSync(filePath, 'utf8');

// Remove all placeholder attributes
content = content.replace(/\s+placeholder="[^"]*"/g, '');

// Write back to file
fs.writeFileSync(filePath, content, 'utf8');

console.log('Removed all placeholder attributes from AddCourseRuns.tsx');