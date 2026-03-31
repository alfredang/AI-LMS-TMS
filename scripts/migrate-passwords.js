import { Pool } from 'pg';
import bcrypt from 'bcrypt';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tertiarydb',
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT || '5432'),
});

async function checkAndMigratePasswords() {
  try {
    console.log('🔍 Checking existing user passwords...');
    
    // Get all users with passwords
    const result = await pool.query(
      'SELECT id, email, password FROM public.app_user WHERE password IS NOT NULL'
    );
    
    console.log(`📊 Found ${result.rows.length} users with passwords`);
    
    for (const user of result.rows) {
      console.log(`\n👤 User: ${user.email}`);
      console.log(`🔍 Current password: ${user.password}`);
      console.log(`🔍 Is already hashed: ${user.password.startsWith('$2b$') || user.password.startsWith('$2a$')}`);
      
      // If password doesn't look like a bcrypt hash, hash it
      if (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$')) {
        console.log(`🔄 Hashing plain text password for ${user.email}...`);
        
        const hashedPassword = await bcrypt.hash(user.password, 10);
        
        await pool.query(
          'UPDATE public.app_user SET password = $1 WHERE id = $2',
          [hashedPassword, user.id]
        );
        
        console.log(`✅ Password updated for ${user.email}`);
        console.log(`🔍 New hash: ${hashedPassword}`);
        
        // Test the new hash
        const testResult = await bcrypt.compare(user.password, hashedPassword);
        console.log(`🧪 Hash test: ${testResult ? 'PASS' : 'FAIL'}`);
      } else {
        console.log(`✅ Password already hashed for ${user.email}`);
      }
    }
    
    console.log('\n🎉 Password migration complete!');
    
  } catch (error) {
    console.error('❌ Error during password migration:', error);
  } finally {
    await pool.end();
  }
}

checkAndMigratePasswords();