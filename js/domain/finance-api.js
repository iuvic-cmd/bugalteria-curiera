/**
 * finance-api.js — Единственный способ менять балансы и добавлять операции.
 * Все денежные операции приложения (траты, доходы, переводы, конвертации, карты, кредиты, ломбард, долги, цели).
 * Формат операции: id, data, tip, summa, koshel, kat, kuda, zametka, baz, ref.
 * ref = { t: "fuel"|"comp"|"off", id, hid? } — ссылка на запись-источник (скутер и т.д.).
 */
(function (global) {
    const pad = n => String(n).padStart(2, "0");
    // date: null | "ГГГГ-ММ-ДД" | "ГГГГ-ММ-ДД ЧЧ:ММ"
    const stamp = date => {
        if (date && String(date).length > 10) return String(date);
        const d = new Date();
        return (date || UI.date.local()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    };
    const nextId = ops => Math.max(0, ...ops.map(o => +o.id || 0)) + 1;
    const walletCur = w => (AppStorage.get("valyuty", {}) || {})[w] || "MDL";
    const toBase = (w, amount) => {
        const c = walletCur(w);
        if (c === "MDL") return null;
        const rate = +(AppStorage.get("kursy", {}) || {})[c] || 0;
        return rate ? UI.r2(amount * rate) : null;
    };
    // Накопительные итоги по категориям (traty / dohody)
    const bump = (key, cat, v) => {
        if (!cat) return;
        const m = AppStorage.get(key, {}) || {};
        m[cat] = Math.max(0, UI.r2((m[cat] || 0) + v));
        AppStorage.set(key, m);
    };
    // Добавляет категорию в список, только если список уже хранится (не затираем дефолты «Финансов»)
    const ensureCat = (kind, cat) => {
        if (!cat || !AppStorage.has("categories")) return;
        const c = State.getCategories();
        const list = c[kind] = Array.isArray(c[kind]) ? c[kind] : [];
        if (!list.includes(cat)) { list.push(cat); State.setCategories(c); }
    };

    const FinanceAPI = {
        _addOp(op) {
            const ops = State.getOps();
            op.id = nextId(ops);
            Object.keys(op).forEach(k => { if (op[k] === "" || op[k] == null) delete op[k]; });
            ops.push(op);
            State.setOps(ops);
            return op.id;
        },

        exists(opId) {
            return opId != null && State.getOps().some(o => String(o.id) === String(opId));
        },

        // Трата (уменьшает баланс кошелька)
        spend({ date, wallet, amount, category, note, ref, addCategory }) {
            amount = UI.r2(UI.num(amount));
            if (amount <= 0) throw new Error("Сумма должна быть больше нуля");

            const wallets = State.getWallets();
            if (wallets[wallet] === undefined) throw new Error("Кошелёк не найден");
            if (wallets[wallet] < amount) throw new Error(`Недостаточно средств. На «${wallet}» только ${UI.fmt(wallets[wallet])}`);

            wallets[wallet] = UI.r2(wallets[wallet] - amount);
            State.setWallets(wallets);
            bump("traty", category, amount);
            if (addCategory) ensureCat("expense", category);

            return this._addOp({ data: stamp(date), tip: "Трата", summa: amount, koshel: wallet, kat: category, zametka: note, baz: toBase(wallet, amount), ref });
        },

        // Доход (увеличивает баланс кошелька)
        receive({ date, wallet, amount, category, note, ref, addCategory }) {
            amount = UI.r2(UI.num(amount));
            if (amount <= 0) throw new Error("Сумма должна быть больше нуля");

            const wallets = State.getWallets();
            if (wallets[wallet] === undefined) throw new Error("Кошелёк не найден");

            wallets[wallet] = UI.r2(wallets[wallet] + amount);
            State.setWallets(wallets);
            bump("dohody", category, amount);
            if (addCategory) ensureCat("income", category);

            return this._addOp({ data: stamp(date), tip: "Доход", summa: amount, koshel: wallet, kat: category, zametka: note, baz: toBase(wallet, amount), ref });
        },

        // Перевод между кошельками одной валюты (конвертация — только в «Финансах»)
        transfer({ date, fromWallet, toWallet, amount, note }) {
            amount = UI.r2(UI.num(amount));
            if (amount <= 0) throw new Error("Сумма должна быть больше нуля");
            if (fromWallet === toWallet) throw new Error("Выберите разные кошельки");

            const wallets = State.getWallets();
            if (wallets[fromWallet] === undefined || wallets[toWallet] === undefined) throw new Error("Кошелёк не найден");
            if (walletCur(fromWallet) !== walletCur(toWallet)) throw new Error("Конвертацию между валютами делайте в «Финансах»");
            if (wallets[fromWallet] < amount) throw new Error("Недостаточно средств для перевода");

            wallets[fromWallet] = UI.r2(wallets[fromWallet] - amount);
            wallets[toWallet] = UI.r2(wallets[toWallet] + amount);
            State.setWallets(wallets);

            return this._addOp({ data: stamp(date), tip: "Перевод", summa: amount, koshel: fromWallet, kuda: toWallet, zametka: note });
        },

        // ====== Остальные денежные операции «Финансов» (раньше жили в fin.html) ======
        // Ошибки — Error с понятным текстом. Всё пишется в хранилище; страница после вызова перечитывает данные.
        _ym() { return stamp(null).slice(0, 7); },
        _pos(x) { x = UI.r2(UI.num(x)); if (!(x > 0)) throw new Error("Сумма должна быть больше нуля"); return x; },
        _wallets(w) { const ws = State.getWallets(); if (ws[w] === undefined) throw new Error("Кошелёк не найден"); return ws; },
        _rec(tip, s, w, o) {
            const z = Object.assign({ data: stamp(o && o.date), tip, summa: s, koshel: w }, o);
            delete z.date;
            if (w && walletCur(w) !== "MDL" && ["Трата", "Доход", "Корректировка"].includes(tip)) z.baz = toBase(w, s);
            return this._addOp(z);
        },
        _card(id) {
            const cards = AppStorage.get("kartki", []) || [], c = cards.find(x => x.id === id);
            if (!c) throw new Error("Карта не найдена");
            return { cards, c };
        },

        // Конвертация между кошельками разных валют
        convert({ date, fromWallet, toWallet, amount, received, note }) {
            const s = this._pos(amount);
            if (fromWallet === toWallet) throw new Error("Выберите разные кошельки");
            const ws = this._wallets(fromWallet); this._wallets(toWallet);
            if (ws[fromWallet] < s) throw new Error(`Недостаточно средств на «${fromWallet}»`);
            if (walletCur(fromWallet) === walletCur(toWallet)) throw new Error("Валюты совпадают — используйте перевод");
            const t = UI.r2(UI.num(received));
            if (!(t > 0)) throw new Error("Укажи сумму к зачислению");
            ws[fromWallet] = UI.r2(ws[fromWallet] - s); ws[toWallet] = UI.r2(ws[toWallet] + t);
            State.setWallets(ws);
            return this._addOp({ data: stamp(date), tip: "Конвертация", summa: s, koshel: fromWallet, kuda: toWallet, summa_kuda: t, zametka: note });
        },

        // Корректировка баланса кошелька до реального остатка
        adjust({ wallet, actual, note }) {
            const ws = this._wallets(wallet), r = UI.r2(UI.num(actual));
            if (!isFinite(r) || r < 0) throw new Error("Остаток не может быть отрицательным");
            const d = UI.r2(r - ws[wallet]);
            if (!d) throw new Error("Уже совпадает");
            ws[wallet] = r; State.setWallets(ws);
            return this._rec("Корректировка", d, wallet, { zametka: note });
        },

        // --- Кредитные карты ---
        payCard({ date, wallet, cardId, amount, note }) {
            const s = this._pos(amount), { cards, c } = this._card(cardId), ws = this._wallets(wallet);
            if (walletCur(wallet) !== "MDL") throw new Error("Платёж по карте — только с кошелька в леях");
            if (ws[wallet] < s) throw new Error(`Недостаточно средств на «${wallet}»`);
            if (s > c.dolg) throw new Error("Больше текущего долга по карте (" + UI.fmt(c.dolg) + ")");
            const pp = c.posl;
            ws[wallet] = UI.r2(ws[wallet] - s); c.dolg = UI.r2(c.dolg - s);
            if (!c.min || s >= c.min || c.dolg <= 0) c.posl = this._ym();
            State.setWallets(ws); AppStorage.set("kartki", cards);
            return this._rec("Кредитка", s, wallet, { date, kat: c.nazvanie, napr: "платёж", cid: c.id, pp, zametka: note });
        },
        cardBuy({ date, cardId, category, amount, note }) {
            const s = this._pos(amount), { cards, c } = this._card(cardId), av = UI.r2(c.limit - c.dolg);
            if (s > av) throw new Error("Превышен лимит. Доступно: " + UI.fmt(Math.max(0, av)));
            c.dolg = UI.r2(c.dolg + s); bump("traty", category, s);
            AppStorage.set("kartki", cards);
            return this._rec("Кредитка", s, c.nazvanie, { date, kat: category, napr: "покупка", cid: c.id, zametka: note });
        },
        cardFee({ date, cardId, amount, note }) {
            const s = this._pos(amount), { cards, c } = this._card(cardId);
            c.dolg = UI.r2(c.dolg + s); AppStorage.set("kartki", cards);
            return this._rec("Кредитка", s, c.nazvanie, { date, kat: c.nazvanie, napr: "проценты", cid: c.id, zametka: note });
        },
        cardCash({ date, cardId, wallet, amount }) {
            const s = this._pos(amount), { cards, c } = this._card(cardId), ws = this._wallets(wallet), av = UI.r2(c.limit - c.dolg);
            if (s > av) throw new Error("Превышен лимит. Доступно: " + UI.fmt(Math.max(0, av)));
            c.dolg = UI.r2(c.dolg + s); ws[wallet] = UI.r2(ws[wallet] + s);
            State.setWallets(ws); AppStorage.set("kartki", cards);
            return this._rec("Кредитка", s, wallet, { date, kat: c.nazvanie, napr: "снятие", cid: c.id });
        },
        // Привести долг по карте к значению debt (после правки параметров карты)
        cardAdjust({ cardId, debt }) {
            const { cards, c } = this._card(cardId), d = Math.abs(UI.r2(UI.num(debt))), df = UI.r2(d - c.dolg);
            if (!df) return null;
            c.dolg = d; AppStorage.set("kartki", cards);
            return this._rec("Кредитка", Math.abs(df), c.nazvanie, { kat: c.nazvanie, napr: "корректировка", cid: c.id, d: df });
        },
        undoCard(opId) {
            const ops = State.getOps(), z = ops.find(x => String(x.id) === String(opId));
            if (!z) return false;
            const { cards, c } = this._card(z.cid), ws = State.getWallets(), s = z.summa, n = z.napr;
            if (n === "покупка") { c.dolg = UI.r2(c.dolg - s); bump("traty", z.kat, -s); }
            else if (n === "проценты") { c.dolg = UI.r2(c.dolg - s); }
            else if (n === "платёж") {
                if (!(z.koshel in ws)) throw new Error("Кошелёк из операции удалён");
                c.dolg = UI.r2(c.dolg + s); ws[z.koshel] = UI.r2(ws[z.koshel] + s); c.posl = z.pp || "";
            } else if (n === "снятие") {
                if (!(z.koshel in ws) || ws[z.koshel] < s) throw new Error("На кошельке уже меньше этой суммы");
                ws[z.koshel] = UI.r2(ws[z.koshel] - s); c.dolg = UI.r2(c.dolg - s);
            } else if (n === "корректировка") { c.dolg = UI.r2(c.dolg - z.d); }
            else throw new Error("Эту операцию нельзя отменить");
            c.dolg = Math.max(0, c.dolg);
            ops.splice(ops.indexOf(z), 1);
            State.setOps(ops); State.setWallets(ws); AppStorage.set("kartki", cards);
            return true;
        },

        // --- Кредиты и ломбард ---
        payCredit({ date, creditId, wallet, amount }) {
            let s = this._pos(amount);
            const ks = AppStorage.get("kredity", []) || [], k = ks.find(x => x.id === creditId);
            if (!k) throw new Error("Кредит не найден");
            const ws = this._wallets(wallet);
            const pr = Math.min(s, UI.r2(k.ostatok * k.stavka / 1200)), os = UI.r2(Math.min(k.ostatok, s - pr));
            s = UI.r2(pr + os);
            if (ws[wallet] < s) throw new Error("Недостаточно средств");
            const pp = k.posl;
            ws[wallet] = UI.r2(ws[wallet] - s); k.ostatok = UI.r2(k.ostatok - os); k.posl = this._ym();
            State.setWallets(ws); AppStorage.set("kredity", ks);
            return this._rec("Кредит", s, wallet, { date, kat: k.nazvanie, napr: "платёж", osn: os, proc: pr, cid: k.id, pp });
        },
        // mode "interest": только проценты (за months месяцев), тело не трогаем.
        // mode "full" (по умолчанию): сначала проценты за текущий месяц, остаток — в тело долга.
        payLombard({ date, wallet, amount, mode, months }) {
            const ym = this._ym(), lomb = AppStorage.get("lombard", []) || [];
            const I = AppStorage.get("lombard_info", { stavka: 3, den: 25, koshel: "Наличные", proc_ym: "", proc_sum: 0 });
            const LO = () => lomb.filter(b => b.ostatok > 0.005);
            if (!LO().length) throw new Error("Нет открытых займов");
            const st = Calc.lombard(ym), only = mode === "interest";
            const k = Math.max(1, Math.round(UI.num(months)) || 1);
            const tot = UI.r2(LO().reduce((a, b) => a + b.ostatok, 0));
            let s = this._pos(amount);
            if (!only) s = Math.min(s, UI.r2(st.due + tot));
            const ws = this._wallets(wallet);
            if (ws[wallet] < s) throw new Error("Недостаточно средств");
            const pi = { proc_ym: I.proc_ym || "", proc_sum: +I.proc_sum || 0 };
            const pr = only ? s : Math.min(s, st.due); let rest = UI.r2(s - pr); const det = [];
            if (!only) LO().forEach(b => {
                if (rest <= 0) return;
                const x = Math.min(rest, b.ostatok);
                b.ostatok = UI.r2(b.ostatok - x); rest = UI.r2(rest - x); det.push([b.id, x]);
                if (b.ostatok <= 0.005) b.ostatok = 0;
            });
            ws[wallet] = UI.r2(ws[wallet] - s);
            I.proc_ym = ym; I.proc_sum = UI.r2(st.paid + pr);
            State.setWallets(ws); AppStorage.set("lombard", lomb); AppStorage.set("lombard_info", I);
            return this._rec("Ломбард", s, wallet, { date, kat: "Ломбард", napr: "платёж", osn: UI.r2(s - pr), proc: pr, det,
                mes: only ? k : undefined, pi, zametka: only ? "проценты" + (k > 1 ? " за " + k + " мес." : "") : undefined });
        },

        // --- Долги людям ---
        debtNew({ date, borrowed, person, wallet, amount, note }) {
            const s = this._pos(amount), kk = String(person || "").trim();
            if (!kk) throw new Error("Укажи, кто");
            const ws = this._wallets(wallet);
            if (!borrowed && ws[wallet] < s) throw new Error("Недостаточно средств");
            ws[wallet] = UI.r2(ws[wallet] + (borrowed ? s : -s));
            const list = AppStorage.get("dolgi", []) || [];
            const d = { id: Math.max(0, ...list.map(x => x.id || 0)) + 1, kto: kk, napr: borrowed ? "Я должен" : "Мне должны", summa: s, ostatok: s, data: stamp(date), zametka: note };
            if (walletCur(wallet) !== "MDL") d.val = walletCur(wallet);
            list.push(d);
            State.setWallets(ws); AppStorage.set("dolgi", list);
            return this._rec("Долг", s, wallet, { date, kat: kk, napr: borrowed ? "взял" : "дал", zametka: note, did: d.id });
        },
        debtPay({ date, debtId, wallet, amount }) {
            const s = this._pos(amount), list = AppStorage.get("dolgi", []) || [], d = list.find(x => x.id === debtId);
            if (!d) throw new Error("Долг не найден");
            const me = d.napr === "Я должен", ws = this._wallets(wallet);
            if (s > d.ostatok) throw new Error("Больше остатка долга");
            if (me && ws[wallet] < s) throw new Error("Недостаточно средств");
            ws[wallet] = UI.r2(ws[wallet] + (me ? -s : s)); d.ostatok = UI.r2(d.ostatok - s);
            State.setWallets(ws); AppStorage.set("dolgi", list);
            return this._rec("Долг", s, wallet, { date, kat: d.kto, napr: me ? "вернул я" : "вернули мне", did: d.id });
        },

        // --- Цели накоплений ---
        goalMove({ date, goal, inn, wallet, amount }) {
            const s = this._pos(amount), celi = AppStorage.get("celi", {}) || {}, g = celi[goal];
            if (!g) throw new Error("Цель не найдена");
            const ws = this._wallets(wallet);
            if (inn) {
                if (ws[wallet] < s) throw new Error("Недостаточно средств");
                ws[wallet] = UI.r2(ws[wallet] - s); g.nakopleno = UI.r2(g.nakopleno + s);
            } else {
                if (g.nakopleno < s) throw new Error("В цели меньше");
                g.nakopleno = UI.r2(g.nakopleno - s); ws[wallet] = UI.r2(ws[wallet] + s);
            }
            State.setWallets(ws); AppStorage.set("celi", celi);
            return this._rec("Цель", s, wallet, { date, kat: goal, napr: inn ? "in" : "out" });
        },

        // --- Откаты: кредит, ломбард, долг, цель, конвертация ---
        _op(opId) { const ops = State.getOps(), z = ops.find(x => String(x.id) === String(opId)); return { ops, z }; },
        _drop(ops, z) { ops.splice(ops.indexOf(z), 1); State.setOps(ops); },
        undoCredit(opId) {
            const { ops, z } = this._op(opId); if (!z) return false;
            const ks = AppStorage.get("kredity", []) || [];
            const k = ks.find(x => z.cid != null ? x.id === z.cid : x.nazvanie === z.kat) || ks.find(x => x.nazvanie === z.kat);
            if (!k) throw new Error("Кредит удалён — отменить платёж нельзя");
            if (ops.some(o => +o.id > +z.id && o.tip === "Кредит" && o.napr === "платёж" && (o.cid != null ? o.cid === k.id : o.kat === k.nazvanie)))
                throw new Error("Сначала отмените более поздний платёж по этому кредиту");
            const ws = this._wallets(z.koshel);
            ws[z.koshel] = UI.r2(ws[z.koshel] + (+z.summa || 0));
            k.ostatok = UI.r2(k.ostatok + (+z.osn || 0));
            k.posl = z.pp != null ? z.pp : (k.posl === String(z.data).slice(0, 7) ? "" : k.posl);
            State.setWallets(ws); AppStorage.set("kredity", ks); this._drop(ops, z);
            return true;
        },
        undoLombard(opId) {
            const { ops, z } = this._op(opId); if (!z) return false;
            if (ops.some(o => +o.id > +z.id && o.tip === "Ломбард" && o.napr === "платёж"))
                throw new Error("Сначала отмените более поздний платёж по ломбарду");
            const ws = this._wallets(z.koshel);
            const lomb = AppStorage.get("lombard", []) || [], I = AppStorage.get("lombard_info", {}) || {};
            (z.det || []).forEach(d => { const b = lomb.find(q => q.id === d[0]); if (b) b.ostatok = UI.r2(b.ostatok + d[1]); });
            if (z.pi) { I.proc_ym = z.pi.proc_ym; I.proc_sum = z.pi.proc_sum; }
            else if (I.proc_ym === String(z.data).slice(0, 7)) I.proc_sum = Math.max(0, UI.r2((+I.proc_sum || 0) - (+z.proc || 0)));
            ws[z.koshel] = UI.r2(ws[z.koshel] + (+z.summa || 0));
            State.setWallets(ws); AppStorage.set("lombard", lomb); AppStorage.set("lombard_info", I); this._drop(ops, z);
            return true;
        },
        undoDebt(opId) {
            const { ops, z } = this._op(opId); if (!z) return false;
            const list = AppStorage.get("dolgi", []) || [], d = list.find(x => x.id === z.did);
            if (!d) throw new Error("Долг удалён — отменить операцию нельзя");
            const ws = this._wallets(z.koshel), s = +z.summa || 0, w = z.koshel, n = z.napr;
            if (n === "взял" || n === "дал") {
                if (Math.abs(d.ostatok - d.summa) > 0.005) throw new Error("По долгу уже были платежи — сначала отмените их");
                if (n === "взял") { if (ws[w] < s) throw new Error("На кошельке уже меньше этой суммы"); ws[w] = UI.r2(ws[w] - s); }
                else ws[w] = UI.r2(ws[w] + s);
                list.splice(list.indexOf(d), 1);
            } else if (n === "вернул я") { ws[w] = UI.r2(ws[w] + s); d.ostatok = UI.r2(d.ostatok + s); }
            else if (n === "вернули мне") {
                if (ws[w] < s) throw new Error("На кошельке уже меньше этой суммы");
                ws[w] = UI.r2(ws[w] - s); d.ostatok = UI.r2(d.ostatok + s);
            } else throw new Error("Эту операцию нельзя отменить");
            State.setWallets(ws); AppStorage.set("dolgi", list); this._drop(ops, z);
            return true;
        },
        undoGoal(opId) {
            const { ops, z } = this._op(opId); if (!z) return false;
            const celi = AppStorage.get("celi", {}) || {}, g = celi[z.kat];
            if (!g) throw new Error("Цель удалена — отменить операцию нельзя");
            const ws = this._wallets(z.koshel), s = +z.summa || 0, w = z.koshel;
            if (z.napr === "in") {
                if (g.nakopleno < s) throw new Error("В цели уже меньше этой суммы");
                g.nakopleno = UI.r2(g.nakopleno - s); ws[w] = UI.r2(ws[w] + s);
            } else {
                if (ws[w] < s) throw new Error("На кошельке уже меньше этой суммы");
                ws[w] = UI.r2(ws[w] - s); g.nakopleno = UI.r2(g.nakopleno + s);
            }
            State.setWallets(ws); AppStorage.set("celi", celi); this._drop(ops, z);
            return true;
        },
        undoConvert(opId) {
            const { ops, z } = this._op(opId); if (!z) return false;
            const ws = State.getWallets(), t = +z.summa_kuda || 0;
            if (ws[z.koshel] === undefined || ws[z.kuda] === undefined) throw new Error("Кошелёк из этой операции удалён");
            if (ws[z.kuda] < t) throw new Error("На кошельке назначения уже меньше этой суммы");
            ws[z.koshel] = UI.r2(ws[z.koshel] + (+z.summa || 0)); ws[z.kuda] = UI.r2(ws[z.kuda] - t);
            State.setWallets(ws); this._drop(ops, z);
            return true;
        },

        // Полный откат операции. Возвращает true, если откатили; бросает Error, если нельзя.
        // Типы Кредит / Ломбард / Кредитка / Долг / Цель / Конвертация откатываются только в «Финансах».
        undo(opId) {
            const ops = State.getOps();
            const idx = ops.findIndex(o => String(o.id) === String(opId));
            if (idx === -1) return false;

            const op = ops[idx], wallets = State.getWallets();
            if (op.tip === "Кредитка") return this.undoCard(opId);
            if (op.tip === "Кредит") return this.undoCredit(opId);
            if (op.tip === "Ломбард") return this.undoLombard(opId);
            if (op.tip === "Долг") return this.undoDebt(opId);
            if (op.tip === "Цель") return this.undoGoal(opId);
            if (op.tip === "Конвертация") return this.undoConvert(opId);
            const tip = op.tip, s = Math.abs(+op.summa || 0), w = op.koshel, to = op.kuda, cat = op.kat;
            if (!["Трата", "Доход", "Перевод", "Корректировка"].includes(tip)) throw new Error("Эту операцию можно отменить только в «Финансах»");
            if (wallets[w] === undefined || (tip === "Перевод" && wallets[to] === undefined)) throw new Error("Кошелёк из этой операции удалён");

            if (tip === "Трата") { wallets[w] = UI.r2(wallets[w] + s); bump("traty", cat, -s); }
            else if (tip === "Доход") {
                if (wallets[w] < s) throw new Error("На кошельке уже меньше этой суммы");
                wallets[w] = UI.r2(wallets[w] - s); bump("dohody", cat, -s);
            } else if (tip === "Корректировка") {
                const v = UI.r2(wallets[w] - (+op.summa || 0));
                if (v < 0) throw new Error("Баланс станет отрицательным");
                wallets[w] = v;
            } else {
                if (wallets[to] < s) throw new Error("На кошельке назначения уже меньше");
                wallets[w] = UI.r2(wallets[w] + s); wallets[to] = UI.r2(wallets[to] - s);
            }

            ops.splice(idx, 1);
            State.setOps(ops);
            State.setWallets(wallets);
            return true;
        },

        // ====== Справочники и правка: кошельки, категории, лимиты, операция ======
        // Всё это раньше жило в fin.html и «забывало» часть мест, где имя хранится строкой
        // (План, Скутер, регулярные платежи…). Теперь любое переименование/удаление идёт каскадом отсюда.
        _name(x, what) {
            x = String(x == null ? "" : x).replace(/\s+/g, " ").trim();
            if (!x) throw new Error("Пустое название" + (what ? " (" + what + ")" : ""));
            return x;
        },
        _cats() { const c = State.getCategories() || {}; return { expense: (c.expense || []).slice(), income: (c.income || []).slice() }; },
        _service: /Скутер|Топливо/, // категории «Скутера»: по ним он находит свои траты — их не переименовываем

        walletAdd({ name, currency, rate }) {
            name = this._name(name, "кошелёк"); currency = currency || "MDL";
            if (!["MDL", "USD", "EUR"].includes(currency)) throw new Error("Неизвестная валюта");
            const ws = State.getWallets();
            if (name in ws) throw new Error("Такой кошелёк уже есть");
            const kursy = AppStorage.get("kursy", {}) || {}; rate = UI.num(rate);
            if (currency !== "MDL" && !(rate > 0) && !(+kursy[currency] > 0)) throw new Error("Укажите курс к лею");
            ws[name] = 0; State.setWallets(ws);
            if (currency !== "MDL") {
                const v = AppStorage.get("valyuty", {}) || {}; v[name] = currency; AppStorage.set("valyuty", v);
                if (rate > 0) { kursy[currency] = rate; AppStorage.set("kursy", kursy); }
            }
            return name;
        },
        rateSet(currency, rate) {
            rate = UI.num(rate);
            if (!(rate > 0)) throw new Error("Курс должен быть больше нуля");
            const k = AppStorage.get("kursy", {}) || {}; k[currency] = rate; AppStorage.set("kursy", k);
        },
        walletRename(old, nw) {
            nw = this._name(nw, "кошелёк");
            const ws = State.getWallets();
            if (!(old in ws)) throw new Error("Кошелёк не найден");
            if (nw === old) return old;
            if (nw in ws) throw new Error("Такой кошелёк уже есть");
            const out = {}; Object.keys(ws).forEach(k => { out[k === old ? nw : k] = ws[k]; });
            State.setWallets(out);
            const ops = State.getOps();
            ops.forEach(z => { if (z && z.koshel === old) z.koshel = nw; if (z && z.kuda === old) z.kuda = nw; });
            State.setOps(ops);
            const val = AppStorage.get("valyuty", {}) || {};
            if (val[old]) { val[nw] = val[old]; delete val[old]; AppStorage.set("valyuty", val); }
            const fix = (key, f) => { if (!AppStorage.has(key)) return; const v = AppStorage.get(key, null); if (v != null) { f(v); AppStorage.set(key, v); } };
            const byW = list => (Array.isArray(list) ? list : Object.values(list || {})).forEach(r => { if (r && r.koshel === old) r.koshel = nw; });
            ["regulyarnye", "kredity", "kartki", "celi"].forEach(k => fix(k, byW));
            fix("lombard_info", I => { if (I && I.koshel === old) I.koshel = nw; });
            fix("plan_cfg", c => { if (c && c.potWallet === old) c.potWallet = nw; });
            // Скутер: кошелёк хранится в записях заправок и замен (для возврата денег при удалении записи)
            const hist = list => (Array.isArray(list) ? list : []).forEach(h => { if (h && h.wallet === old) h.wallet = nw; });
            fix("scooter_fuel", hist);
            AppStorage.keys().filter(k => /^(comp_|official_)/.test(k)).forEach(k => fix(k, d => hist(d && d.history)));
            return nw;
        },
        walletRemove(name) {
            const ws = State.getWallets();
            if (!(name in ws)) throw new Error("Кошелёк не найден");
            if (Object.keys(ws).length < 2) throw new Error("Нужен хотя бы один кошелёк");
            if (ws[name] !== 0) throw new Error("Сначала обнулите баланс (корректировка или перевод)");
            const goal = Object.keys(AppStorage.get("celi", {}) || {}).find(k => AppStorage.get("celi", {})[k].koshel === name);
            if (goal) throw new Error("Кошелёк привязан к цели «" + goal + "»");
            const card = (AppStorage.get("kartki", []) || []).find(c => c.koshel === name);
            if (card) throw new Error("Кошелёк привязан к карте «" + card.nazvanie + "»");
            const reg = (AppStorage.get("regulyarnye", []) || []).find(r => r.koshel === name);
            if (reg) throw new Error("Кошелёк используется в регулярном платеже «" + reg.nazvanie + "»");
            if ((AppStorage.get("plan_cfg", {}) || {}).potWallet === name) throw new Error("Кошелёк выбран в настройках «Плана»");
            delete ws[name]; State.setWallets(ws);
            const val = AppStorage.get("valyuty", {}) || {}; if (name in val) { delete val[name]; AppStorage.set("valyuty", val); }
        },

        // Переименование / слияние категории во всех местах: журнал, регулярные, лимиты, итоги, задачи «Плана»
        _recat(kind, old, nw) {
            const tip = kind === "expense" ? "Трата" : "Доход";
            const ops = State.getOps();
            ops.forEach(z => {
                if (!z) return;
                if (z.tip === tip && z.kat === old) z.kat = nw;
                else if (kind === "expense" && z.tip === "Кредитка" && z.napr === "покупка" && z.kat === old) z.kat = nw;
            });
            State.setOps(ops);
            const reg = AppStorage.get("regulyarnye", []) || [];
            reg.forEach(r => { if (r.tip === tip && r.kat === old) r.kat = nw; });
            AppStorage.set("regulyarnye", reg);
            const key = kind === "expense" ? "traty" : "dohody", m = AppStorage.get(key, {}) || {};
            if (old in m) { m[nw] = UI.r2((m[nw] || 0) + m[old]); delete m[old]; AppStorage.set(key, m); }
            if (kind === "expense") {
                const L = AppStorage.get("byudzhety", {}) || {};
                if (old in L) { L[nw] = nw in L ? UI.r2(L[nw] + L[old]) : L[old]; delete L[old]; AppStorage.set("byudzhety", L); }
                const BM = this._budgets(); let bch = false;
                Object.keys(BM).forEach(m => {
                    const l = BM[m] && BM[m].limits;
                    if (l && old in l) { l[nw] = nw in l ? UI.r2(l[nw] + l[old]) : l[old]; delete l[old]; bch = true; }
                    const nt = BM[m] && BM[m].notes;
                    if (nt && old in nt) { if (!nt[nw]) nt[nw] = nt[old]; delete nt[old]; bch = true; }
                });
                if (bch) AppStorage.set("budgets_m", BM);
                const plans = AppStorage.get("plans", null);
                if (plans && typeof plans === "object") {
                    let ch = false; const from = "cat:" + old.toLowerCase();
                    Object.values(plans).forEach(p => ((p && p.sections) || []).forEach(s => (s.tasks || []).forEach(t => {
                        if (t && typeof t.src === "string" && t.src.toLowerCase() === from) { t.src = "cat:" + nw; ch = true; }
                    })));
                    if (ch) AppStorage.set("plans", plans);
                }
            }
        },
        categoryAdd(kind, name) {
            name = this._name(name, "категория");
            const c = this._cats(), list = c[kind];
            if (!list) throw new Error("Неизвестный тип категории");
            if (list.some(x => x.toLowerCase() === name.toLowerCase())) throw new Error("Уже есть такая категория");
            list.push(name); State.setCategories(c); return name;
        },
        categoryRename(kind, old, nw) {
            nw = this._name(nw, "категория");
            const c = this._cats(), list = c[kind] || [], i = list.indexOf(old);
            if (i < 0) throw new Error("Категория не найдена");
            if (this._service.test(old) || this._service.test(nw)) throw new Error("Категории «Скутера» служебные: по ним он находит свои траты");
            if (nw.toLowerCase() !== old.toLowerCase() && list.some(x => x.toLowerCase() === nw.toLowerCase())) throw new Error("Такая категория уже есть");
            list[i] = nw; State.setCategories(c);
            this._recat(kind, old, nw);
            return nw;
        },
        // moveTo — куда перенести операции (обязательно, если по категории уже есть операции)
        categoryRemove(kind, name, moveTo) {
            const c = this._cats(), list = c[kind] || [], i = list.indexOf(name);
            if (i < 0) throw new Error("Категория не найдена");
            if (this._service.test(name)) throw new Error("Категории «Скутера» служебные — их нельзя удалять");
            const tip = kind === "expense" ? "Трата" : "Доход";
            const used = State.getOps().filter(z => z && z.tip === tip && z.kat === name).length;
            if (used && !moveTo) throw new Error("Укажите категорию, куда перенести операции (" + used + ")");
            if (moveTo && (moveTo === name || !list.includes(moveTo))) throw new Error("Неверная категория для переноса");
            list.splice(i, 1); State.setCategories(c);
            if (moveTo) this._recat(kind, name, moveTo);
            else if (kind === "expense") this.limitRemove(name);
        },

        // Лимиты бюджета по категориям трат (ключ byudzhety — общий для «Финансов» и «Бюджета»)
        // Бюджеты хранятся по месяцам (ключ budgets_m): { "ГГГГ-ММ": { limits, cfg } }. Старый byudzhety — только для «Финансов».
        _budgets() { const b = AppStorage.get("budgets_m", {}); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; },
        _emptyBudget() { return { limits: {}, notes: {}, cfg: { salary: null, extra: 0, save: 0 } }; },
        _bm(B, ym) { const e = B[ym] = B[ym] && typeof B[ym] === "object" ? B[ym] : this._emptyBudget(); e.limits = e.limits || {}; e.notes = e.notes || {}; return e; },
        // Создать бюджет месяца: пустой или копией другого месяца (лимиты + параметры)
        budgetCreate(ym, fromYm) {
            ym = ym || UI.date.month();
            const B = this._budgets();
            if (B[ym]) throw new Error("Бюджет на этот месяц уже создан");
            const src = fromYm && B[fromYm];
            B[ym] = src ? JSON.parse(JSON.stringify({ limits: src.limits || {}, notes: src.notes || {}, cfg: src.cfg || this._emptyBudget().cfg })) : this._emptyBudget();
            AppStorage.set("budgets_m", B);
        },
        budgetDelete(ym) {
            const B = this._budgets();
            if (ym in B) { delete B[ym]; AppStorage.set("budgets_m", B); }
        },
        // note: undefined — комментарий не трогаем; пустая строка — убираем; иначе сохраняем (до 200 символов)
        limitSet(cat, amount, ym, note) {
            cat = this._name(cat, "категория"); amount = this._pos(amount);
            const B = this._budgets(), e = this._bm(B, ym || UI.date.month());
            e.limits[cat] = amount;
            if (note !== undefined) {
                const t = String(note == null ? "" : note).trim().slice(0, 200);
                if (t) e.notes[cat] = t; else delete e.notes[cat];
            }
            AppStorage.set("budgets_m", B);
        },
        // ym не указан — убрать лимит этой категории во всех месяцах (например, при удалении категории)
        limitRemove(cat, ym) {
            const B = this._budgets(); let ch = false;
            (ym ? [ym] : Object.keys(B)).forEach(m => {
                const l = B[m] && B[m].limits, nt = B[m] && B[m].notes;
                if (l && cat in l) { delete l[cat]; ch = true; }
                if (nt && cat in nt) { delete nt[cat]; ch = true; }
            });
            if (ch) AppStorage.set("budgets_m", B);
        },
        // Параметры бюджета месяца: ожидаемая зарплата (null = авто), прочие доходы, откладывание
        // Не переданные поля берутся из текущих параметров месяца. salMode: "avg" | "actual"; extraMode: "auto" | "fact" | "manual" | "none"
        budgetConfigSet(c, ym) {
            const B = this._budgets(), e = this._bm(B, ym || UI.date.month()), old = e.cfg || {};
            const pick = k => c[k] !== undefined ? c[k] : old[k];
            const salary = pick("salary"), extra = pick("extra"), save = pick("save");
            const salMode = pick("salMode") || "avg", extraMode = pick("extraMode") || "auto";
            const extraNote = String(pick("extraNote") == null ? "" : pick("extraNote")).trim().slice(0, 200);
            const blank = x => x === "" || x == null;
            const n = x => blank(x) ? 0 : UI.num(x);
            if (n(extra) < 0 || n(save) < 0 || (!blank(salary) && UI.num(salary) < 0)) throw new Error("Суммы не могут быть отрицательными");
            if (!["avg", "actual"].includes(salMode) || !["auto", "fact", "manual", "none"].includes(extraMode)) throw new Error("Неизвестный режим");
            e.cfg = { salary: blank(salary) ? null : UI.r2(UI.num(salary)), extra: UI.r2(n(extra)), save: UI.r2(n(save)), salMode, extraMode, extraNote };
            AppStorage.set("budgets_m", B);
        },

        // Правка траты/дохода: баланс, итоги по категориям и базовая сумма (baz) пересчитываются вместе
        opEdit({ id, category, amount, date, wallet, note }) {
            const ops = State.getOps(), z = ops.find(x => x && String(x.id) === String(id));
            if (!z) throw new Error("Операция не найдена");
            if (z.ref) throw new Error("Операция создана в «Учёте» или «Скутере» — меняйте её там");
            if (z.tip !== "Трата" && z.tip !== "Доход") throw new Error("Менять можно только траты и доходы");
            amount = this._pos(amount); category = this._name(category, "категория");
            const ws = State.getWallets();
            if (ws[wallet] === undefined) throw new Error("Кошелёк не найден");
            if (ws[z.koshel] === undefined) throw new Error("Кошелёк из этой операции удалён");
            const sg = z.tip === "Трата" ? -1 : 1;
            ws[z.koshel] = UI.r2(ws[z.koshel] - sg * z.summa);
            ws[wallet] = UI.r2(ws[wallet] + sg * amount);
            if (ws[z.koshel] < 0 || ws[wallet] < 0) throw new Error("Не хватит денег на кошельке");
            const key = z.tip === "Трата" ? "traty" : "dohody";
            bump(key, z.kat, -z.summa); bump(key, category, amount);
            z.kat = category; z.summa = amount; z.koshel = wallet;
            if (note) z.zametka = note; else delete z.zametka;
            if (/^\d{4}-\d{2}-\d{2}$/.test(date || "")) z.data = date + " " + ((z.data || "").slice(11) || "12:00");
            const b = toBase(wallet, amount); if (b == null) delete z.baz; else z.baz = b;
            State.setWallets(ws); State.setOps(ops);
            ensureCat(z.tip === "Трата" ? "expense" : "income", category);
            return true;
        }
    };

    global.FinanceAPI = FinanceAPI;
})(window);
