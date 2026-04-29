import { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { path: filePath } = req.query;
    
    if (!filePath || !Array.isArray(filePath)) {
      return res.status(400).json({ message: 'Invalid file path' });
    }

    // Join the path segments
    const requestedPath = filePath.join('/');
    
    // Construct the full file path
    const fullPath = path.join(process.cwd(), 'public', 'uploads', requestedPath);
    
    // Security check: ensure the path is within the uploads directory
    const uploadsDir = path.join(process.cwd(), 'public', 'uploads');
    const resolvedPath = path.resolve(fullPath);
    const resolvedUploadsDir = path.resolve(uploadsDir);
    
    if (!resolvedPath.startsWith(resolvedUploadsDir)) {
      return res.status(403).json({ message: 'Access denied' });
    }

    // Check if file exists — if not, proxy from production in dev mode
    if (!fs.existsSync(resolvedPath)) {
      if (process.env.NODE_ENV !== 'production') {
        const prodBaseUrl = (process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
        const prodUrl = `${prodBaseUrl}/uploads/${requestedPath}`;
        try {
          const prodRes = await fetch(prodUrl);
          if (prodRes.ok && prodRes.body) {
            const contentType = prodRes.headers.get('content-type') || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            const buffer = Buffer.from(await prodRes.arrayBuffer());
            return res.status(200).send(buffer);
          }
        } catch {
          // Fall through to 404
        }
      }
      return res.status(404).json({ message: 'File not found' });
    }

    // Get file stats
    const stats = fs.statSync(resolvedPath);
    if (!stats.isFile()) {
      return res.status(404).json({ message: 'File not found' });
    }

    // Set appropriate content type based on file extension
    const ext = path.extname(resolvedPath).toLowerCase();
    const contentTypes: { [key: string]: string } = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
    };

    const contentType = contentTypes[ext] || 'application/octet-stream';
    
    // Set cache headers for images
    if (contentType.startsWith('image/')) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
    
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);

    // Stream the file
    const readStream = fs.createReadStream(resolvedPath);
    readStream.pipe(res);

  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
}