// Gets the UI ready for a build: joins the capsule engine, copies the animation library into ui/vendor and stamps the version.
// node scripts/prepare.mjs [version]
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

// ui/engine/*.js -> ui/engine.js (the engine is kept in parts in the repo; on a dev machine ui/engine.js is the source)
if (process.env.CI || !existsSync('ui/engine.js')) {
  const parts = readdirSync('ui/engine').filter(f => /^\d+\.js$/.test(f)).sort((a, b) => parseInt(a) - parseInt(b));
  writeFileSync('ui/engine.js', parts.map(f => readFileSync('ui/engine/' + f, 'utf8')).join(''));
  console.log('engine joined from', parts.length, 'parts');
}

mkdirSync('ui/vendor', { recursive: true });
copyFileSync('node_modules/motion/dist/motion.js', 'ui/vendor/motion.js');

const ver = process.argv[2];
if (ver) {
  const p = 'src-tauri/tauri.conf.json';
  const c = JSON.parse(readFileSync(p, 'utf8'));
  c.version = ver;
  writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
}
console.log('ui ready', ver || '');
