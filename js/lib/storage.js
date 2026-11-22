/**
 * storage.js — Единственный слой доступа к localStorage.
 * Все ключи приложения живут в префиксе "uchot.v2."
 * Если запись не удалась (нет места, приватный режим), данные временно держатся в памяти,
 * а сверху показывается красная плашка: иначе они молча пропали бы при закрытии приложения.
 */
(function (global) {
    const PREFIX = "uchot.v2.";
    const memFallback = {}; // Запасник на случай Private Mode или ошибки записи
    let banner = null, blocked = false;

    function showBanner() {
        const build = () => {
            if (banner || !document.body) return;
            banner = document.createElement("div");
            banner.id = "storageWarn";
            banner.setAttribute("style", "position:fixed;left:0;right:0;top:0;z-index:9000;background:#ff3b30;color:#fff;" +
                "padding:calc(8px + env(safe-area-inset-top,0px)) 12px 8px;font:600 13px/1.35 -apple-system,sans-serif;text-align:center");
            banner.innerHTML = '⚠ Данные не сохраняются в память телефона. Не закрывайте приложение и сделайте копию: ' +
                '<a href="settings.html" style="color:#fff;text-decoration:underline">Настройки → Экспорт</a>';
            document.body.appendChild(banner);
        };
        if (document.body) build(); else document.addEventListener("DOMContentLoaded", build);
    }
    function hideBanner() {
        if (banner && !blocked && !Object.keys(memFallback).length) { banner.remove(); banner = null; }
    }

    // Проверка при загрузке: работает ли запись вообще
    try { const k = PREFIX + "__probe"; localStorage.setItem(k, "1"); localStorage.removeItem(k); }
    catch (e) { blocked = true; showBanner(); }

    const Storage = {
        get(key, defaultValue = null) {
            const fullKey = PREFIX + key;

            // Сначала проверяем память (если localStorage упал при записи)
            if (memFallback[fullKey] !== undefined) {
                return memFallback[fullKey];
            }

            try {
                const raw = localStorage.getItem(fullKey);
                if (raw === null) return defaultValue;
                return JSON.parse(raw);
            } catch (e) {
                return defaultValue;
            }
        },

        set(key, value) {
            const fullKey = PREFIX + key;
            const serialized = JSON.stringify(value);
            try {
                localStorage.setItem(fullKey, serialized);
                if (fullKey in memFallback) { delete memFallback[fullKey]; hideBanner(); }
            } catch (e) {
                // Если места нет или Safari в приватном режиме — пишем в память и предупреждаем
                memFallback[fullKey] = value;
                console.warn("Storage: использован fallback (память).", e);
                showBanner();
            }
        },

        remove(key) {
            const fullKey = PREFIX + key;
            try { localStorage.removeItem(fullKey); } catch (e) {}
            delete memFallback[fullKey];
            hideBanner();
        },

        has(key) {
            return this.get(key, null) !== null;
        },

        // Данные, которые не удалось записать в localStorage (имя без префикса -> значение).
        // Нужны экспорту, чтобы копия включала и их.
        memEntries() {
            const out = {};
            Object.keys(memFallback).forEach(k => { out[k.slice(PREFIX.length)] = memFallback[k]; });
            return out;
        },
        isUnsaved() { return blocked || Object.keys(memFallback).length > 0; }
    };

    global.AppStorage = Storage;
})(window);
