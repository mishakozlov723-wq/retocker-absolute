// Gets the UI ready for a build: copies the animation library into ui/vendor and stamps the version.
// node scripts/prepare.mjs [version]
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

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
