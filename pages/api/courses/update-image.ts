import { withAuth } from '@lib/auth/withAuth';
// Simple API endpoint to update course image URLs
import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  try {
    const { courseId, imageUrl } = req.body;

    if (!courseId || !imageUrl) {
      return res.status(400).json({ message: 'courseId and imageUrl are required' });
    }

    // Update the course image URL
    const query = `
      UPDATE course 
      SET image_url = $1 
      WHERE id = $2
      RETURNING id, title, image_url
    `;

    const result = await pool.query(query, [imageUrl, courseId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Course not found' });
    }

    const updatedCourse = result.rows[0];

    return res.status(200).json({
      success: true,
      message: 'Course image URL updated successfully',
      data: updatedCourse
    });

  } catch (error) {
    console.error('Error updating course image URL:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error' 
    });
  }
}

export default withAuth(handler);
