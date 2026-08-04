import { withAuth } from '@lib/auth/withAuth';
import pool from '../../../../lib/db';
import { cors } from '../../../../lib/cors';
import { NextApiRequest, NextApiResponse } from 'next';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  await cors(req, res);

  if (req.method === 'GET') {
    try {
      let proformaInvoiceEmailSubject: string | null = null;
      let proformaInvoiceEmailBody: string | null = null;
      let proformaInvoiceEmailCc: string | null = null;
      let proformaInvoiceEmailAttachmentUrl: string | null = null;
      try {
        const result = await pool.query(
          'SELECT proforma_invoice_email_subject, proforma_invoice_email_body, proforma_invoice_email_cc, proforma_invoice_email_attachment_url FROM training_provider LIMIT 1'
        );
        if (result.rows.length > 0) {
          proformaInvoiceEmailSubject = result.rows[0].proforma_invoice_email_subject;
          proformaInvoiceEmailBody = result.rows[0].proforma_invoice_email_body;
          proformaInvoiceEmailCc = result.rows[0].proforma_invoice_email_cc;
          proformaInvoiceEmailAttachmentUrl = result.rows[0].proforma_invoice_email_attachment_url;
        }
      } catch (e) {
        console.log('proforma_invoice_email columns do not exist yet');
      }

      return res.status(200).json({
        success: true,
        data: {
          proformaInvoiceEmailSubject,
          proformaInvoiceEmailBody,
          proformaInvoiceEmailCc,
          proformaInvoiceEmailAttachmentUrl,
        }
      });
    } catch (error) {
      console.error('Error fetching proforma invoice email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch proforma invoice email template' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const {
        proformaInvoiceEmailSubject,
        proformaInvoiceEmailBody,
        proformaInvoiceEmailCc,
        proformaInvoiceEmailAttachmentUrl,
      } = req.body;

      if (typeof proformaInvoiceEmailSubject !== 'string' || typeof proformaInvoiceEmailBody !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'proformaInvoiceEmailSubject and proformaInvoiceEmailBody must be strings'
        });
      }

      try {
        await pool.query(
          'UPDATE training_provider SET proforma_invoice_email_subject = $1, proforma_invoice_email_body = $2, proforma_invoice_email_cc = $3, proforma_invoice_email_attachment_url = $4',
          [proformaInvoiceEmailSubject, proformaInvoiceEmailBody, proformaInvoiceEmailCc || '', proformaInvoiceEmailAttachmentUrl || '']
        );
      } catch (e) {
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_subject TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_body TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_cc TEXT');
        await pool.query('ALTER TABLE training_provider ADD COLUMN IF NOT EXISTS proforma_invoice_email_attachment_url TEXT');
        await pool.query(
          'UPDATE training_provider SET proforma_invoice_email_subject = $1, proforma_invoice_email_body = $2, proforma_invoice_email_cc = $3, proforma_invoice_email_attachment_url = $4',
          [proformaInvoiceEmailSubject, proformaInvoiceEmailBody, proformaInvoiceEmailCc || '', proformaInvoiceEmailAttachmentUrl || '']
        );
      }

      return res.status(200).json({ success: true, message: 'Proforma invoice email template updated successfully' });
    } catch (error) {
      console.error('Error updating proforma invoice email template:', error);
      return res.status(500).json({ success: false, error: 'Failed to update proforma invoice email template' });
    }
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler, { roles: ['admin', 'trainingProvider', 'finance'] });
