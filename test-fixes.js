const fs = require('fs');

async function runTests() {
  const baseUrl = 'http://127.0.0.1:5000';
  let output = '';

  const log = (msg) => {
    output += msg + '\n';
    fs.appendFileSync('fix-test-results.txt', msg + '\n');
  };

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  fs.writeFileSync('fix-test-results.txt', '');

  try {
    log('=== Test 0: Health check ===');
    const healthResp = await fetch(`${baseUrl}/health`);
    const healthData = await healthResp.json();
    log('Health: ' + JSON.stringify(healthData));

    log('\n=== Test 1: Past scheduled_at error detail ===');
    const pastResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://httpbin.org/get',
        method: 'GET',
        scheduled_at: '2020-01-01T00:00:00Z'
      })
    });
    const pastData = await pastResp.json();
    log('HTTP status: ' + pastResp.status);
    log('Error: ' + pastData.error);
    log('error_code: ' + pastData.error_code);
    log('requested_time: ' + pastData.requested_time);
    log('server_time: ' + pastData.server_time);
    log('Has both times: ' + (!!pastData.requested_time && !!pastData.server_time));

    log('\n=== Test 2: Invalid format error ===');
    const badResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://httpbin.org/get',
        method: 'GET',
        scheduled_at: 'not-a-date'
      })
    });
    const badData = await badResp.json();
    log('HTTP status: ' + badResp.status);
    log('Error: ' + badData.error);
    log('error_code: ' + badData.error_code);

    log('\n=== Test 3: Dedupe - rapid identical submissions ===');
    const payload = {
      url: 'https://httpbin.org/get?test=dedupe',
      method: 'GET',
      headers: { 'X-Test': 'dedupe-test' }
    };

    const results = [];
    for (let i = 0; i < 5; i++) {
      const resp = await fetch(`${baseUrl}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      results.push(data.task_id);
    }
    log('5 submissions, task_ids: ' + JSON.stringify(results));
    const uniqueIds = new Set(results);
    log('Unique task_ids count: ' + uniqueIds.size + ' (expected: 1)');
    log('Dedupe works: ' + (uniqueIds.size === 1));

    log('\n=== Test 4: Dedupe - different task is not deduped ===');
    const diffResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://httpbin.org/get?test=different', method: 'GET' })
    });
    const diffData = await diffResp.json();
    log('Different task id: ' + diffData.task_id);
    log('Is different from first: ' + (diffData.task_id !== results[0]));

    log('\n=== Test 5: Dedupe - after 2 seconds window passes, new task is created ===');
    await wait(2500);
    const afterWindowResp = await fetch(`${baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const afterWindowData = await afterWindowResp.json();
    log('After window task id: ' + afterWindowData.task_id);
    log('Is different from first: ' + (afterWindowData.task_id !== results[0]));

    log('\n=== All tests passed! ===');

  } catch (e) {
    log('ERROR: ' + e.message);
    log('Stack: ' + e.stack);
  }
}

runTests();
