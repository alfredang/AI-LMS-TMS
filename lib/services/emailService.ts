import nodemailer from 'nodemailer';

// Email configuration - using environment variables
// For production, configure these in .env:
// SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

class EmailService {
  private getConfig(): EmailConfig {
    return {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    };
  }

  private createTransporter(): nodemailer.Transporter {
    const config = this.getConfig();

    console.log(`📧 SMTP Config: host=${config.host}, port=${config.port}, user=${config.auth.user ? config.auth.user.substring(0, 5) + '***' : 'NOT SET'}`);

    // Check if SMTP is configured
    if (!config.auth.user || !config.auth.pass) {
      console.warn('⚠️ SMTP not configured. Email sending will be simulated.');
      // Create a test account transporter that won't actually send
      return nodemailer.createTransport({
        host: 'localhost',
        port: 1025,
        secure: false,
        ignoreTLS: true,
      });
    }

    return nodemailer.createTransport(config);
  }

  async sendEmail(options: SendEmailOptions): Promise<{ success: boolean; error?: string; messageId?: string }> {
    try {
      const config = this.getConfig();
      const fromAddress = process.env.SMTP_FROM || config.auth.user || 'noreply@lms-tms.com';

      // If SMTP is not configured, log the email instead of sending
      if (!config.auth.user || !config.auth.pass) {
        console.log('📧 [Simulated Email] ---------------------------------');
        console.log(`To: ${options.to}`);
        console.log(`From: ${fromAddress}`);
        console.log(`Subject: ${options.subject}`);
        console.log(`Body: ${options.text || options.html}`);
        console.log('----------------------------------------------------');
        return { success: true, messageId: 'simulated-' + Date.now() };
      }

      const transporter = this.createTransporter();

      const info = await transporter.sendMail({
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      console.log(`✅ Email sent successfully to ${options.to}, messageId: ${info.messageId}`);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('❌ Failed to send email:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send email',
      };
    }
  }

  async sendOtpEmail(email: string, otp: string, expiryMinutes: number = 10): Promise<{ success: boolean; error?: string }> {
    const subject = 'Your Login OTP Code';
    const text = `Your OTP code is: ${otp}\n\nThis code will expire in ${expiryMinutes} minutes.\n\nIf you did not request this code, please ignore this email.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a3a69;">Your Login OTP Code</h2>
        <p>Use the following code to complete your login:</p>
        <div style="background-color: #f5f5f5; padding: 20px; text-align: center; margin: 20px 0; border-radius: 8px;">
          <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1a3a69;">${otp}</span>
        </div>
        <p style="color: #666;">This code will expire in <strong>${expiryMinutes} minutes</strong>.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="color: #999; font-size: 12px;">If you did not request this code, please ignore this email.</p>
      </div>
    `;

    return this.sendEmail({ to: email, subject, text, html });
  }
}

export const emailService = new EmailService();
