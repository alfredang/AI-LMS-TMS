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

  async sendOtpEmail(email: string, otp: string, expiryMinutes: number = 10): Promise<{ success: boolean; error?: string; messageId?: string }> {
    const subject = 'Tertiary Infotech LMS - Verification Code';
    const text = `Hi,

Your OTP is ${otp}. 

Please use this to login to your account on the Tertiary Infotech Academy AI LMS TMS https://ai-lms-tms.tertiaryinfo.tech/ within ${expiryMinutes} minutes. 

If your OTP does not work, please request for a new OTP on the login page.

If you did not make this request, you may ignore this email. Do not share this OTP with anyone. This is strictly confidential and to be used by you only. 

Warm regards
Tertiary Infotech Academy`;

    const html = `
      <div style="font-family: Arial, sans-serif; font-size: 14px; color: #333; line-height: 1.6;">
        <p>Hi,</p>
        <p>Your OTP is <strong>${otp}</strong>.</p>
        <p>Please use this to login to your account on the Tertiary Infotech Academy AI LMS TMS <a href="https://ai-lms-tms.tertiaryinfo.tech/">https://ai-lms-tms.tertiaryinfo.tech/</a> within ${expiryMinutes} minutes.</p>
        <p>If your OTP does not work, please request for a new OTP on the login page.</p>
        <p>If you did not make this request, you may ignore this email. Do not share this OTP with anyone. This is strictly confidential and to be used by you only.</p>
        <p>Warm regards<br>Tertiary Infotech Academy</p>
      </div>
    `;

    return this.sendEmail({ to: email, subject, text, html });
  }
}

export const emailService = new EmailService();
