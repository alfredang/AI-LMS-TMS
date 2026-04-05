import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { promisify } from 'util';
import { uploadProfileImageBufferToDrive } from '../../../lib/google-drive/profile-image-helpers';

// Configure multer for in-memory file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(null, false);
        }
    }
});

const uploadMiddleware = promisify(upload.single('profilePicture'));

// Disable default body parser for file uploads
export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    try {
        // Handle file upload first
        await uploadMiddleware(req as any, res as any);

        // Parse form data
        const {
            email,
            password,
            fullName,
            telephone,
            trainerType,
            status,
            linkedinUrl,
            gender,
            profilePictureUrl
        } = req.body;

        // Get uploaded file info
        const uploadedFile = (req as any).file;
        let finalProfilePictureUrl = profilePictureUrl;

        // If a file was uploaded, send it to Google Drive instead
        if (uploadedFile) {
            const uploadResult = await uploadProfileImageBufferToDrive({
                buffer: uploadedFile.buffer,
                mimeType: uploadedFile.mimetype || 'application/octet-stream',
                originalName: uploadedFile.originalname || 'profile-picture',
                role: 'trainer',
                userId: email || fullName,
            });
            finalProfilePictureUrl = uploadResult.fileUrl;
        }

        // Validation
        if (!email || !password || !fullName || !telephone || !trainerType || !status || !gender) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: email, password, fullName, telephone, trainerType, status, gender'
            });
        }

        const client = await pool.connect();

        try {
            // Check if email already exists
            const existingUser = await client.query(
                'SELECT id FROM app_user WHERE email = $1',
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'A user with this email already exists'
                });
            }

            // Hash the password with bcrypt
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);

            // Handle profile picture storage
            let storedProfilePictureUrl = finalProfilePictureUrl;
            
            // If it's a generated avatar URL, copy it into the configured Google Drive folder
            if (finalProfilePictureUrl && finalProfilePictureUrl.startsWith('https://i.pravatar.cc')) {
                try {
                    const response = await fetch(finalProfilePictureUrl);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const uploadResult = await uploadProfileImageBufferToDrive({
                            buffer: Buffer.from(buffer),
                            mimeType: response.headers.get('content-type') || 'image/jpeg',
                            originalName: `trainer-avatar-${Date.now()}.jpg`,
                            role: 'trainer',
                            userId: email || fullName,
                        });
                        storedProfilePictureUrl = uploadResult.fileUrl;
                        console.log('✅ Profile picture saved to Google Drive:', storedProfilePictureUrl);
                    }
                } catch (error) {
                    console.error('⚠️ Failed to save profile picture to Google Drive:', error);
                    // Continue with the original URL if Drive upload fails
                }
            }

            // Begin transaction
            await client.query('BEGIN');

            // Insert into app_user table (using both password fields for compatibility)
            const userResult = await client.query(
                `INSERT INTO app_user (email, password, password_hash, full_name, profile_picture_url, created_at, updated_at)
                 VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                 RETURNING id`,
                [email, password, hashedPassword, fullName, storedProfilePictureUrl]
            );

            const userId = userResult.rows[0].id;

            // Insert role mapping into user_role_map table
            await client.query(
                `INSERT INTO user_role_map (user_id, role)
                 VALUES ($1, 'Trainer')`,
                [userId]
            );

            // Insert into trainer_profile table
            await client.query(
                `INSERT INTO trainer_profile (user_id, tel, trainer_type, status, linkedin_url, gender)
                 VALUES ($1, $2, $3, $4, $5, $6)`,
                [userId, telephone, trainerType, status, linkedinUrl, gender]
            );

            // Commit transaction
            await client.query('COMMIT');

            console.log('✅ New trainer added successfully:', {
                userId,
                email,
                fullName,
                trainerType,
                status
            });

            res.status(201).json({
                success: true,
                message: 'Trainer added successfully',
                data: {
                    userId,
                    email,
                    fullName,
                    trainerType,
                    status,
                    profilePictureUrl: storedProfilePictureUrl
                }
            });

        } catch (dbError) {
            // Rollback transaction on error
            await client.query('ROLLBACK');
            throw dbError;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('Error adding trainer:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add trainer',
            error: process.env.NODE_ENV === 'development' ? (error as Error).message : undefined
        });
    }
}
