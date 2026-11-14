import { spawn } from 'node:child_process';
import { serve } from './serve.mjs';

const compile = spawn(process.execPath, ['node_modules/typescript/bin/tsc'], { stdio: 'inherit' });
compile.on('exit', code => {
  if (code !== 0) { process.exitCode = code ?? 1; return; }
  const server = serve();
  const watcher = spawn(process.execPath, ['node_modules/typescript/bin/tsc', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' });
  const stop = () => { watcher.kill(); server.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
});
