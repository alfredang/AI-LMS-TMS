import { NextApiRequest, NextApiResponse } from 'next';
import pool from '../../lib/db';
import { cors } from '../../lib/cors';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Apply CORS middleware
    cors(req, res);

    if (req.method !== 'GET') {
      return res.status(405).json({ 
        success: false, 
        error: 'Method not allowed' 
      });
    }

    const { userId } = req.query;

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'User ID is required' 
      });
    }

    const client = await pool.connect();
    
    try {
      // First check if user is a training provider
      const userRoleQuery = 'SELECT role FROM users WHERE id = $1';
      const userRoleResult = await client.query(userRoleQuery, [userId]);
      
      if (userRoleResult.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'User not found' 
        });
      }

      if (userRoleResult.rows[0].role !== 'Training Provider') {
        return res.status(403).json({ 
          success: false, 
          error: 'User is not a training provider' 
        });
      }

      // Fetch training provider profile from both app_user and training_provider tables
      const profileQuery = `
        SELECT 
          au.profile_picture_url as company_logo_url,
          tp.company_shortname,
          tp.company_name,
          tp.contact_person_name,
          au.email,
          tp.contact_tel as phone,
          tp.company_address as address,
          '' as website,
          '' as description,
          tp.uen as registration_number,
          '' as tax_id,
          tpa.key_value as api_key,
          tp.invoice_template_url,
          tp.receipt_template_url,
          tp.certificate_template_url,
          tp.pro_forma_template_url as pro_forma_invoice_template_url,
          tp.ssg_self_sign_cert_file as self_signing_cert_file_url,
          tp.ssg_private_key_file as private_key_file_url,
          tp.created_at,
          tp.updated_at
        FROM app_user au
        LEFT JOIN training_provider tp ON tp.id = au.id
        LEFT JOIN training_provider_api tpa ON tpa.training_provider_id = tp.id AND tpa.key_name = 'gemini_api_key'
        WHERE au.id = $1
      `;
      
      const profileResult = await client.query(profileQuery, [userId]);
      
      if (profileResult.rows.length === 0) {
        return res.status(404).json({ 
          success: false, 
          error: 'Training provider profile not found' 
        });
      }

      const profile = profileResult.rows[0];
      
      // Transform database column names to match frontend interface
      const trainingProviderProfile = {
        companyLogoUrl: profile.company_logo_url,
        companyShortname: profile.company_shortname,
        companyName: profile.company_name,
        contactPerson: profile.contact_person_name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        website: profile.website,
        description: profile.description,
        registrationNumber: profile.registration_number,
        taxId: profile.tax_id,
        apiKey: profile.api_key,
        invoiceTemplateUrl: profile.invoice_template_url,
        receiptTemplateUrl: profile.receipt_template_url,
        certificateTemplateUrl: profile.certificate_template_url,
        proFormaInvoiceTemplateUrl: profile.pro_forma_invoice_template_url,
        selfSigningCertFileUrl: profile.self_signing_cert_file_url,
        privateKeyFileUrl: profile.private_key_file_url,
        createdAt: profile.created_at,
        updatedAt: profile.updated_at
      };

      return res.status(200).json({ 
        success: true, 
        data: trainingProviderProfile 
      });

    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error fetching training provider profile:', error);
    return res.status(500).json({ 
      success: false, 
      error: 'Internal server error' 
    });
  }
}