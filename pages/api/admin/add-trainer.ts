import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../../lib/db';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcrypt';
import multer from 'multer';
import { promisify } from 'util';

// Configure multer for file uploads
const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'trainers', 'profilePicture');
            if (!fs.existsSync(uploadDir)) {
                fs.mkdirSync(uploadDir, { recursive: true });
            }
            cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
            // Create unique filename with timestamp (same format as trainer-file.ts)
            const timestamp = Date.now();
            const originalName = file.originalname || 'profile_pic';
            // Clean the filename to prevent issues
            const cleanName = originalName.replace(/[^a-zA-Z0-9.-]/g, '_');
            cb(null, `${timestamp}_${cleanName}`);
        }
    }),
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

        // If a file was uploaded, use its path instead
        if (uploadedFile) {
            finalProfilePictureUrl = `/uploads/trainers/profilePicture/${uploadedFile.filename}`;
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
            
            // If it's a generated avatar URL, download and store locally
            if (finalProfilePictureUrl && finalProfilePictureUrl.startsWith('https://i.pravatar.cc')) {
                try {
                    // Download and store the avatar locally
                    const response = await fetch(finalProfilePictureUrl);
                    if (response.ok) {
                        const buffer = await response.arrayBuffer();
                        const fileName = `trainer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
                        const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'trainers', 'profilePicture');
                        
                        // Ensure directory exists
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }
                        
                        const filePath = path.join(uploadsDir, fileName);
                        fs.writeFileSync(filePath, Buffer.from(buffer));
                        
                        storedProfilePictureUrl = `/uploads/trainers/profilePicture/${fileName}`;
                        console.log('✅ Profile picture saved locally:', storedProfilePictureUrl);
                    }
                } catch (error) {
                    console.error('⚠️ Failed to save profile picture locally:', error);
                    // Continue with the original URL if local storage fails
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