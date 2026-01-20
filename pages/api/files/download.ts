import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';
import { extractOriginalFilename } from '../../../utils/fileUtils';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { filePath } = req.query;
    
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ message: 'File path is required' });
    }

    // Remove leading slash and ensure it's in the uploads directory
    const cleanPath = filePath.startsWith('/') ? filePath.substring(1) : filePath;
    
    // Security check: ensure the path is within the uploads directory
    if (!cleanPath.startsWith('uploads/')) {
      return res.status(403).json({ message: 'Access denied' });
    }

    const absolutePath = path.join(process.cwd(), 'public', cleanPath);
    
    // Check if file exists
    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Get the filename from path and extract original name
    const filename = path.basename(cleanPath);
    const originalFilename = extractOriginalFilename(filename);
    
    // Read the file
    const fileBuffer = fs.readFileSync(absolutePath);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${originalFilename}"`);
    res.setHeader('Content-Length', fileBuffer.length);
    
    // Send the file
    res.status(200).send(fileBuffer);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}