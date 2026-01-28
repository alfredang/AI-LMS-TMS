require('dotenv').config({ path: '.env.local' });
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testModel(modelName) {
    console.log(`Testing model: ${modelName}...`);
    try {
        const genAI = new GoogleGenerativeAI(process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent('Say hello');
        console.log(`✅ ${modelName} Success:`, result.response.text());
        return true;
    } catch (error) {
        console.error(`❌ ${modelName} Failed:`, error.message);
        return false;
    }
}

async function run() {
    if (!process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY) {
        console.error('❌ Missing NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY in .env.local');
        return;
    }

    // Test both Flash (fast) and Pro (complex)
    await testModel('gemini-2.5-flash');
    await testModel('gemini-2.5-pro'); // Used for Quizzes
}

run();
