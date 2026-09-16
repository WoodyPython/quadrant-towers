import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { writeFileSync } from 'node:fs';

// CI-only: autodeploy must be disabled. No secrets are passed as CLI arguments.
const service = process.env.RAILWAY_SERVICE_ID;
const environment = process.env.RAILWAY_ENVIRONMENT_ID;
const origin = process.env.PRODUCTION_ORIGIN;
if (
  !service ||
  !environment ||
  !process.env.RAILWAY_TOKEN ||
  !origin?.startsWith('https://')
)
  throw new Error('Missing Railway deployment configuration');
const args = ['--service', service, '--environment', environment];
const run = (...command) =>
  execFileSync('railway', command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  });
const list = () =>
  JSON.parse(run('deployment', 'list', ...args, '--json', '--limit', '100'));
const before = list();
if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA ?? ''))
  throw new Error('A tested commit SHA is required');
writeFileSync('build-id.txt', process.env.GITHUB_SHA);
const active = before.filter((d) => d.status === 'SUCCESS');
if (
  active.length > 1 ||
  before.some((d) =>
    [
      'BUILDING',
      'DEPLOYING',
      'INITIALIZING',
      'WAITING',
      'QUEUED',
      'REMOVING',
      'SLEEPING',
    ].includes(d.status),
  )
)
  throw new Error(
    'Another deployment is active or pending. Resolve it before releasing.',
  );
if (active.length) {
  run('down', ...args, '--yes');
  let stopped = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    const previous = list().find((d) => d.id === active[0].id);
    if (previous?.status === 'REMOVED') {
      stopped = true;
      break;
    }
    await setTimeout(10000);
  }
  if (!stopped)
    throw new Error(
      'Previous deployment did not stop; refusing concurrent game processes',
    );
}
run('up', ...args, '--ci');
for (let attempt = 0; attempt < 30; attempt++) {
  const latest = list().find((d) => !before.some((old) => old.id === d.id));
  if (latest && ['FAILED', 'CRASHED', 'REMOVED'].includes(latest.status))
    throw new Error('Deployment failed. Follow the rollback runbook.');
  if (latest?.status === 'SUCCESS') {
    try {
      const ready = await fetch(`${origin}/health/ready`, {
        signal: AbortSignal.timeout(5000),
      });
      const version = await fetch(`${origin}/api/version`, {
        signal: AbortSignal.timeout(5000),
      }).then((r) => r.json());
      if (ready.ok && version.buildId === process.env.GITHUB_SHA) {
        console.log('Production is ready on the tested commit.');
        process.exit(0);
      }
    } catch {
      /* Retry until the public endpoint has switched. */
    }
  }
  await setTimeout(10000);
}
throw new Error(
  'Production readiness or build identity verification timed out',
);
