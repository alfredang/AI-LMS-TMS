import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { cors } from '../../../lib/cors';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Handle CORS
  if (cors(req, res)) {
    return;
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { fileUrl } = req.query;
    
    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'File URL is required'
      });
    }

    // Construct the full file path
    const filePath = path.join(process.cwd(), 'public', fileUrl);
    
    // Security check: make sure the path is within the public directory
    const publicDir = path.join(process.cwd(), 'public');
    if (!filePath.startsWith(publicDir)) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    // Check if file exists and delete it
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log('🗑️ File deleted successfully:', filePath);
      
      return res.status(200).json({
        success: true,
        message: 'File deleted successfully'
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

  } catch (error) {
    console.error('❌ Error deleting file:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
}

export default handler;