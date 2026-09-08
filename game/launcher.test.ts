import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  statSync,
  utimesSync,
  rmSync,
} from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureBuild } from '../scripts/ensure-build.mjs';
const roots: string[] = [];
function fixture(mode = 'server') {
  const root = mkdtempSync(join(tmpdir(), 'street-racer-launch-'));
  roots.push(root);
  mkdirSync(join(root, 'app'));
  writeFileSync(join(root, 'app/page.tsx'), 'Москва', 'utf8');
  const entry = join(
    root,
    mode === 'server' ? 'dist/server/wrangler.json' : 'out/index.html',
  );
  let builds = 0;
  const build = () => {
    builds++;
    mkdirSync(dirname(entry), { recursive: true });
    writeFileSync(entry, readFileSync(join(root, 'app/page.tsx')));
    return 0;
  };
  return {
    root,
    entry,
    build,
    get builds() {
      return builds;
    },
  };
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    const path = resolve(root);
    if (
      dirname(path) !== resolve(tmpdir()) ||
      !path.includes('street-racer-launch-')
    )
      throw Error('Неверный путь тестового каталога');
    rmSync(path, { recursive: true, force: true });
  }
});
it.each(['server', 'pages'])(
  'пересобирает %s после смены города, но повторный запуск не требует сборки',
  (mode) => {
    // Arrange
    const f = fixture(mode),
      options = { build: f.build, log: () => {} };
    // Act
    ensureBuild(f.root, mode, options);
    ensureBuild(f.root, mode, options);
    expect(f.builds).toBe(1);
    const source = join(f.root, 'app/page.tsx'),
      before = statSync(source);
    writeFileSync(source, 'Петербург', 'utf8');
    utimesSync(source, before.atime, before.mtime);
    ensureBuild(f.root, mode, options);
    // Assert — изменение содержимого обнаруживается даже с прежней датой файла.
    expect(f.builds).toBe(2);
    expect(readFileSync(f.entry, 'utf8')).toBe('Петербург');
  },
);
it('не считает старый dist без отметки актуальной сборкой', () => {
  // Arrange
  const f = fixture();
  f.build();
  // Act
  ensureBuild(f.root, 'server', { build: f.build, log: () => {} });
  // Assert
  expect(f.builds).toBe(2);
});
it('ошибка сборки не разрешает запустить старую игру и следующая попытка повторяет сборку', () => {
  // Arrange
  const f = fixture();
  ensureBuild(f.root, 'server', { build: f.build, log: () => {} });
  writeFileSync(join(f.root, 'app/page.tsx'), 'Петербург', 'utf8');
  // Act / Assert
  expect(() =>
    ensureBuild(f.root, 'server', { build: () => 1, log: () => {} }),
  ).toThrow(
    'Не удалось обновить игру. Закройте другие окна её сервера и повторите запуск.',
  );
  ensureBuild(f.root, 'server', { build: f.build, log: () => {} });
  expect(readFileSync(f.entry, 'utf8')).toBe('Петербург');
});
