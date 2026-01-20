import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD || 'shuo1314520.',
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function testPassword() {
  try {
    const email = 'ben.trainer@example.com';
    const testPassword = 'password123';
    
    console.log(`🧪 Testing password for ${email}`);
    
    // Get user from database
    const result = await pool.query(
      'SELECT password FROM public.app_user WHERE email = $1',
      [email]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ User not found');
      return;
    }
    
    const storedHash = result.rows[0].password;
    console.log(`🔍 Stored hash: ${storedHash}`);
    console.log(`🔍 Test password: ${testPassword}`);
    
    // Test bcrypt comparison
    const isMatch = await bcrypt.compare(testPassword, storedHash);
    console.log(`🧪 Password match: ${isMatch ? '✅ YES' : '❌ NO'}`);
    
    // Also test some other common passwords
    const commonPasswords = ['password', '123456', 'ben123', 'trainer123'];
    
    for (const pwd of commonPasswords) {
      const match = await bcrypt.compare(pwd, storedHash);
      console.log(`🧪 "${pwd}": ${match ? '✅ MATCH' : '❌ NO'}`);
    }
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await pool.end();
  }
}

testPassword();