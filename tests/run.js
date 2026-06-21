const path = require('path');
const { runAll, printResults, startTestServer } = require('./helpers');

require('./executors.test');

(async () => {
  console.log('\n=== Setting up test environment ===');
  const testCtx = await startTestServer();
  console.log(`  Test server: ${testCtx.baseUrl}`);
  console.log(`  Temp DB:    ${testCtx.storage.dbPath}`);

  global.__TEST_CTX__ = testCtx;
  require('./api.test');

  console.log('\n=== Running unit + integration tests ===\n');
  const results = await runAll();
  const allPassed = printResults(results);

  console.log('\n=== Tearing down ===');
  await testCtx.close();
  console.log('  Cleanup done.');

  process.exit(allPassed ? 0 : 1);
})().catch((err) => {
  console.error('Fatal test runner error:', err);
  process.exit(2);
});
