const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load env vars
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = dotenv.parse(fs.readFileSync(envPath));
    for (const k in envConfig) {
        process.env[k] = envConfig[k];
    }
}

async function verifySmtp() {
    console.log('🔍 Checking SMTP Configuration...');

    const config = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
        }
    };

    console.log(`   Host: ${config.host}`);
    console.log(`   Port: ${config.port}`);
    console.log(`   User: ${config.auth.user}`);
    console.log(`   Pass: ${config.auth.pass ? '******' : '(missing)'}`);
    console.log(`   Secure: ${config.secure}`);

    if (!config.host || !config.auth.user || !config.auth.pass) {
        console.error('❌ Missing required SMTP configuration in .env.local');
        return;
    }

    const transporter = nodemailer.createTransport(config);

    try {
        console.log('🔌 Connecting to SMTP server...');
        await transporter.verify();
        console.log('✅ SMTP Connection Successful!');

        console.log('📧 Sending test email to self...');
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || config.auth.user,
            to: config.auth.user, // Send to self
            subject: 'AI LMS - SMTP Test',
            text: 'If you are reading this, your email configuration is working correctly!'
        });

        console.log(`✅ Test email sent! Message ID: ${info.messageId}`);
        console.log('👉 Check your inbox to confirm receipt.');
    } catch (error) {
        console.error('❌ SMTP Verification Failed:');
        console.error(error.message);
        if (error.code === 'EAUTH') {
            console.error('   Hint: Check your email and password/app-password.');
        }
    }
}

verifySmtp();
