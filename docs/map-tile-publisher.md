# Публикация source-тайлов в Yandex Object Storage

CLI `publish:map-tiles` проверяет завершённый staging-набор и публикует его через
S3-совместимый API. Тайлы загружаются в неизменяемый путь
`maps/v1/{tileBuildVersion}/{datasetId}`, выборочно читаются обратно, и только
после успешной проверки обновляется `maps/catalog-v1.json`. Старые datasets CLI
не удаляет и lifecycle-настройки не меняет.

## Проверка без записи

Endpoint, bucket и prefix передаются явно или через окружение. Dry-run полностью
проверяет локальный manifest и все Brotli-артефакты, но не обращается к бакету и
не требует credentials:

```powershell
$env:S3_ENDPOINT = 'https://storage.yandexcloud.net'
$env:S3_BUCKET = '<bucket>'
$env:S3_PREFIX = '<необязательный-prefix>'
$env:MAP_DATASET_ID = 'moscow-2026-09-11'
npm run publish:map-tiles -- --staging .\work\moscow-pilot --dry-run
```

Проверяются версия и полнота `staging-manifest-v1.json`, точный путь каждого XYZ,
размер, schema/build version, внутренний checksum и отсутствие незаявленных
`*.tile.json.br`. Symlink и junction в staging отклоняются.

## Публикация

Задайте статические ключи сервисного аккаунта только в окружении текущего
процесса либо передайте `--access-key` и `--secret-key`. Не сохраняйте их в
`.env`, command-файлы или staging:

```powershell
$env:AWS_ACCESS_KEY_ID = '<static-access-key-id>'
$env:AWS_SECRET_ACCESS_KEY = '<static-secret-key>'
$env:AWS_REGION = 'ru-central1'
npm run publish:map-tiles -- --staging .\work\moscow-pilot --sample-size 3
```

Эквивалентные явные параметры: `--endpoint`, `--bucket`, `--prefix`,
`--dataset-id`, `--region`, `--access-key`, `--secret-key` и необязательный
`--session-token`. CLI не выводит credentials, заголовок Authorization или тело
ошибки S3. Для тайлов выставляются `Content-Type: application/json`,
`Content-Encoding: br`, `Cache-Control: public, max-age=31536000, immutable` и
metadata `tile-checksum`. Совпадающий объект пропускается; коллизия существующего
immutable key с другим размером, checksum или заголовками останавливает запуск до
публикации каталога. Новые тайлы отправляются с `If-None-Match: *` и
`Content-MD5`, а каталог обновляется условно по текущему ETag (`If-Match`) либо
создаётся с `If-None-Match: *`. Поэтому параллельный publisher не может незаметно
перезаписать immutable объект или потерять чужое обновление каталога.

Endpoint с обычными credentials должен использовать HTTPS. Незашифрованный HTTP
разрешается только для локального mock/MinIO на `localhost`, `127.0.0.1` или
`::1` и только с явным `--allow-insecure-local-endpoint`.

Повторный запуск безопасен: загруженные тайлы пропускаются, снова проходят
контрольное чтение, а dataset с тем же содержимым остаётся активным. Не используйте
один `datasetId` для разных снимков.

## Режим генерации команд

Чтобы получить команды официального AWS CLI без выполнения S3-запросов:

```powershell
npm run publish:map-tiles -- --staging .\work\moscow-pilot --emit-commands
```

Вывод ссылается только на имена `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN` и не содержит их значений. Это готовый
PowerShell-сценарий: он загружает тайлы условными запросами, читает контрольную
выборку во временный каталог, сравнивает MD5 и публикует встроенный каталог
последней условной командой. Строковые аргументы выводятся как безопасные
одинарные PowerShell-литералы.

Для первого каталога дополнительных параметров не нужно: используется
`If-None-Match: *`. При обновлении сначала сохраните текущий `catalog-v1.json`
локально и получите его ETag, затем укажите оба параметра:

```powershell
npm run publish:map-tiles -- --staging .\work\moscow-pilot --emit-commands `
  --current-catalog .\work\catalog-v1.json `
  --current-catalog-etag '"<etag>"'
```

Сценарий объединит datasets и применит к последней записи `If-Match`. Основной
режим CLI получает каталог и ETag автоматически. Для AWS CLI используется endpoint
`https://storage.yandexcloud.net`, как требует [документация Yandex
Cloud](https://yandex.cloud/en/docs/storage/tools/aws-cli).

## CORS и публичное чтение

Публичному игровому клиенту нужны только `GET` и `HEAD`. Создайте `cors.json`,
заменив origin на домен сайта (не используйте `PUT`, `POST` или `DELETE`):

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": ["https://game.example"],
      "AllowedMethods": ["GET", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["Content-Length", "ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

Примените и проверьте конфигурацию:

```powershell
aws s3api put-bucket-cors --endpoint-url https://storage.yandexcloud.net --bucket <bucket> --cors-configuration file://cors.json
aws s3api get-bucket-cors --endpoint-url https://storage.yandexcloud.net --bucket <bucket>
```

Инструкция Yandex Cloud по [настройке
CORS](https://yandex.cloud/en/docs/storage/operations/buckets/cors) отдельно
предупреждает, что новая конфигурация заменяет текущую — сначала сохраните её,
если бакет используется другими приложениями.

Для публичной раздачи выдайте группе `AllUsers` только `READ`, например
предустановленным ACL `public-read`, и никогда не используйте
`public-read-write`:

```powershell
aws s3api put-bucket-acl --endpoint-url https://storage.yandexcloud.net --bucket <bucket> --acl public-read
aws s3api get-bucket-acl --endpoint-url https://storage.yandexcloud.net --bucket <bucket>
```

Это действие перезаписывает текущий ACL, поэтому перед применением проверьте
владельца и существующие grants. [Документация ACL Yandex
Cloud](https://yandex.cloud/en/docs/storage/operations/buckets/edit-acl)
определяет `public-read` как публичный `READ`, а `public-read-write` — как
публичные `READ` и `WRITE`. У сервисного аккаунта publisher должны быть права на
запись; анонимным пользователям право записи не выдаётся.
