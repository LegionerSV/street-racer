# Локальный генератор source-тайлов

Фактическое размещение файлов и утилит пилотной генерации зафиксировано в
[отчёте MAP-S3-11](./map-pilot-report.md#куда-сохранены-файлы).

CLI `generate:map-tiles` создаёт возобновляемый staging-набор
`TileArtifactV1` из явно указанного локального JSON-файла либо региональной
OSM PBF-выгрузки и файлового кэша DEM. Массовый PBF-режим не обращается к
Overpass и не принимает облачные ключи. Многогигабайтная PBF-выгрузка никогда
не скачивается CLI автоматически.

## Быстрый старт

Сначала проверьте план без создания каталогов и файлов:

```powershell
npm run generate:map-tiles -- --staging .\work\moscow-pilot --center 55.751244,37.618423 --width 10 --height 10 --dry-run
```

Для генерации передайте локальный input и допустимый параллелизм:

```powershell
npm run generate:map-tiles -- --staging .\work\moscow-pilot --input .\work\moscow-fixture.json --center 55.751244,37.618423 --width 10 --height 10 --concurrency 4
```

Вместо прямоугольника можно перечислить XYZ (параметр повторяется):

```powershell
npm run generate:map-tiles -- --staging .\work\pilot --input .\work\tiles.json --tile 15/19808/10243 --tile 15/19809/10243
```

Полное покрытие административного региона задаётся зафиксированной границей
GeoJSON. Генератор включает только те XYZ, которые пересекают `Polygon` или
`MultiPolygon`; сухой запуск печатает точное число тайлов до создания staging:

```powershell
npm run generate:map-tiles -- --staging .\work\map-full\moscow --boundary .\scripts\map-coverage\moscow.geojson --zoom 15 --concurrency 8 --max-tile-bytes 4194304 --dry-run
```

Границы Москвы, Санкт-Петербурга и коридора Олонец — Ильинский, их OSM relation
ID, checksum, PBF-снимки, прогнозы, лимит 4 МиБ и допустимый параллелизм для
каждого региона зафиксированы в `scripts/map-full-coverage-config.ts`. Файлы границ получены из Nominatim на
условиях ODbL 1.0 с `polygon_threshold=0.0005`; карельская граница — коридор с
буфером 10 км между relations 6360163 и 14089320. Checksum защищает план от
незаметного изменения. Полная команда воспроизводится заменой параметров PBF и
provenance значениями соответствующего региона из конфигурации.

Чтобы исключить ручное расхождение параметров с конфигурацией, полный набор
запускается обёрткой (допустимые `--region`: `moscow`, `saint-petersburg`,
`olonetsky-district`):

```powershell
npm run generate:map-full -- --region moscow --data-root .\work\map-data --cache-root .\work\map-cache --staging-root .\work\map-full --osmium C:\path\to\osmium.exe --download-dem
```

Перед dry-run или генерацией обёртка потоково сверяет SHA-256 boundary и MD5
PBF с зафиксированной конфигурацией. Несовпадение останавливает запуск до чтения
resume manifest.

К прямоугольнику можно добавить отдельные специальные клетки повторяемым
параметром `--extra-tile`. Совпавшие с прямоугольником или друг с другом XYZ
автоматически дедуплицируются:

```powershell
npm run generate:map-tiles -- --staging .\work\moscow-pilot --center 55.751244,37.618423 --width 10 --height 10 --extra-tile 15/19814/10243 --extra-tile 15/19800/10244 --dry-run
```

Все пути артефактов строятся только внутри явно заданного `--staging`. Файлы
записываются атомарно в структуру `z/x/y.tile.json.br`. При повторном запуске
каждый существующий файл распаковывается и проверяется по XYZ, версиям и
checksum: валидный файл пропускается, повреждённый пересобирается.

Генератор получает эксклюзивную блокировку staging и отклоняет symlink/junction
внутри него. Протухшая блокировка аварийно завершившегося процесса автоматически
восстанавливается. Пока команда работает, staging нельзя изменять другими
инструментами: эксклюзивность защищает от одновременных запусков этого CLI, но не
от процесса, который намеренно игнорирует его блокировку.

После каждого результата CLI дописывает `generation-log.ndjson`, поэтому уже
обработанные тайлы и ошибки сохраняются при прерывании процесса. Итоговый
`report.json` содержит число запланированных, созданных, пропущенных и ошибочных
тайлов, общий объём и число элементов, p50/p95/max размера и длительность.
Наличие ошибок даёт ненулевой код завершения, но не останавливает остальные
тайлы. `staging-manifest-v1.json` фиксирует ожидаемое число тайлов, их безопасные
относительные пути, размеры, версии и checksum. При любой ошибке manifest имеет
`complete: false`, поэтому publisher не сможет активировать неполный набор.

## Формат локального input

```json
{
  "tiles": {
    "15/19808/10243": {
      "osmTimestamp": "2026-09-10T08:30:00.000Z",
      "drivingSide": "right",
      "elements": [{ "type": "node", "id": 1, "lat": 55.75, "lon": 37.61 }],
      "elevation": {
        "width": 2,
        "size": 700,
        "values": [100, 101, 102, 103]
      }
    }
  }
}
```

`elevation.values` должен содержать ровно `width × width` конечных чисел. Поле
`size` необязательно; по умолчанию используется 700 метров. Точный
`generatedAt` для воспроизводимых fixture можно задать параметром
`--generated-at` в ISO-формате.

## Массовая генерация из PBF и DEM

Требуется `osmium-tool` версии 1.19.x. В воспроизводимом окружении Conda его
можно установить и проверить так:

```powershell
conda install --channel conda-forge osmium-tool=1.19.0
osmium --version
```

Официальная документация также описывает пакет `osmium-tool` для Debian/Ubuntu,
Homebrew и сборку из исходников для Windows. Если `osmium` не находится в
`PATH`, передайте полный путь через `--osmium`.

PBF-файл нужно получить отдельно у поставщика региональных OSM-выгрузок. До
генерации зафиксируйте на странице поставщика URL/название набора, дату снимка и
условия Open Database License. Эти значения обязательны для команды и
записываются в `input-data.json`; путь к локальному файлу в метаданные не
попадает.

```powershell
npm run generate:map-tiles -- `
  --staging .\work\moscow-pilot `
  --pbf D:\map-data\central-russia-2026-09-01.osm.pbf `
  --osm-cache D:\map-cache\osm `
  --dem-cache D:\map-cache\terrarium `
  --osm-timestamp 2026-09-01T00:00:00Z `
  --input-source https://example.org/central-russia-2026-09-01.osm.pbf `
  --input-license ODbL-1.0 `
  --dem-timestamp 2026-08-01T00:00:00Z `
  --dem-license https://github.com/tilezen/joerd/blob/master/docs/attribution.md `
  --driving-side right `
  --center 55.751244,37.618423 --width 10 --height 10 `
  --concurrency 4 --download-dem
```

`--dem-timestamp` фиксирует дату снимка локального DEM-кэша, а `--dem-license` —
применимую страницу лицензий и атрибуции исходных наборов Tilezen.
`--download-dem` — отдельное разрешение скачать только недостающие исходные
Terrarium z12 PNG. Без него отсутствующий DEM завершает соответствующий тайл
ошибкой. Каждый PNG хранится как `dem-cache/12/x/y.png`, поэтому соседние
source-тайлы используют одни и те же исходные пиксели на общей границе, а
повторный запуск не выполняет сетевой запрос. После первичного заполнения кэша
тот же набор воспроизводится полностью офлайн, если убрать `--download-dem`.

Перед извлечением CLI один раз создаёт в `--osm-cache` отфильтрованную копию
региональной PBF. Набор выражений строится из того же `roadTypes`, что и
`mapCellQuery`, и включает светофоры, ограничения поворотов, здания и их части,
воду, леса, траву, луга, водохранилища и парки. Фактически вызываются команды
следующего вида (точные пути и bbox выводятся из параметров):

```text
osmium tags-filter <input.osm.pbf> <зафиксированные выражения> --overwrite -o <filtered.osm.pbf>
osmium extract --bbox <west,south,east,north> --strategy smart --option types=any --overwrite <filtered.osm.pbf> --output-format osm -o <tile.osm>
```

`tags-filter` по умолчанию добавляет объекты, на которые ссылаются совпавшие
ways и relations. Последующий `extract` со стратегией `smart` и
`types=any` сохраняет полные ways, relation members и их nodes. Bbox строится
по `bufferedBounds`, то есть содержит точный core и halo 300 м. Полученный XML
кэшируется по bbox и преобразуется в тот же массив `OSMElement`, что возвращает
Overpass.

Завершённый набор можно проверить без сети, включая совпадение общей OSM-
геометрии и рельефа на всех соседних швах:

```powershell
npm run verify:map-pilot -- .\work\moscow-pilot
```

Для полностью локального повтора используйте ту же команду без
`--download-dem`. Смена PBF, её размера/mtime или набора фильтров автоматически
создаёт новые региональную запись и extract-кэш. `input-data.json` содержит
fingerprint PBF, provenance и существенных параметров генерации; рядом с каждым
артефактом записывается `.source-fingerprint`. Поэтому незавершённый повтор с
другим входом не может принять старый валидный артефакт за новый. Исходные PBF и DEM должны
использоваться с соблюдением лицензий их поставщиков; публикация карты должна
содержать атрибуцию OpenStreetMap и конкретного источника DEM.
