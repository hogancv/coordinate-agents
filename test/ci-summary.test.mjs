import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTap, generateMarkdownSummary } from '../scripts/ci-summary.mjs';

test('parseTap parses test counts, durations, and skips correctly', () => {
  const tap = `
TAP version 13
# Subtest: unit test 1
ok 1 - unit test 1
  ---
  duration_ms: 125.5
  ...
# Subtest: unit test 2
ok 2 - unit test 2 # SKIP
  ---
  duration_ms: 0.1
  ...
# Subtest: failing test
not ok 3 - failing test
  ---
  duration_ms: 50.2
  failureType: 'testCodeFailure'
  error: 'assertion error'
  code: 'ERR_ASSERTION'
  ...
1..3
# tests 3
# pass 1
# fail 1
# skipped 1
# duration_ms 175.8
`;

  const result = parseTap(tap);
  assert.equal(result.tests.length, 3);
  assert.equal(result.passCount, 1);
  assert.equal(result.failCount, 1);
  assert.equal(result.skipCount, 1);
  assert.equal(result.totalDuration, 175.8);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].failureDetails.failureType, 'testCodeFailure');
  assert.equal(result.failures[0].failureDetails.code, 'ERR_ASSERTION');

  const md = generateMarkdownSummary('Web Behavior Tests', result);
  assert.match(md, /Web Behavior Tests: ❌ Failed/);
  assert.match(md, /Top 10 Slowest Tests/);
  assert.match(md, /failing test/);
});

test('generateMarkdownSummary shows passed badge when all tests pass', () => {
  const result = {
    tests: [{ name: 'fast test', isOk: true, skipped: false, durationMs: 10 }],
    failures: [],
    passCount: 1,
    failCount: 0,
    skipCount: 0,
    totalDuration: 10,
  };

  const md = generateMarkdownSummary('Shared Tests', result);
  assert.match(md, /Shared Tests: ✅ Passed/);
  assert.doesNotMatch(md, /❌ Failures/);
});

test('footer counters are authoritative while nested result diagnostics remain available', () => {
  const tap=`TAP version 13
# Subtest: group
    # Subtest: nested failure
    not ok 1 - nested failure
      ---
      duration_ms: 9876.5
      failureType: 'testCodeFailure'
      error: 'nested assertion'
      ...
    1..1
not ok 1 - group
  ---
  duration_ms: 10000
  type: 'suite'
  failureType: 'subtestsFailed'
  error: '1 subtest failed'
  ...
1..1
# tests 1
# suites 1
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 10002.5
`;
  const result=parseTap(tap);
  assert.equal(result.totalCount,1);assert.equal(result.passCount,0);assert.equal(result.failCount,1);
  const nested=result.tests.find(entry=>entry.name==='nested failure');
  assert.equal(nested.durationMs,9876.5);assert.equal(nested.failureDetails.message,'nested assertion');
  assert.ok(result.failures.some(entry=>entry.name==='nested failure'));
  const md=generateMarkdownSummary('Nested',result);
  assert.match(md,/\*\*1\*\*/);assert.match(md,/9\.88s.*nested failure/);
});

test('reason-bearing SKIP and TODO directives do not count as ordinary passes or failures', () => {
  const tap=`ok 1 - implemented
  ---
  duration_ms: 4
  ...
    ok 2 - Windows npm case # SKIP unsupported environment
      ---
      duration_ms: 0.2
      ...
    not ok 3 - planned behavior # TODO awaiting provider
      ---
      duration_ms: 0.1
      error: 'expected pending failure'
      ...
`;
  const result=parseTap(tap);
  assert.equal(result.totalCount,3);assert.equal(result.passCount,1);assert.equal(result.failCount,0);
  assert.equal(result.skipCount,1);assert.equal(result.todoCount,1);assert.equal(result.failures.length,0);
  assert.equal(result.tests[1].name,'Windows npm case');assert.equal(result.tests[1].skipped,true);
  assert.equal(result.tests[2].name,'planned behavior');assert.equal(result.tests[2].todo,true);
  const md=generateMarkdownSummary('Directives',result);
  assert.match(md,/TODO/);assert.doesNotMatch(md,/❌ Failed/);
});

