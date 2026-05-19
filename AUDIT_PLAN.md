# План правок — Yandex Ads Scraper

## P1 — Критические

### 1. Выбор домена в batch-режиме не работает

**Файлы:** `sidepanel.js`, `background.js`

**Что:** При старте batch-сбора домен жестко зашит как `'ya.ru'`, выбор пользователя через radio button игнорируется.

**Исправление:**
- В `sidepanel.js:startBatch()` — прочитать выбранный `input[name="batchDomain"]:checked`
- Передавать `domain` в `chrome.runtime.sendMessage({ action: 'batchScrape', queries, domain })`

---

## P2 — Важные

### 2. Удалить мёртвый код (4 неиспользуемых метода)

**Файлы:** `content.js`

| Метод | Строка | Действие |
|---|---|---|
| `isAdvertisement()` | 170 | Удалить |
| `findMapAdCards()` | 112 | Удалить |
| `extractMapCardData()` | 234 | Удалить |
| `isPromoOrgCard()` | 142 | Удалить |

Также удалить неиспользуемые селекторы из `this.selectors`:
- `adBlocks` (не используется в `findAdBlocks()`)
- `adLabels`
- `mapBlock`, `mapCards`
- `mapCardTitle`, `mapCardAddress`, `mapCardRating` (использовались только в удаляемых методах)

### 3. Устранить тройное дублирование `parseUtmParams`

**Файлы:** `content.js`, `utils.js`, `background.js`

**Что:** Функция `parseUtmParams` определена 3 раза.

**Исправление:**
- Оставить единственное определение в `utils.js`
- В `background.js` — импортировать через `importScripts('utils.js')` (MV3 service worker поддерживает `importScripts`)
- В `content.js` — удалить, т.к. вызов `parseUtmParams` в `extractAdData()` лишний: при ручном сборе background.js сам вызывает `parseUtmParams` после `resolveUrls`, при batch — тоже

### 4. Избыточный резолв yabs-URL через вкладки

**Файлы:** `background.js`

**Что:** `resolveAllYabsUrls()` открывает скрытые вкладки для ВСЕХ объявлений, хотя парсер мог уже извлечь реальный URL из `data-vnl`/`data-aqoln` (не содержащий `yabs.yandex.ru`).

**Исправление:**
- В `resolveAllYabsUrls()` — проверять, содержит ли `ad.url` `yabs.yandex.ru` перед открытием вкладки. Текущая проверка уже есть, но нужно убедиться, что в парсере fallback-путь не возвращает yabs-URL, когда есть реальный URL.
- Либо добавить флаг `needsResolve` на уровне ad-объекта.

---

## P3 — Средние

### 5. Service worker может быть убит до завершения batch

**Файлы:** `background.js`

**Что:** Chrome убивает MV3 service worker через ~30 с бездействия. Batch на 50 запросов может длиться до 750 с.

**Исправление:**
- Использовать `chrome.runtime.connect()` для поддержания `keepalive`-порта между sidepanel и background во время batch
- Либо разбивать batch на чанки и использовать `chrome.alarms` для запуска следующего чанка

### 6. Нет ограничения storage

**Файлы:** `sidepanel.js`

**Что:** При активном использовании сессии могут накопить >10 MB (лимит `chrome.storage.local`). Предупреждение есть, автоочистки нет.

**Исправление:**
- Добавить автоудаление старых сессий при превышении 80% квоты (самые старые — первые)
- Или добавить конфигурацию "max sessions"

### 7. Сбор userAgent в metadata

**Файлы:** `content.js` (строка 561)

**Что:** `navigator.userAgent` попадает в экспортируемые данные. При передаче файлов третьим лицам — утечка.

**Исправление:**
- Удалить `userAgent` из `createMetadata()`

---

## P4 — Косметические / Улучшения

### 8. `highlightCollectedAds()` мутирует style напрямую

**Файлы:** `content.js` (строки 478-480)

**Что:** Прямые манипуляции `style.outline` конфликтуют с CSS Яндекса.

**Исправление:**
- Использовать CSS-класс вместо инлайн-стилей
- Уже есть класс `.yandex-ads-scraper-highlight`, но он не определён в CSS

### 9. Рефакторинг `extractUrl()`

**Файлы:** `content.js` (строка 314)

**Что:** 6 вложенных fallback-блоков — сложно читать и поддерживать.

**Исправление:**
- Разбить на отдельные методы: `tryDataAqoln()`, `tryDataVnl()`, `tryDataBem()` и т.д.
- Либо вынести в массив стратегий

### 10. Не сохраняется состояние сворачивания сессий

**Файлы:** `sidepanel.js` (строка 310)

**Что:** После перезагрузки sidepanel все сессии развёрнуты, хотя collapsed — состояние по умолчанию (кроме первой).

**Исправление:**
- Сохранять `collapsed`-состояние в `session`-объекте (в storage)
- Восстанавливать при загрузке

### 11. `.hidden { display: none !important; }`

**Файлы:** `sidepanel.css` (строка 440)

**Что:** `!important` в глобальном утилитарном классе усложняет переопределение.

**Исправление:**
- Там где можно — использовать более специфичные селекторы (`.panel .hidden`)
- Или обойтись без `!important`

---

## Порядок выполнения

1. **P1** — починить выбор домена
2. **P2** — удалить dead code + убрать дублирование parseUtmParams
3. **P2** — оптимизировать resolveYabsViaTab
4. **P3** — service worker keepalive + лимит storage
5. **P3** — убрать userAgent из метаданных
6. **P4** — остальное по желанию
