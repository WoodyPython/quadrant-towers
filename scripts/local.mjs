import { spawn } from 'node:child_process';
import { copyFile, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);

function run(command, args, env = {}) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  return new Promise((resolve, reject) => {
    // Commands and arguments are fixed below; no environment values enter shell text.
    const child = spawn(command, args, {
      stdio: 'inherit',
      cwd: root,
      shell: process.platform === 'win32',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(`${command} ${args.join(' ')} failed (exit ${code}).`),
          ),
    );
  });
}
const pnpm = (...args) => run('corepack', ['pnpm', ...args]);

try {
  const required = (await readFile('.nvmrc', 'utf8')).trim();
  if (process.versions.node !== required)
    throw new Error(
      `Node ${required} is required; found ${process.versions.node}. Install the pinned version and retry.`,
    );
  await run('corepack', ['--version']);
  await run('docker', ['compose', 'version']);
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  await pnpm('install', '--frozen-lockfile');
  try {
    await copyFile('.env.example', '.env', constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await pnpm('db:up');
  await pnpm('db:migrate');
  await pnpm('exec', 'playwright', 'install', 'chromium');
  for (const check of [
    'format:check',
    'lint',
    'typecheck',
    'test',
    'test:integration',
    'build',
    'db:check',
    'test:e2e',
  ])
    await pnpm(check);
  console.log(
    '\nChecks passed. Starting Quadrant Towers (default: http://127.0.0.1:3000). Ctrl+C stops the app; corepack pnpm db:down stops PostgreSQL.',
  );
  await run('corepack', ['pnpm', 'start'], { SERVE_STATIC: 'true' });
} catch (error) {
  console.error(
    `\nLocal setup stopped: ${error.message}\nCheck Node/Corepack, Docker Desktop, network access, and README.md. Existing configuration and database data have been preserved.`,
  );
  process.exitCode = 1;
}
