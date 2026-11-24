/**
 * migrate.js — версия схемы данных и автомиграции.
 * Вызывать на каждой странице сразу после state.js:  Schema.run();
 * Перед каждой миграцией делается резервная копия затрагиваемых ключей.
 */
(function (global) {
    const VERSION = 3;
    const maxId = ops => Math.max(0, ...ops.map(o => +o.id || 0));

    const MIGRATIONS = {
        // v1: старый формат операций (kind/amount/date/cat/wallet) -> единый (tip/summa/data/kat/koshel)
        1() {
            const ops = State.getOps();
            if (!ops.some(z => z && typeof z === "object" && z.kind)) return;
            AppStorage.set("backup_ops_pre_v1", ops);
            let id = maxId(ops);
            State.setOps(ops.map(z => {
                if (!z || typeof z !== "object" || !z.kind) return z;
                const b = {
                    id: +z.id > 0 ? +z.id : ++id,
                    data: (z.date || "") + " 00:00",
                    koshel: z.wallet,
                    summa: Math.abs(+z.amount || 0)
                };
                if (z.note) b.zametka = z.note;
                if (String(z.cat || "").includes("Корректировка")) return Object.assign(b, { tip: "Корректировка", summa: +z.amount || 0 });
                if (z.kind === "expense") return Object.assign(b, { tip: "Трата", kat: z.cat });
                if (z.kind === "income") return Object.assign(b, { tip: "Доход", kat: z.cat });
                if (z.kind === "transfer") return Object.assign(b, { tip: "Перевод", kuda: z.toWallet });
                return z;
            }));
        },

        // v2: заправки — единое поле суммы total (раньше иногда amount)
        2() {
            const fuels = State.getFuel();
            if (!fuels.some(f => f && f.total == null && f.amount != null)) return;
            AppStorage.set("backup_fuel_pre_v2", fuels);
            State.setFuel(fuels.map(f => {
                if (f && f.total == null && f.amount != null) {
                    const g = Object.assign({}, f, { total: +f.amount || 0 });
                    delete g.amount;
                    return g;
                }
                return f;
            }));
        },

        // v3: бюджет по месяцам. Раньше лимиты (byudzhety) и параметры (budget_cfg) были общими для всех месяцев,
        // из-за чего бюджет декабря «просвечивал» в ноябре. Прежние данные переносим в ОДИН месяц — следующий
        // после текущего (на момент миграции); старые ключи не удаляем (на них смотрит «Финансы»).
        3() {
            if (AppStorage.has("budgets_m")) return;
            const L = AppStorage.get("byudzhety", {}) || {}, C = AppStorage.get("budget_cfg", null);
            const limits = {};
            Object.keys(L).forEach(k => { const v = Number(L[k]); if (v > 0) limits[k] = v; });
            const blank = x => x === "" || x == null;
            const hasCfg = !!C && typeof C === "object" && (!blank(C.salary) || Number(C.extra) > 0 || Number(C.save) > 0);
            if (!Object.keys(limits).length && !hasCfg) return;   // переносить нечего: бюджетов не было
            AppStorage.set("backup_budget_pre_v3", { byudzhety: L, budget_cfg: C });
            const m = UI.date.shift(UI.date.month(), 1);
            AppStorage.set("budgets_m", { [m]: { limits, cfg: {
                salary: C && !blank(C.salary) ? Number(C.salary) : null,
                extra: C ? Number(C.extra) || 0 : 0,
                save: C ? Number(C.save) || 0 : 0
            } } });
        }
    };

    global.Schema = {
        VERSION,
        run() {
            // Миграции идемпотентны (сами проверяют, есть ли что менять), поэтому гоняем все:
            // так подхватывается и импорт старой копии, где ключ schema мог остаться новым.
            for (let v = 1; v <= VERSION; v++) {
                try { MIGRATIONS[v](); }
                catch (e) { console.error("Schema: миграция v" + v + " не удалась", e); return false; }
            }
            if ((+AppStorage.get("schema", 0) || 0) !== VERSION) AppStorage.set("schema", VERSION);
            return true;
        }
    };
})(window);
