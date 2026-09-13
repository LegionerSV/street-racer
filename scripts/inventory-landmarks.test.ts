import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

it('инвентаризация читает весь манифест и устраняет повторы по паре type/id', async () => {
  // Arrange
  const root = await mkdtemp(
    join(tmpdir(), 'street-racer-landmark-inventory-'),
  );
  try {
    const elements = [
      { type: 'node', id: 1, lat: 1, lon: 1, tags: { historic: 'monument' } },
      {
        type: 'way',
        id: 1,
        nodes: [1, 1, 1],
        tags: { building: 'church', 'roof:shape': 'dome' },
      },
      {
        type: 'relation',
        id: 1,
        tags: { type: 'building' },
        members: [
          { type: 'way', ref: 1, role: 'outline' },
          { type: 'way', ref: 99, role: 'part' },
        ],
      },
    ];
    const bytes = brotliCompressSync(
      Buffer.from(JSON.stringify({ elements, checksum: 'test' })),
    );
    for (const city of ['moscow', 'saint-petersburg']) {
      await mkdir(join(root, city));
      const tiles: Record<string, unknown> = {};
      for (const key of ['first', 'last']) {
        await writeFile(join(root, city, `${key}.br`), bytes);
        tiles[key] = {
          path: `${key}.br`,
          bytes: bytes.length,
          checksum: 'test',
        };
      }
      await writeFile(
        join(root, city, 'staging-manifest-v1.json'),
        JSON.stringify({ tiles, planned: 2, complete: true }),
      );
    }
    // Act
    await promisify(execFile)(
      process.execPath,
      [resolve('scripts/inventory-landmarks.mjs'), root, join(root, 'report')],
      { windowsHide: true },
    );
    // Assert
    for (const city of ['moscow', 'saint-petersburg']) {
      const summary = JSON.parse(
        await readFile(join(root, 'report', `${city}-summary.json`), 'utf8'),
      );
      expect(summary).toMatchObject({
        unique: 3,
        occurrences: 6,
        duplicates: 3,
        manifest: { tiles: 2 },
        counts: { node: 1, way: 1, relation: 1 },
      });
      expect(summary.frequencies['roof:shape'].dome.count).toBe(1);
      expect(summary.missingMembers).toEqual([
        { relation: 'relation/1', type: 'way', ref: 99, role: 'part' },
      ]);
    }
  } finally {
    const path = resolve(root),
      parent = resolve(tmpdir()) + sep;
    if (
      path.startsWith(parent) &&
      path.slice(parent.length).startsWith('street-racer-landmark-inventory-')
    )
      await rm(path, { recursive: true, force: true });
  }
});
