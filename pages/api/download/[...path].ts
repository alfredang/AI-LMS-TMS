import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { path: filePath } = req.query;
    
    if (!filePath || !Array.isArray(filePath)) {
      return res.status(400).json({ success: false, error: 'Invalid file path' });
    }

    // Construct the full file path
    const relativePath = filePath.join('/');
    const fullPath = path.join(process.cwd(), 'public', relativePath);
    
    // Security check: make sure the path is within the public directory
    const publicDir = path.join(process.cwd(), 'public');
    if (!fullPath.startsWith(publicDir)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    let actualFilePath = fullPath;
    
    // Check if file exists
    if (!fs.existsSync(fullPath)) {
      // If exact file doesn't exist, try to find it by pattern
      let foundFile = false;
      
      if (relativePath.includes('assessments/')) {
        const requestedFileName = path.basename(relativePath);
        console.log(`🔍 Looking for assessment file: ${requestedFileName}`);
        
        // Try multiple possible directories for assessments
        const possibleDirs = [
          path.join(process.cwd(), 'public', 'assessments'),
          path.join(process.cwd(), 'public', 'uploads', 'assessments')
        ];
        
        for (const directory of possibleDirs) {
          if (fs.existsSync(directory)) {
            console.log(`📂 Searching in directory: ${directory}`);
            const files = fs.readdirSync(directory);
            console.log(`📄 Files in directory:`, files);
            
            // Look for file that matches the requested filename (with various transformations)
            const matchingFile = files.find(file => {
              // Remove timestamp prefix (format: 1234567890-filename)
              const withoutTimestamp = file.replace(/^\d+-/, '');
              
              // Try different normalization approaches
              const normalizations = [
                // Original comparison
                {
                  actual: withoutTimestamp.replace(/_/g, ' '),
                  requested: requestedFileName.replace(/_/g, ' ')
                },
                // Case insensitive comparison
                {
                  actual: withoutTimestamp.replace(/_/g, ' ').toLowerCase(),
                  requested: requestedFileName.replace(/_/g, ' ').toLowerCase()
                },
                // Direct comparison
                {
                  actual: withoutTimestamp,
                  requested: requestedFileName
                },
                // Compare without special characters
                {
                  actual: withoutTimestamp.replace(/[^a-zA-Z0-9.]/g, ''),
                  requested: requestedFileName.replace(/[^a-zA-Z0-9.]/g, '')
                }
              ];
              
              for (const norm of normalizations) {
                if (norm.actual === norm.requested) {
                  console.log(`✅ File match found: ${file} matches ${requestedFileName}`);
                  return true;
                }
              }
              
              return false;
            });
            
            if (matchingFile) {
              actualFilePath = path.join(directory, matchingFile);
              console.log(`📁 Found assessment file: ${matchingFile} for requested: ${requestedFileName}`);
              foundFile = true;
              break;
            }
          }
        }
      }
      
      // If still not found, return 404
      if (!foundFile && !fs.existsSync(actualFilePath)) {
        console.log(`❌ File not found: ${relativePath}`);
        return res.status(404).json({ success: false, error: 'File not found' });
      }
    }

    // Get file stats
    const stats = fs.statSync(actualFilePath);
    const fileName = path.basename(actualFilePath);
    
    // For assessment files, use the original requested filename for download
    const downloadFileName = relativePath.includes('assessments/') ? 
      path.basename(relativePath) : fileName;
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFileName}"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Stream the file
    const fileStream = fs.createReadStream(actualFilePath);
    fileStream.pipe(res);

  } catch (error) {
    console.error('Error downloading file:', error);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
}