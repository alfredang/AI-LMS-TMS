const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Database connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD || 'shuo1314520.',
  port: parseInt(process.env.DB_PORT || '5432'),
});

const fixAssessmentFileUrls = async () => {
  console.log('🔧 Starting assessment file URL fix...');
  
  try {
    // Get all assessments with file URLs that need fixing (old format)
    const assessmentsQuery = `
      SELECT id, title, file_url 
      FROM assessment 
      WHERE file_url IS NOT NULL 
      AND (file_url LIKE '/assessments/%' OR file_url NOT LIKE '%uploads/assessments/%')
      ORDER BY title
    `;
    
    const result = await pool.query(assessmentsQuery);
    const assessments = result.rows;
    
    console.log(`📋 Found ${assessments.length} assessments with file URLs:`);
    assessments.forEach(assessment => {
      console.log(`  - ${assessment.title}: ${assessment.file_url}`);
    });
    
    // Get actual files on disk
    const uploadsAssessmentsDir = path.join(__dirname, '../public/uploads/assessments');
    let actualFiles = [];
    
    if (fs.existsSync(uploadsAssessmentsDir)) {
      actualFiles = fs.readdirSync(uploadsAssessmentsDir);
      console.log(`\n📂 Found ${actualFiles.length} files on disk:`);
      actualFiles.forEach(file => {
        console.log(`  - ${file}`);
      });
    } else {
      console.log('❌ uploads/assessments directory not found!');
      return;
    }
    
    // Match database records with actual files
    const updates = [];
    
    for (const assessment of assessments) {
      const currentUrl = assessment.file_url;
      const requestedFileName = path.basename(currentUrl);
      
      console.log(`\n🔍 Looking for match for: ${requestedFileName}`);
      
      // Find matching file on disk
      const matchingFile = actualFiles.find(file => {
        // Remove timestamp prefix (format: 1234567890-filename)
        const withoutTimestamp = file.replace(/^\d+-/, '');
        
        console.log(`    Comparing with file: ${file}`);
        console.log(`    Without timestamp: ${withoutTimestamp}`);
        
        // Try different normalization approaches
        const normalizations = [
          // Convert underscores to spaces
          {
            name: 'underscore-to-space',
            actual: withoutTimestamp.replace(/_/g, ' '),
            requested: requestedFileName.replace(/_/g, ' ')
          },
          // Case insensitive comparison
          {
            name: 'case-insensitive',
            actual: withoutTimestamp.replace(/_/g, ' ').toLowerCase(),
            requested: requestedFileName.replace(/_/g, ' ').toLowerCase()
          },
          // Direct comparison
          {
            name: 'direct',
            actual: withoutTimestamp,
            requested: requestedFileName
          },
          // Handle parentheses: convert __ to () and vice versa
          {
            name: 'parentheses-1',
            actual: withoutTimestamp.replace(/_/g, ' ').replace(/__/g, '()'),
            requested: requestedFileName.replace(/\(\)/g, '__').replace(/_/g, ' ')
          },
          // Handle parentheses with spaces: __SAQ__ to (SAQ)
          {
            name: 'parentheses-2',
            actual: withoutTimestamp.replace(/__([^_]+)__/g, '($1)').replace(/_/g, ' '),
            requested: requestedFileName.replace(/_/g, ' ')
          },
          // Handle parentheses reverse: (SAQ) to __SAQ__
          {
            name: 'parentheses-3',
            actual: withoutTimestamp.replace(/_/g, ' '),
            requested: requestedFileName.replace(/\(([^)]+)\)/g, '__$1__').replace(/_/g, ' ')
          },
          // Handle parentheses with proper spacing: __SAQ__ to (SAQ) with space
          {
            name: 'parentheses-with-space',
            actual: withoutTimestamp.replace(/__([^_]+)__/g, ' ($1)').replace(/_/g, ' '),
            requested: requestedFileName.replace(/_/g, ' ')
          },
          // Normalize spaces and dashes more flexibly
          {
            name: 'flexible-spacing',
            actual: withoutTimestamp.replace(/__([^_]+)__/g, ' ($1) ').replace(/_/g, ' ').replace(/\s+/g, ' ').trim(),
            requested: requestedFileName.replace(/\s+/g, ' ').trim()
          }
        ];
        
        for (const norm of normalizations) {
          console.log(`    ${norm.name}: "${norm.actual}" vs "${norm.requested}"`);
          if (norm.actual === norm.requested) {
            console.log(`  ✅ Match found: ${file}`);
            return true;
          }
        }
        
        return false;
      });
      
      if (matchingFile) {
        const newUrl = `/uploads/assessments/${matchingFile}`;
        updates.push({
          id: assessment.id,
          title: assessment.title,
          oldUrl: currentUrl,
          newUrl: newUrl
        });
        console.log(`  📝 Will update: ${currentUrl} → ${newUrl}`);
      } else {
        console.log(`  ❌ No matching file found for: ${requestedFileName}`);
      }
    }
    
    console.log(`\n🔄 Preparing to update ${updates.length} records...`);
    
    if (updates.length === 0) {
      console.log('No updates needed.');
      return;
    }
    
    // Show summary and ask for confirmation
    console.log('\n📝 Summary of changes:');
    updates.forEach((update, index) => {
      console.log(`${index + 1}. ${update.title}`);
      console.log(`   FROM: ${update.oldUrl}`);
      console.log(`   TO:   ${update.newUrl}\n`);
    });
    
    // Perform the updates
    console.log('💾 Applying updates to database...');
    
    for (const update of updates) {
      const updateQuery = `
        UPDATE assessment 
        SET file_url = $1 
        WHERE id = $2
      `;
      
      await pool.query(updateQuery, [update.newUrl, update.id]);
      console.log(`  ✅ Updated: ${update.title}`);
    }
    
    console.log('\n🎉 All assessment file URLs have been updated successfully!');
    
    // Verify the updates
    console.log('\n🔍 Verifying updates...');
    const verifyQuery = `
      SELECT id, title, file_url 
      FROM assessment 
      WHERE file_url IS NOT NULL 
      AND file_url LIKE '%assessments%'
      ORDER BY title
    `;
    
    const verifyResult = await pool.query(verifyQuery);
    console.log('\n📋 Updated assessment file URLs:');
    verifyResult.rows.forEach(assessment => {
      console.log(`  - ${assessment.title}: ${assessment.file_url}`);
    });
    
  } catch (error) {
    console.error('❌ Error fixing assessment file URLs:', error);
  } finally {
    await pool.end();
  }
};

// Run the fix
fixAssessmentFileUrls();