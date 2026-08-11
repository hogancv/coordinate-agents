#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
const skillName = 'coordinate-cli-agents';
const payloadEntries = ['SKILL.md', 'agents', 'references', 'scripts'];
const metadataFile = '.coordinate-cli-agents.json';

const messages = {
  en: {
    usage: `coordinate-cli-agents <command> [options]

Commands:
  install       Install the skill (default: Codex and Antigravity)
  update        Reinstall the packaged version and back up the old copy
  doctor        Verify installed files and versions
  uninstall     Remove installations created by this package
  help          Show this help

Options:
  --codex                 Target Codex only
  --antigravity           Target Antigravity only
  --codex-home <path>     Override CODEX_HOME (default: ~/.codex)
  --antigravity-home <p>  Override GEMINI_HOME (default: ~/.gemini)
  --lang <en|zh-CN>       Override output language
  --force                 Replace/remove an unrecognized existing directory
  --version               Print package version
  -h, --help              Show this help

Examples:
  npx @hogancv/coordinate-cli-agents install
  npx @hogancv/coordinate-cli-agents doctor
  npx @hogancv/coordinate-cli-agents update --codex`,
    installed: 'Installed {target}: {path}',
    updated: 'Updated {target}: {path}',
    current: '{target} is already current: {path}',
    backup: 'Backed up previous installation: {path}',
    healthy: '{target}: healthy ({version}) at {path}',
    missing: '{target}: not installed at {path}',
    invalid: '{target}: verification failed: {details}',
    removed: 'Removed {target}: {path}',
    skipRemove: '{target}: refusing to remove an unrecognized directory without --force: {path}',
    noInstall: 'No target installation was found.',
    summaryOk: 'All selected installations are healthy.',
    summaryFail: 'One or more selected installations need attention.',
    unknownCommand: 'Unknown command: {command}',
    missingValue: 'Missing value for {option}',
    badLanguage: 'Unsupported language: {language}',
  },
  zh: {
    usage: `coordinate-cli-agents <命令> [选项]

命令：
  install       安装技能（默认同时安装 Codex 和 Antigravity）
  update        备份旧副本并重新安装当前包版本
  doctor        校验已安装文件和版本
  uninstall     删除由本 npm 包创建的安装
  help          显示帮助

选项：
  --codex                 仅操作 Codex
  --antigravity           仅操作 Antigravity
  --codex-home <路径>     覆盖 CODEX_HOME（默认：~/.codex）
  --antigravity-home <p>  覆盖 GEMINI_HOME（默认：~/.gemini）
  --lang <en|zh-CN>       指定输出语言
  --force                 替换或删除无法识别的现有目录
  --version               输出包版本
  -h, --help              显示帮助

示例：
  npx @hogancv/coordinate-cli-agents install
  npx @hogancv/coordinate-cli-agents doctor
  npx @hogancv/coordinate-cli-agents update --codex`,
    installed: '已安装 {target}：{path}',
    updated: '已更新 {target}：{path}',
    current: '{target} 已是当前版本：{path}',
    backup: '旧安装已备份：{path}',
    healthy: '{target}：正常（{version}），位置：{path}',
    missing: '{target}：尚未安装，目标位置：{path}',
    invalid: '{target}：校验失败：{details}',
    removed: '已卸载 {target}：{path}',
    skipRemove: '{target}：现有目录不是本包创建的安装；未提供 --force，拒绝删除：{path}',
    noInstall: '没有发现目标安装。',
    summaryOk: '所选安装均验证正常。',
    summaryFail: '一个或多个安装需要处理。',
    unknownCommand: '未知命令：{command}',
    missingValue: '选项缺少参数：{option}',
    badLanguage: '不支持的语言：{language}',
  },
};

