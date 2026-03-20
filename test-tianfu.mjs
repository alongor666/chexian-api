import { config } from 'dotenv';
import path from 'path';

config({ path: path.join(process.cwd(), '.env') });
// We'll simulate logging in as tianfu and fetching cross-sell and comprehensive data.
// Since we don't know if the dev server is running, we can just use supertest or fetch if we start it,
// OR we can just directly call the services if we write a unit test style script.

// Let's use fetch against localhost:3000 assuming it's running. If not, we'll start it.
async function run() {
  const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'tianfu', password: 'tianfu123' })
  });
  
  if (!loginRes.ok) {
    console.error('Login failed', await loginRes.text());
    return;
  }
  
  const authData = await loginRes.json();
  const token = authData.data.token;
  console.log('Login successful, token retrieved.');
  
  const headers = { 'Authorization': `Bearer ${token}` };
  
  // Test 1: cross-sell-bundle
  const csRes = await fetch('http://127.0.0.1:3000/api/query/cross-sell-bundle?timePeriod=daily', { headers });
  if (csRes.ok) {
    const csData = await csRes.json();
    console.log('Cross-sell fetch success');
  } else {
    console.error('Cross-sell fetch failed', await csRes.text());
  }
  
  // Test 2: performance-bundle
  const pfRes = await fetch('http://127.0.0.1:3000/api/query/performance-bundle', { headers });
  if (pfRes.ok) {
    const pfData = await pfRes.json();
    console.log('Performance fetch success');
  } else {
    console.error('Performance fetch failed', await pfRes.text());
  }

  // Test 3: comprehensive-bundle
  const compRes = await fetch('http://127.0.0.1:3000/api/query/comprehensive-bundle', { headers });
  if (compRes.ok) {
    const compData = await compRes.json();
    console.log('Comprehensive fetch success');
  } else {
    console.error('Comprehensive fetch failed', await compRes.text());
  }
}

run().catch(console.error);