test('summary totals and outcome use footer counters even when result records are absent',()=>{
 const result=parseTap('# tests 9\n# pass 5\n# fail 2\n# cancelled 0\n# skipped 1\n# todo 1\n# duration_ms 100\n');
 assert.equal(result.totalCount,9);assert.equal(result.passCount,5);assert.equal(result.failCount,2);
 assert.equal(result.skipCount,1);assert.equal(result.todoCount,1);
 const md=generateMarkdownSummary('Footer',result);assert.match(md,/\*\*9\*\*/);assert.match(md,/❌ Failed/);
});

test('parses genuine Node TAP with suite nesting and reason-bearing directives', async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const root=mkdtempSync(join(tmpdir(),'ci-tap-fixture-')),file=join(root,'fixture.mjs');
 try{
  writeFileSync(file,`import {describe,test} from 'node:test';
    describe('outer suite',()=>{
      test('nested passing',()=>{});
      test('nested skipped',{skip:'unsupported environment'},()=>{});
      test('nested todo',{todo:'awaiting implementation'},()=>{throw new Error('pending failure')});
      test('nested failing',()=>{throw new Error('actual nested failure')});
    });`);
  const env={...process.env};delete env.NODE_OPTIONS;delete env.NODE_TEST_CONTEXT;
  const run=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:root,env,encoding:'utf8',windowsHide:true});
  assert.equal(run.status,1,run.stderr);
  const result=parseTap(run.stdout);
  assert.equal(result.totalCount,4);assert.equal(result.passCount,1);assert.equal(result.failCount,1);
  assert.equal(result.skipCount,1);assert.equal(result.todoCount,1);
  assert.equal(result.tests.find(entry=>entry.name==='nested skipped').skipped,true);
  assert.equal(result.tests.find(entry=>entry.name==='nested todo').todo,true);
  assert.ok(result.failures.some(entry=>entry.name==='nested failing'));
 }finally{rmSync(root,{recursive:true,force:true})}
});

test('diagnostic block text is not parsed as a nested TAP test or counter',()=>{
 const tap=`not ok 1 - real failure
  ---
  duration_ms: 12
  error: |-
    captured child output:
    ok 88 - invented test
      ---
      duration_ms: 99999
      ...
    # tests 500
  code: 'ERR_TEST'
  ...
# tests 1
# pass 0
# fail 1
# skipped 0
# cancelled 0
# todo 0
`;
 const result=parseTap(tap);assert.equal(result.tests.length,1);assert.equal(result.tests[0].durationMs,12);
 assert.equal(result.failures[0].failureDetails.code,'ERR_TEST');
});

test('cancelled footer outcomes cannot produce a passed summary',()=>{
 const result=parseTap('# tests 1\n# pass 0\n# fail 0\n# cancelled 1\n# skipped 0\n# todo 0\n');
 assert.equal(result.cancelledCount,1);assert.match(generateMarkdownSummary('Cancelled',result),/❌ Failed/);
});

test('multiline failure diagnostics stay on one Markdown table row',()=>{
 const tap=`not ok 1 - request test
  ---
  duration_ms: 2
  failureType: 'testCodeFailure'
  error: |-
    request failed
    expected a valid response
  ...
# tests 1
# pass 0
# fail 1
# skipped 0
# cancelled 0
# todo 0
`;
 const md=generateMarkdownSummary('Multiline',parseTap(tap));
 const row=md.split('\n').find(line=>line.startsWith('| **request test**'));
 assert.match(row,/request failed expected a valid response/);assert.ok(row.endsWith(' |'));
});
