import { createHash } from 'node:crypto';
import {
  existsSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const targets = {
  server: {
    entry: 'dist/server/wrangler.json',
    stamp: 'dist/.source-fingerprint.json',
    script: 'build',
  },
  pages: {
    entry: 'out/index.html',
    stamp: 'out/.source-fingerprint.json',
    script: 'build:pages',
  },
};
function fingerprint(root, mode) {
  const hash = createHash('sha256');
  hash.update(
    JSON.stringify({
      version: 1,
      mode,
      node: process.versions.node,
      base:
        mode === 'pages' ? process.env.PAGES_BASE_PATH || '/street-racer/' : '',
    }),
  );
  function add(path) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return;
    hash.update(path);
    hash.update('\0');
    hash.update(readFileSync(absolute));
    hash.update('\0');
  }
  function walk(path) {
    if (!existsSync(join(root, path))) return;
    for (const item of readdirSync(join(root, path), {
      withFileTypes: true,
    }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        item.name === 'fixtures' ||
        /\.(test|spec)\.[cm]?[jt]sx?$/.test(item.name)
      )
        continue;
      if (item.isDirectory()) walk(join(path, item.name));
      else if (item.isFile()) add(join(path, item.name));
    }
  }
  for (const path of [
    'app',
    'game',
    'components',
    'hooks',
    'lib',
    'public',
    'static',
    'scripts',
  ])
    walk(path);
  for (const name of readdirSync(root).sort())
    if (
      /^(package(-lock)?\.json|tsconfig\.json|next\.config\..+|vite(\.pages)?\.config\..+|\.env(\..+)?)$/.test(
        name,
      )
    )
      add(name);
  add('.openai/hosting.json');
  return hash.digest('hex');
}
export function ensureBuild(root, mode = 'server', options = {}) {
  const target = targets[mode];
  if (!target) throw new Error('Неизвестный режим запуска игры.');
  root = resolve(root);
  const entry = join(root, target.entry),
    stamp = join(root, target.stamp),
    current = fingerprint(root, mode);
  let saved;
  try {
    saved = JSON.parse(readFileSync(stamp, 'utf8'));
  } catch {
    /* У старых сборок нет отметки: их нужно обновить один раз. */
  }
  if (existsSync(entry) && saved?.fingerprint === current) return false;
  (options.log || console.log)('Обнаружены изменения. Обновляем сборку игры…');
  // Удаляется только собственная отметка, чтобы ошибка/частичная сборка
  // не могла выдать устаревшую игру за актуальную.
  rmSync(stamp, { force: true });
  const status = options.build
    ? options.build()
    : spawnSync(
        process.platform === 'win32' ? 'npm.cmd' : 'npm',
        ['run', target.script],
        {
          cwd: root,
          stdio: 'inherit',
          shell: process.platform === 'win32',
          windowsHide: true,
        },
      ).status;
  if (status !== 0 || !existsSync(entry))
    throw new Error(
      'Не удалось обновить игру. Закройте другие окна её сервера и повторите запуск.',
    );
  if (fingerprint(root, mode) !== current)
    throw new Error('Исходники изменились во время сборки. Повторите запуск.');
  writeFileSync(
    stamp,
    JSON.stringify({ fingerprint: current, builtAt: new Date().toISOString() }),
    'utf8',
  );
  return true;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    ensureBuild(
      resolve(dirname(fileURLToPath(import.meta.url)), '..'),
      process.argv[2] || 'server',
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