function parseArgs(argv) {
  const result = {
    command: 'help',
    codex: false,
    antigravity: false,
    force: false,
    help: false,
    version: false,
    codexHome: process.env.CODEX_HOME || join(homedir(), '.codex'),
    antigravityHome: process.env.GEMINI_HOME || join(homedir(), '.gemini'),
    language: null,
  };
  const args = [...argv];
  if (args[0] && !args[0].startsWith('-')) result.command = args.shift();
  while (args.length) {
    const option = args.shift();
    if (option === '--codex') result.codex = true;
    else if (option === '--antigravity') result.antigravity = true;
    else if (option === '--force') result.force = true;
    else if (option === '--help' || option === '-h') result.help = true;
    else if (option === '--version') result.version = true;
    else if (['--codex-home', '--antigravity-home', '--lang'].includes(option)) {
      if (!args.length || args[0].startsWith('-')) throw new Error(`MISSING_VALUE:${option}`);
      const value = args.shift();
      if (option === '--codex-home') result.codexHome = resolve(value);
      if (option === '--antigravity-home') result.antigravityHome = resolve(value);
      if (option === '--lang') result.language = value;
    } else {
      throw new Error(`UNKNOWN_OPTION:${option}`);
    }
  }
  if (!result.codex && !result.antigravity) {
    result.codex = true;
    result.antigravity = true;
  }
  return result;
}

function detectLanguage(explicit) {
  const value = explicit || process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale;
  if (/^zh([_-]|$)/i.test(value)) return 'zh';
  if (/^en([_-]|$)/i.test(value)) return 'en';
  if (explicit) throw new Error(`BAD_LANGUAGE:${explicit}`);
  return 'en';
}

function format(template, values = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(values[key] ?? `{${key}}`));
}

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function walkFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join('/'));
  }
  return files.sort();
}

function payloadManifest(root = packageRoot) {
  const manifest = {};
  for (const entry of payloadEntries) {
    const source = join(root, entry);
    if (!existsSync(source)) throw new Error(`Package payload is missing: ${entry}`);
    if (statSync(source).isDirectory()) {
      for (const file of walkFiles(root, source)) manifest[file] = hashFile(join(root, file));
    } else {
      manifest[entry] = hashFile(source);
    }
  }
  return manifest;
}

function targets(options) {
  const selected = [];
  if (options.codex) selected.push({ name: 'Codex', path: join(options.codexHome, 'skills', skillName) });
  if (options.antigravity) selected.push({ name: 'Antigravity', path: join(options.antigravityHome, 'skills', skillName) });
  return selected;
}

