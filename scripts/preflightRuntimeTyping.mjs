import { spawnSync } from 'node:child_process';

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit'
  });
  return result.status ?? 1;
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) {
  console.error('[preflight] npm_execpath is not available. Run this script via npm.');
  process.exit(1);
}

const status = run(process.execPath, [npmExecPath, 'run', 'typecheck']);
if (status !== 0) {
  console.error('\n[preflight] Runtime typing check failed.');
  console.error('[preflight] Fix Node/Worker type errors before running release build.');
  console.error('[preflight] Hint: check @types/node, worker tsconfig scope, and package typecheck scripts.');
  process.exit(status);
}

console.log('[preflight] Runtime typing check passed.');
