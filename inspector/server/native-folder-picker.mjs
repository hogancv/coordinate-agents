import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
let pending = false;

// Fixed scripts only: browser parameters never become commands or script text.
export async function pickNativeFolder({ platform = process.platform, run = execute } = {}) {
  if (pending) throw new Error('A folder chooser is already open.');
  pending = true;
  try {
    let command; let args;
    if (platform === 'darwin') {
      command = '/usr/bin/osascript';
      args = ['-e', 'tell application "System Events"\nactivate\ntry\nreturn POSIX path of (choose folder with prompt "Select project folder" default location (path to home folder))\non error number -128\nreturn ""\nend try\nend tell'];
    } else if (platform === 'win32') {
      command = 'powershell.exe';
      args = ['-NoProfile', '-STA', '-Command', 'Add-Type -AssemblyName System.Windows.Forms; $picker = New-Object System.Windows.Forms.FolderBrowserDialog; $picker.Description = "Select project folder"; try { if ($picker.ShowDialog() -eq "OK") { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Write-Output $picker.SelectedPath } } finally { $picker.Dispose() }'];
    } else if (platform === 'linux') {
      command = 'zenity'; args = ['--file-selection', '--directory', '--title=Select project folder'];
    } else throw new Error('Native folder selection is unavailable on this system.');
    try {
      const { stdout } = await run(command, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 16384, windowsHide: true });
      const path = stdout.replace(/[\r\n]+$/, '');
      return path ? { path, cancelled: false } : { cancelled: true };
    } catch (error) {
      if (platform === 'linux' && error.code === 1 && !error.killed) return { cancelled: true };
      throw new Error('Could not open the system folder chooser. Use the manual folder browser instead.');
    }
  } finally { pending = false; }
}