function readMetadata(targetPath) {
  const path = join(targetPath, metadataFile);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function verifyTarget(targetPath, expectedManifest) {
  if (!existsSync(targetPath)) return { ok: false, missing: true, details: 'directory missing' };
  const metadata = readMetadata(targetPath);
  if (!metadata || metadata.package !== packageJson.name) {
    return { ok: false, details: 'installation metadata missing or unrecognized' };
  }
  const failures = [];
  for (const [file, expectedHash] of Object.entries(expectedManifest)) {
    const path = join(targetPath, file);
    if (!existsSync(path)) failures.push(`${file} missing`);
    else if (hashFile(path) !== expectedHash) failures.push(`${file} modified`);
  }
  return {
    ok: failures.length === 0,
    details: failures.slice(0, 5).join(', '),
    version: metadata.version,
  };
}

function payloadMatches(targetPath, expectedManifest) {
  if (!existsSync(targetPath)) return false;
  return Object.entries(expectedManifest).every(([file, expectedHash]) => {
    const path = join(targetPath, file);
    return existsSync(path) && statSync(path).isFile() && hashFile(path) === expectedHash;
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function removePath(path) {
  if (!existsSync(path)) return;
  rmSync(path, { recursive: true, force: true });
}

function installTarget(target, expectedManifest, options, t) {
  const sourceResolved = resolve(packageRoot);
  const targetResolved = resolve(target.path);
  if (sourceResolved === targetResolved) {
    console.log(format(t.current, { target: target.name, path: target.path }));
    return;
  }

  const prior = verifyTarget(target.path, expectedManifest);
  if (prior.ok && prior.version === packageJson.version) {
    console.log(format(t.current, { target: target.name, path: target.path }));
    return;
  }
  const unmanagedGitCheckout = existsSync(join(target.path, '.git'));
  if (existsSync(target.path) && !readMetadata(target.path) && (unmanagedGitCheckout || !payloadMatches(target.path, expectedManifest)) && !options.force) {
    throw new Error(format(t.skipRemove, { target: target.name, path: target.path }));
  }

  mkdirSync(dirname(target.path), { recursive: true });
  const staging = mkdtempSync(join(dirname(target.path), `.${skillName}-staging-`));
  try {
    for (const entry of payloadEntries) {
      cpSync(join(packageRoot, entry), join(staging, entry), { recursive: true });
    }
    writeFileSync(join(staging, metadataFile), JSON.stringify({
      package: packageJson.name,
      version: packageJson.version,
      installedAt: new Date().toISOString(),
      manifest: expectedManifest,
    }, null, 2) + '\n', 'utf8');

    let backup = null;
    if (existsSync(target.path)) {
      backup = `${target.path}.backup-${timestamp()}`;
      renameSync(target.path, backup);
      console.log(format(t.backup, { path: backup }));
    }
    try {
      renameSync(staging, target.path);
    } catch (error) {
      if (backup && !existsSync(target.path)) renameSync(backup, target.path);
      throw error;
    }
    console.log(format(prior.missing ? t.installed : t.updated, { target: target.name, path: target.path }));
  } finally {
    removePath(staging);
  }
}

function run(argv) {
  let options;
  let language = detectLanguage(null);
  try {
    options = parseArgs(argv);
    language = detectLanguage(options.language);
  } catch (error) {
    const raw = String(error.message || error);
    const t = messages[language];
    if (raw.startsWith('MISSING_VALUE:')) console.error(format(t.missingValue, { option: raw.split(':')[1] }));
    else if (raw.startsWith('BAD_LANGUAGE:')) console.error(format(t.badLanguage, { language: raw.split(':')[1] }));
    else console.error(raw.replace('UNKNOWN_OPTION:', 'Unknown option: '));
    process.exitCode = 2;
    return;
  }

  const t = messages[language];
  if (options.version) {
    console.log(packageJson.version);
    return;
  }
  if (options.help || options.command === 'help') {
    console.log(t.usage);
    return;
  }

  const expectedManifest = payloadManifest();
  const selectedTargets = targets(options);

  if (options.command === 'install' || options.command === 'update') {
    try {
      for (const target of selectedTargets) installTarget(target, expectedManifest, options, t);
    } catch (error) {
      console.error(error.message || String(error));
      process.exitCode = 1;
    }
    return;
  }

  if (options.command === 'doctor') {
    let healthy = true;
    let found = false;
    for (const target of selectedTargets) {
      const result = verifyTarget(target.path, expectedManifest);
      if (result.missing) {
        healthy = false;
        console.error(format(t.missing, { target: target.name, path: target.path }));
      } else {
        found = true;
        if (result.ok) console.log(format(t.healthy, { target: target.name, version: result.version, path: target.path }));
        else {
          healthy = false;
          console.error(format(t.invalid, { target: target.name, details: result.details, path: target.path }));
        }
      }
    }
    if (!found) console.error(t.noInstall);
    console.log(healthy ? t.summaryOk : t.summaryFail);
    if (!healthy) process.exitCode = 1;
    return;
  }

  if (options.command === 'uninstall') {
    for (const target of selectedTargets) {
      if (!existsSync(target.path)) continue;
      if (!readMetadata(target.path) && !options.force) {
        console.error(format(t.skipRemove, { target: target.name, path: target.path }));
        process.exitCode = 1;
        continue;
      }
      removePath(target.path);
      console.log(format(t.removed, { target: target.name, path: target.path }));
    }
    return;
  }

  console.error(format(t.unknownCommand, { command: options.command }));
  console.error(t.usage);
  process.exitCode = 2;
}

run(process.argv.slice(2));
