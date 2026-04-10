const { Pool } = require('pg');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env.local') });

async function testDateFix() {
  const d = new Date('2026-03-10T16:00:00.000Z');
  console.log('Original ISO:', d.toISOString());
  console.log('Original slice 10:', d.toISOString().slice(0, 10));
  
  const formatDate = (date) => {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Singapore'
    }).format(date);
  };
  
  console.log('Singapore Fixed:', formatDate(d));
}

testDateFix();
