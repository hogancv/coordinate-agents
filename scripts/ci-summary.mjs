import { readFileSync, appendFileSync, existsSync } from 'node:fs';

export function parseTap(tapContent) {
  const lines = tapContent.split('\n');
  const tests = [];
  const failures = [];
  let currentTest = null;
  let totalDuration = 0;
  let passCount = 0;
  let failCount = 0;
  let skipCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Total duration line: # duration_ms 12345.67
    const durSummaryMatch = line.match(/^# duration_ms\s+([\d\.]+)/);
    if (durSummaryMatch) {
      totalDuration = parseFloat(durSummaryMatch[1]);
    }

    const testMatch = line.match(/^(ok|not ok)\s+\d+\s+-\s+(.+?)(?:\s+#\s+(SKIP|TODO))?$/);
    if (testMatch) {
      const isOk = testMatch[1] === 'ok';
      const name = testMatch[2].trim();
      const skipOrTodo = testMatch[3];

      let durationMs = 0;
      let failureDetails = null;

      // Look ahead for YAML diagnostics block
      if (i + 1 < lines.length && lines[i + 1].trim() === '---') {
        const diagLines = [];
        let j = i + 2;
        while (j < lines.length && lines[j].trim() !== '...') {
          diagLines.push(lines[j]);
          j++;
        }

        const diagText = diagLines.join('\n');
        const durMatch = diagText.match(/duration_ms:\s*([\d\.]+)/);
        if (durMatch) durationMs = parseFloat(durMatch[1]);

        if (!isOk) {
          const failTypeMatch = diagText.match(/failureType:\s*'?([^'\n]+)'?/);
          const errorMatch = diagText.match(/error:\s*'?([^'\n]+)'?/);
          const codeMatch = diagText.match(/code:\s*'?([^'\n]+)'?/);
          failureDetails = {
            failureType: failTypeMatch ? failTypeMatch[1] : 'unknown',
            code: codeMatch ? codeMatch[1] : null,
            message: errorMatch ? errorMatch[1] : diagText.slice(0, 300),
          };
        }
      }

      const testEntry = {
        name,
        isOk,
        skipped: Boolean(skipOrTodo),
        durationMs,
        failureDetails,
      };

      tests.push(testEntry);
      if (skipOrTodo) {
        skipCount++;
      } else if (isOk) {
        passCount++;
      } else {
        failCount++;
        failures.push(testEntry);
      }
    }
  }

  return { tests, failures, passCount, failCount, skipCount, totalDuration };
}

export function generateMarkdownSummary(title, result) {
  const { tests, failures, passCount, failCount, skipCount, totalDuration } = result;
  const statusBadge = failCount === 0 ? '✅ Passed' : '❌ Failed';
  const durationSec = (totalDuration / 1000).toFixed(2);

  let md = `### ${title}: ${statusBadge}\n\n`;
  md += `| Total | Passed | Failed | Skipped | Duration |\n`;
  md += `| :---: | :---: | :---: | :---: | :---: |\n`;
  md += `| **${tests.length}** | ${passCount} | ${failCount} | ${skipCount} | ${durationSec}s |\n\n`;

  if (failures.length > 0) {
    md += `#### ❌ Failures (${failures.length})\n\n`;
    md += `| Test | Type | Code / Details |\n`;
    md += `| :--- | :--- | :--- |\n`;
    for (const f of failures) {
      const type = f.failureDetails?.failureType || 'fail';
      const msg = (f.failureDetails?.code || f.failureDetails?.message || '').replace(/\|/g, '\\|').slice(0, 120);
      md += `| **${f.name.replace(/\|/g, '\\|')}** | \`${type}\` | ${msg} |\n`;
    }
    md += '\n';
  }

  // Top 10 slowest tests
  const sortedSlowest = [...tests].filter(t => t.durationMs > 0).sort((a, b) => b.durationMs - a.durationMs).slice(0, 10);
  if (sortedSlowest.length > 0) {
    md += `#### ⏱ Top 10 Slowest Tests\n\n`;
    md += `| Duration | Status | Test Name |\n`;
    md += `| :---: | :---: | :--- |\n`;
    for (const t of sortedSlowest) {
      const dur = (t.durationMs / 1000).toFixed(2) + 's';
      const icon = t.isOk ? '✔' : '✖';
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
