import { readFileSync, appendFileSync, existsSync } from 'node:fs';

function scalar(value = '') {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { /* Keep unrecognized diagnostics as text. */ } }
  return value;
}

export function parseTap(tapContent) {
  const lines = tapContent.split(/\r?\n/);
  const tests = [], failures = [], footer = {};
  const observed = { total: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0 };
  let totalDuration = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only the unindented runner footer is authoritative, not a nested scope
    // or output captured inside a test's YAML diagnostic block.
    const count = line.match(/^#\s+(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/);
    if (count) footer[count[1]] = Number(count[2]);
    const duration = line.match(/^# duration_ms\s+(\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*$/i);
    if (duration) totalDuration = Number(duration[1]);

    const match = line.match(/^([ \t]*)(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(SKIP|TODO)\b(?:\s+(.*?))?)?\s*$/i);
    if (!match) continue;
    const [, indent, outcome, name, directive, directiveReason] = match;
    const isOk = outcome.toLowerCase() === 'ok';
    const skipped = directive?.toUpperCase() === 'SKIP', todo = directive?.toUpperCase() === 'TODO';
    const fields = {};
    if (lines[i + 1]?.trim() === '---') {
      const prefix = lines[i + 1].match(/^[ \t]*/)[0];
      if (prefix.length > indent.length) {
        let end = i + 2;
        while (end < lines.length && lines[end].trimEnd() !== `${prefix}...`) end++;
        for (let j = i + 2; j < end; j++) {
          if (!lines[j].startsWith(prefix)) continue;
          const field = lines[j].slice(prefix.length).match(/^([a-zA-Z_]\w*):\s*(.*)$/);
          if (!field) continue;
          let value = field[2];
          if (/^[|>][-+]?\s*$/.test(value)) {
            const block = [];
            while (j + 1 < end && (lines[j + 1].startsWith(`${prefix} `) || !lines[j + 1].trim())) {
              block.push(lines[++j].slice(prefix.length + 2));
            }
            value = block.join('\n');
          }
          fields[field[1]] = scalar(value);
        }
        // Do not interpret TAP-looking text inside an error/stdout block as
        // actual test records. Sibling/parent result records follow this block.
        i = end;
      }
    }
    const type = fields.type || 'test';
    const failureDetails = !isOk && !skipped && !todo ? {
      failureType: fields.failureType || 'unknown', code: fields.code || null,
      message: String(fields.error || 'No diagnostic message').slice(0, 300),
    } : null;
    const entry = { name: name.trim(), isOk, skipped, todo, directiveReason: directiveReason || '',
      type, durationMs: Number(fields.duration_ms) || 0, failureDetails };
    tests.push(entry);
    if (failureDetails) failures.push(entry);
    // Suites have result records and inclusive durations but are not tests in
    // Node's footer. Preserve their diagnostics without inflating fallback totals.
    if (type === 'suite') continue;
    observed.total++;
    if (skipped) observed.skipped++;
    else if (todo) observed.todo++;
    else if (isOk) observed.pass++;
    else if (fields.failureType === 'cancelledByParent') observed.cancelled++;
    else observed.fail++;
  }

  return { tests, failures, totalCount: footer.tests ?? observed.total,
    passCount: footer.pass ?? observed.pass, failCount: footer.fail ?? observed.fail,
    skipCount: footer.skipped ?? observed.skipped, todoCount: footer.todo ?? observed.todo,
    cancelledCount: footer.cancelled ?? observed.cancelled, totalDuration };
}

export function generateMarkdownSummary(title, result) {
  const { tests, failures, passCount, failCount, skipCount, totalDuration,
    totalCount = tests.length, todoCount = 0, cancelledCount = 0 } = result;
  const statusBadge = failCount === 0 && cancelledCount === 0 ? '✅ Passed' : '❌ Failed';
  const durationSec = (totalDuration / 1000).toFixed(2);

  let md = `### ${title}: ${statusBadge}\n\n`;
  md += `| Total | Passed | Failed | Skipped | TODO | Cancelled | Duration |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;
  md += `| **${totalCount}** | ${passCount} | ${failCount} | ${skipCount} | ${todoCount} | ${cancelledCount} | ${durationSec}s |\n\n`;

  if (failures.length > 0) {
    md += `#### ❌ Failure diagnostics (${failures.length})\n\n`;
    md += `| Test | Type | Code / Details |\n`;
    md += `| :--- | :--- | :--- |\n`;
    for (const f of failures) {
      const type = f.failureDetails?.failureType || 'fail';
      const msg = (f.failureDetails?.code || f.failureDetails?.message || '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|').slice(0, 120);
      md += `| **${f.name.replace(/\|/g, '\\|')}** | \`${type}\` | ${msg} |\n`;
    }
    md += '\n';
  }

  // Top 10 slowest tests
  const sortedSlowest = [...tests].filter(t => t.durationMs > 0 && t.type !== 'suite').sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  if (sortedSlowest.length > 0) {
    md += `#### ⏱ Top 10 Slowest Tests\n\n`;
    md += `| Duration | Status | Test Name |\n`;
    md += `| :---: | :---: | :--- |\n`;
    for (const t of sortedSlowest) {
      const dur = (t.durationMs / 1000).toFixed(2) + 's';
      const icon = t.skipped ? '↷' : t.todo ? '○' : t.isOk ? '✔' : '✖';
      md += `| ${dur} | ${icon} | ${t.name.replace(/\|/g, '\\|')} |\n`;
    }
    md += '\n';
  }

  return md;
}

// CLI entry
if (process.argv[1] && process.argv[1].endsWith('ci-summary.mjs')) {
  try {
    const tapPath = process.argv[2];
    const stageTitle = process.argv[3] || 'Test Results';

    if (!tapPath) {
      console.log('Usage: node scripts/ci-summary.mjs <path-to-tap-file> [stage-title]');
      process.exit(0);
    }

    if (!existsSync(tapPath)) {
      console.log(`Skipping CI summary for "${stageTitle}": ${tapPath} does not exist`);
      process.exit(0);
    }

    const content = readFileSync(tapPath, 'utf8');
    const result = parseTap(content);
    const md = generateMarkdownSummary(stageTitle, result);

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      appendFileSync(summaryPath, md, 'utf8');
      console.log(`Appended summary for "${stageTitle}" to GITHUB_STEP_SUMMARY`);
    } else {
      console.log(md);
    }
  } catch (err) {
    console.error('Failed to generate CI summary:', err.message);
  }
}
