# Красные квадраты (Yandex Cloud)

Статический «график вкладов» по данным [status.yandex.cloud](https://status.yandex.cloud/): перед сборкой **скачивается JSON** с `GET …/api/incidents` (скрипт на Node, без CORS), в проде браузер читает только **`data/incidents.json`** с того же origin.

Референс идеи: [Red Squares](https://red-squares.cian.lol/).

## Локально

```bash
npm install
npm run fetch-data   # создаёт public/data/incidents.json
npm run dev
```

Без `fetch-data` в режиме разработки приложение **один раз** запросит API через прокси Vite (`/status-proxy` → `https://status.yandex.cloud/api`), см. `vite.config.ts`.

Просмотр прод-сборки:

```bash
npm run build        # сначала fetch-data, затем vite build
npm run preview
```

## Почему не запрос из браузера на проде

У ответов API **нет** `Access-Control-Allow-Origin` для произвольных сайтов, поэтому GitHub Pages и прочий статический хостинг не могут дергать API напрямую. Обход: **CI по расписанию или push** качает данные и кладёт их в билд.

## GitHub Pages

Workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml): push в `main`, по крону каждые 6 часов и вручную — `npm ci`, затем **`npm run build`** (внутри уже есть `fetch-data`).

| Переменная | Назначение |
|------------|------------|
| `VITE_BASE` | База статики (для Pages: `/${repo}/`) |

Опционально для скрипта загрузки:

| Переменная | Назначение |
|------------|------------|
| `STATUS_API_BASE` | База API без хвостового `/` (по умолчанию `https://status.yandex.cloud/api`) |

## Что попадает в график

Все инциденты из ответа API за окно ~400 дней до «сегодня» (как в скрипте). Фильтр по зонам на странице применяется **на клиенте** к полному снимку (если в карточке есть поле зон — по нему, иначе эвристика по `services`). Потребительские сервисы Яндекса вне [status.yandex.cloud](https://status.yandex.cloud/) не покрываются.

## API

`https://status.yandex.cloud/api/incidents` (`page`, `perPage`, `from`, `to`, …). Описание полей: [essentialkaos/ycs](https://github.com/essentialkaos/ycs).
