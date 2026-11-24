/**
 * selectors.js — единые расчёты для всех страниц (Calc).
 * Страницы ничего не считают сами: берут цифры отсюда, поэтому не расходятся.
 * Читает через State / AppStorage; пишет только setSalaryClosed.
 */
(function (global) {
    const num = v => Number(v) || 0;
    const sumBy = (a, f) => a.reduce((s, x) => s + f(x), 0);
    const catHas = (o, w) => String(o.cat || "").includes(w);

    // Операция журнала -> { date, kind: expense|income, cat, amount } или null (переводы, долги, цели и т.д. не считаются)
    function normOp(o) {
        if (!o || typeof o !== "object") return null;
        const date = String(o.data || o.date || "").slice(0, 10);
        const base = num(o.baz != null ? o.baz : o.summa);
        switch (o.tip) {
            case "Трата": return { date, kind: "expense", cat: o.kat, amount: base };
            case "Доход": return { date, kind: "income", cat: o.kat, amount: base };
            case "Кредитка":
                if (o.napr === "покупка") return { date, kind: "expense", cat: o.kat, amount: num(o.summa) };
                if (o.napr === "проценты") return { date, kind: "expense", cat: "💳 Проценты по кредиткам", amount: num(o.summa) };
                return null;
            case "Кредит":
            case "Ломбард":
                return o.napr === "платёж" && num(o.proc) > 0
                    ? { date, kind: "expense", cat: o.tip === "Кредит" ? "🏛 Проценты по кредитам" : "🥇 Проценты по ломбарду", amount: num(o.proc) }
                    : null;
            default: return null;
        }
    }
    const isExpense = o => !!o && o.kind === "expense";
    // Прочие доходы. «Зарплата» исключена: она учтена по дням, а получение — отдельная сущность (см. salary)
    const isIncome = o => !!o && o.kind === "income" && !String(o.cat || "").includes("Зарплата");
    const ops = () => State.getOps().map(normOp).filter(Boolean);

    // Зарплата за месяц: начислено (по дням), получено (операции «Доход» с ref salary), остаток
    const salaryReceipts = ym => State.getOps()
        .filter(o => o.tip === "Доход" && o.ref && o.ref.t === "salary" && o.ref.ym === ym)
        .sort((a, b) => String(b.data).localeCompare(String(a.data)));
    function salary(ym) {
        const days = State.getDays() || {};
        const accrued = sumBy(Object.keys(days).filter(k => k.startsWith(ym)), k => num(days[k].total));
        const received = sumBy(salaryReceipts(ym), o => num(o.summa));
        // «Закрытый» месяц считается полученным целиком (для старых месяцев, когда деньги получили раньше)
        const closed = !!((AppStorage.get("salary_closed", {}) || {})[ym]);
        return { accrued, received, closed, due: closed ? 0 : Math.max(0, Math.round((accrued - received) * 100) / 100) };
    }
    function setSalaryClosed(ym, v) {
        const m = AppStorage.get("salary_closed", {}) || {};
        if (v) m[ym] = true; else delete m[ym];
        AppStorage.set("salary_closed", m);
    }

    // Всё за месяц ym ("ГГГГ-ММ")
    function month(ym) {
        const days = State.getDays() || {};
        const dayKeys = Object.keys(days).filter(k => k.startsWith(ym)).sort();
        let sal = 0, orders = 0, workDays = 0, night = 0, ap = 0;
        dayKeys.forEach(k => {
            const r = days[k], n = num(r.night), a = num(r.ap), t = num(r.total);
            sal += t; night += n; ap += a; orders += n + a;
            if (n + a > 0 || t > 0) workDays++;
        });
        const mOps = ops().filter(o => o.date.startsWith(ym));
        const expenseOps = mOps.filter(isExpense);
        const incomeOps = mOps.filter(isIncome);
        const sumAbs = list => sumBy(list, o => Math.abs(num(o.amount)));
        const expenses = sumAbs(expenseOps), income = sumAbs(incomeOps);

        // Топливо берём из журнала заправок, если его нет — из расходов категории «Топливо»
        const fuels = State.getFuel().filter(f => String(f.date || "").startsWith(ym));
        const fuelFromLog = sumBy(fuels, f => num(f.total != null ? f.total : f.amount));
        const fuelCost = fuelFromLog > 0 ? fuelFromLog : sumAbs(expenseOps.filter(o => catHas(o, "Топливо")));
        // «Топливо (Скутер)» тоже содержит слово «Скутер» — исключаем, чтобы не считать дважды
        const scooterNonFuel = expenseOps.filter(o => catHas(o, "Скутер") && !catHas(o, "Топливо"));
        const maintCost = sumAbs(scooterNonFuel);
        const washCost = sumAbs(scooterNonFuel.filter(o => /мойк/i.test(String(o.cat || ""))));
        const sr = salary(ym);
        return {
            ym, dayKeys, salary: sal, totalOrders: orders, workDays, nightSum: night, apSum: ap,
            expenseOps, incomeOps, expenses, income, net: sal + income - expenses,
            fuels, fuelCost, maintCost, washCost, serviceCost: maintCost - washCost,
            salaryReceived: sr.received, salaryDue: sr.due
        };
    }

    // Пройденные км по датам. Новые записи: trip; прежние: км за день (меньше стартового показания) или показание одометра.
    function kmDeltas() {
        const sc = State.getScooter() || {}, startKm = num(sc.startKm), out = [];
        const log = State.getMileageLog()
            .map(e => ({ date: String(e.date || ""), km: num(e.km), trip: e.trip != null ? num(e.trip) : null }))
            .filter(e => e.date);
        let odoL = startKm;
        log.filter(e => e.trip == null && e.km > 0).sort((a, b) => a.date.localeCompare(b.date)).forEach(e => {
            let d;
            if (e.km >= startKm) { d = Math.max(0, e.km - odoL); odoL = Math.max(odoL, e.km); }
            else { d = e.km; odoL += e.km; }
            out.push({ date: e.date, km: d });
        });
        log.filter(e => e.trip != null).forEach(e => out.push({ date: e.date, km: e.trip }));
        return out;
    }

    // Скутер за месяц: цена литра, пробег, расход, стоимость км. M — результат month(ym), если уже есть.
    function scooter(ym, M) {
        M = M || month(ym);
        const sc = State.getScooter() || {};
        const liters = sumBy(M.fuels, f => num(f.liters));
        const monthKm = sumBy(kmDeltas().filter(d => d.date.startsWith(ym)), d => d.km);
        const kmIsMonthly = monthKm > 0;
        return {
            liters,
            price: liters > 0 ? M.fuelCost / liters : 0,
            km: kmIsMonthly ? monthKm : Math.max(num(sc.currentKm) - num(sc.startKm), 0),
            kmIsMonthly,
            cons: kmIsMonthly ? liters / monthKm * 100 : 0,
            costKm: kmIsMonthly ? M.fuelCost / monthKm : 0
        };
    }


    // ===== Из «Плана»: общие функции (раньше жили в plan.html) =====
    const curYm = () => UI.date.month();
    const pnum = v => parseFloat(String(v || "").replace(/\s/g, "").replace(",", ".")) || 0;
    const isAuto = t => !!t.src && t.src !== "manual";
  // Приводим дату к YYYY-MM-DD (поддерживает и DD.MM.YYYY)
  function normDate(v) {
    const s = String(v || "").trim();
    const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
    return s.slice(0, 10);
  }

  // ---- Факт из «Финансов» (поддерживает оба формата журнала) ----
  function planOps() {
    return State.getOps().map(o => {
      const date = normDate(o.data || o.date);
      if (o.tip) {
        const base = Math.abs(+(o.baz != null ? o.baz : o.summa) || 0), s = Math.abs(+o.summa || 0);
        if (o.tip === "Трата") return { date, type: "exp", cat: o.kat || "", note: o.zametka || "", s: base };
        if (o.tip === "Кредитка") {
          if (o.napr === "покупка") return { date, type: "exp", cat: o.kat || "", note: o.zametka || "", s };
          if (o.napr === "платёж") return { date, type: "card", name: o.kat || "", s };
          return null;
        }
        if (o.tip === "Кредит" && o.napr === "платёж") return { date, type: "credit", name: o.kat || "", s };
        if (o.tip === "Ломбард" && o.napr === "платёж") return { date, type: "lombard", s };
        if (o.tip === "Долг" && o.napr === "вернул я") return { date, type: "debt", cat: o.kat || "", s };
        return null;
      }
      return null;
    }).filter(Boolean);
  }
  function autoFact(src, ym, OPS) {
    const inM = OPS.filter(o => o.date.startsWith(ym));
    if (src === "lombard" || src === "credit" || src === "card") return inM.filter(o => o.type === src).reduce((a, o) => a + o.s, 0);
    if (src.startsWith("credit:") || src.startsWith("card:")) {
      const tp = src.split(":")[0], name = src.slice(tp.length + 1).toLowerCase();
      return inM.filter(o => o.type === tp && String(o.name || "").toLowerCase() === name).reduce((a, o) => a + o.s, 0);
    }
    if (src.startsWith("reg:")) {
      const name = src.slice(4).toLowerCase();
      return inM.filter(o => o.type === "exp" && String(o.note || "").toLowerCase() === name).reduce((a, o) => a + o.s, 0);
    }
    if (src.startsWith("debt:")) {
      const who = src.slice(5).toLowerCase();
      return inM.filter(o => o.type === "debt" && o.cat.toLowerCase().includes(who)).reduce((a, o) => a + o.s, 0);
    }
    if (src.startsWith("cat:")) {
      const name = src.slice(4).toLowerCase();
      return inM.filter(o => o.type === "exp" && o.cat.toLowerCase().includes(name)).reduce((a, o) => a + o.s, 0);
    }
    return 0;
  }
  function finWanted() {
    const out = [];
    (AppStorage.get("kredity", []) || []).filter(k => +k.ostatok > 0).forEach(k => out.push({
      id: "fin_credit_" + k.id, title: "🏛 Кредит: " + k.nazvanie, plan: Math.round(+k.plat || 0),
      src: "credit:" + k.nazvanie, agg: "credit", name: k.nazvanie, note: k.den ? "Платёж до " + k.den + "-го" : ""
    }));
    (AppStorage.get("kartki", []) || []).filter(c => +c.dolg > 0).forEach(c => out.push({
      id: "fin_card_" + c.id, title: "💳 Карта: " + c.nazvanie,
      plan: Math.round(+c.min > 0 ? Math.min(+c.min, +c.dolg) : +c.dolg),
      src: "card:" + c.nazvanie, agg: "card", name: c.nazvanie,
      note: [c.den ? "Платёж до " + c.den + "-го" : "", +c.min > 0 ? "мин. " + UI.fmt(c.min) : ""].filter(Boolean).join(" · ")
    }));
    const lo = (AppStorage.get("lombard", []) || []).filter(b => +b.ostatok > 0.005);
    const info = AppStorage.get("lombard_info", {}) || {};
    const interest = Math.round(lo.reduce((a, b) => a + (+b.summa || 0), 0) * (+info.stavka || 0) / 100);
    if (lo.length && interest > 0) out.push({
      id: "fin_lombard", title: "🥇 Ломбард: проценты", plan: interest, src: "lombard", agg: "lombard",
      name: "ломбард", note: info.den ? "Платёж до " + info.den + "-го" : ""
    });
    (AppStorage.get("regulyarnye", []) || []).filter(r => r.tip === "Трата" && r.nazvanie).forEach(r => out.push({
      id: "fin_reg_" + r.nazvanie, title: "🔁 " + r.nazvanie, plan: Math.round(+r.summa || 0),
      src: "reg:" + r.nazvanie, agg: "", name: r.nazvanie, note: r.den ? r.den + "-го числа" : ""
    }));
    return out;
  }
  const SC_COMPONENTS = [
    { id: "oil", title: "🛢 Масло и расходники", interval: 2000, kw: ["масл"] },
    { id: "air_filter", title: "💨 Воздушный фильтр", interval: 3000, kw: ["фильтр"] },
    { id: "belt", title: "⚙ Ремень", interval: 10000, kw: ["ремен", "ремн"] },
    { id: "brakes", title: "🛑 Колодки", interval: 5000, kw: ["колодк"] }
  ];
  const SC_OFFICIALS = [
    { id: "tech", title: "🛠 Техосмотр", kw: ["техосмотр"] },
    { id: "tax", title: "💰 Налог на дорогу", kw: ["налог"] },
    { id: "insurance", title: "🛡 Страховка", kw: ["страхов"] }
  ];
  const SC_KM_SOON = 300; // за сколько км до замены предлагать задачу
  const SC_DAYS_SOON = 30; // за сколько дней до срока предлагать задачу
  const fmtD = ds => UI.date.ru(ds);
  const daysBetween = (a, b) => UI.date.diff(a, b);
  const addDaysStr = (ds, n) => UI.date.add(ds, n);
  function addMonthsStr(ds, n) {
    const [y, m, d] = ds.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, 1);
    const last = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
    dt.setDate(Math.min(d, last));
    return UI.date.local(dt);
  }
  function lastCost(hist) {
    const h = (hist || []).filter(x => +x.cost > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return h.length ? Math.round(+h[h.length - 1].cost) : 0;
  }
  // Та же логика, что в «Скутере»: первая замена — от покупки, дальше — от последней замены
  function compDue(c, data, sc) {
    const hist = Array.isArray(data.history) ? data.history : [];
    const hasLast = hist.length > 0 || +data.lastKm > 0;
    const base = hasLast
      ? { km: +data.lastKm || 0, date: data.lastDate || "", ik: +data.intervalKm > 0 ? +data.intervalKm : c.interval, im: +data.intervalMonths || 0 }
      : { km: sc.startKm, date: sc.purchaseDate || "", ik: +data.firstKm || 0, im: +data.firstMonths || 0 };
    const nextKm = base.ik > 0 ? base.km + base.ik : null;
    return {
      kmLeft: nextKm != null ? Math.round(nextKm - sc.currentKm) : null,
      nextDate: base.im > 0 && base.date ? addMonthsStr(base.date, base.im) : null
    };
  }
  function scWanted(ym) {
    const raw = AppStorage.get("scooter", {}) || {};
    const sc = { currentKm: +raw.currentKm || 0, startKm: +raw.startKm || 0, purchaseDate: raw.purchaseDate || "" };
    if (!(sc.startKm > 0)) return [];
    const cfg = AppStorage.get("plan_cfg", {}) || {};
    const kmSoon = cfg.scKm != null && cfg.scKm !== "" ? +cfg.scKm : SC_KM_SOON;
    const daysSoon = cfg.scDays != null && cfg.scDays !== "" ? +cfg.scDays : SC_DAYS_SOON;
    const isCur = ym === curYm(), t0 = UI.date.local();
    const [y, m] = ym.split("-").map(Number);
    const eom = ym + "-" + String(new Date(y, m, 0).getDate()).padStart(2, "0");
    const soon = addDaysStr(t0, daysSoon);
    const limit = isCur && soon > eom ? soon : eom;
    const out = [];
    SC_COMPONENTS.forEach(c => {
      const data = AppStorage.get("comp_" + c.id, {}) || {};
      const d = compDue(c, data, sc);
      const byKm = isCur && d.kmLeft != null && d.kmLeft <= kmSoon;
      const byDate = !!d.nextDate && d.nextDate <= limit;
      if (!byKm && !byDate) return;
      const parts = [];
      if (d.kmLeft != null) parts.push(d.kmLeft <= 0 ? "просрочено на " + Math.abs(d.kmLeft) + " км" : "осталось " + d.kmLeft + " км");
      if (d.nextDate) parts.push("до " + fmtD(d.nextDate));
      out.push({ id: "sc_comp_" + c.id, title: c.title, plan: lastCost(data.history), src: "cat:Скутер: " + c.title, kw: c.kw, note: parts.join(" · ") });
    });
    SC_OFFICIALS.forEach(o => {
      const data = AppStorage.get("official_" + o.id, {}) || {};
      if (!data.nextDate || data.nextDate > limit) return;
      const left = daysBetween(t0, data.nextDate);
      out.push({
        id: "sc_off_" + o.id, title: o.title, plan: lastCost(data.history) || Math.round(+data.cost || 0),
        src: "cat:Скутер: " + o.title, kw: o.kw, note: (left < 0 ? "срок вышел " : "действует до ") + fmtD(data.nextDate)
      });
    });
    return out;
  }

    // Итоги плана месяца. «Осталось внести» — только по незакрытым задачам: закрытая задача
    // (галочка или факт не меньше плана) больше ничего не должна, даже если факт меньше плана.
    function planSummary(ym) {
        const pl = (AppStorage.get("plans", {}) || {})[ym];
        if (!pl) return null;
        const OPS = planOps();
        let plan = 0, fact = 0, covered = 0, count = 0;
        const open = [];
        pl.sections.forEach(sec => sec.tasks.forEach(t => {
            const auto = isAuto(t), p = pnum(t.plan), f = auto ? Math.round(autoFact(t.src, ym, OPS)) : pnum(t.fact);
            const done = !!(t.done || (auto && p > 0 && f >= p));
            plan += p; fact += f; count++;
            covered += done ? p : Math.min(f, p);
            if (!done) open.push({ title: t.title, plan: p, fact: f, left: Math.max(0, p - f) });
        }));
        return { plan, fact, count, covered, diff: fact - plan, left: open.reduce((a, t) => a + t.left, 0), open };
    }

    // Ломбард: проценты за месяц ym и сколько уже оплачено. Переплата процентов переходит на следующие месяцы.
    // proc_ym / proc_sum в lombard_info = последний месяц, в котором платили, и сумма процентов, оплаченная к нему.
    function lombard(ym) {
        ym = ym || curYm();
        const lo = (AppStorage.get("lombard", []) || []).filter(b => +b.ostatok > 0.005);
        const info = AppStorage.get("lombard_info", {}) || {};
        const base = lo.reduce((a, b) => a + (+b.summa || 0), 0);
        const pm = Math.round(base * (+info.stavka || 0)) / 100;
        let m = String(info.proc_ym || ""), sum = m ? (+info.proc_sum || 0) : 0, n = 0;
        while (m && m < ym && n++ < 600) {
            sum = Math.max(0, Math.round((sum - pm) * 100) / 100);
            const p = m.split("-").map(Number), d = new Date(p[0], p[1], 1);
            m = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
        }
        if (m > ym) sum = 0;
        const r2 = x => Math.round(x * 100) / 100;
        return { ym, hasLoan: lo.length > 0, base, rate: +info.stavka || 0, den: +info.den || 0, pm, paid: sum,
            due: Math.max(0, r2(pm - sum)), ahead: Math.max(0, r2(sum - pm)) };
    }

    // Платежи из «Финансов», которые пора внести (кредиты, карты, ломбард, регулярные траты)
    function paymentsDue() {
        const now = new Date(), ym = curYm(), dom = now.getDate(), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const near = (den, lead) => den > 0 && dom >= Math.max(1, Math.min(den, dim) - lead);
        const late = den => dom > Math.min(den, dim);
        const out = [];
        (AppStorage.get("kredity", []) || []).filter(k => +k.ostatok > 0 && k.posl !== ym && near(+k.den, 5))
            .forEach(k => out.push({ icon: "🏛", title: k.nazvanie, sum: +k.plat || 0, den: +k.den, late: late(+k.den) }));
        (AppStorage.get("kartki", []) || []).filter(c => +c.dolg > 0 && c.posl !== ym && near(+c.den, 5))
            .forEach(c => out.push({ icon: "💳", title: c.nazvanie, sum: +c.min > 0 ? Math.min(+c.min, +c.dolg) : +c.dolg, den: +c.den, late: late(+c.den) }));
        const lo = (AppStorage.get("lombard", []) || []).filter(b => +b.ostatok > 0.005);
        const info = AppStorage.get("lombard_info", {}) || {};
        const due = lombard(ym).due;
        if (lo.length && due > 0 && near(+info.den, 5)) out.push({ icon: "🥇", title: "Ломбард: проценты", sum: due, den: +info.den, late: late(+info.den) });
        (AppStorage.get("regulyarnye", []) || []).filter(r => r.tip === "Трата" && r.posl !== ym && near(+r.den, 3))
            .forEach(r => out.push({ icon: "🔁", title: r.nazvanie, sum: +r.summa || 0, den: +r.den, late: late(+r.den) }));
        return out.sort((a, b) => a.den - b.den);
    }

    // Список всех возможных автозадач скутера (для настроек плана)
    const scItems = () => SC_COMPONENTS.map(c => ({ id: "sc_comp_" + c.id, title: c.title })).concat(SC_OFFICIALS.map(o => ({ id: "sc_off_" + o.id, title: o.title })));

    // ===== Бюджет месяца (единый расчёт для «Бюджета» и «Сегодня») =====
  // Служебные «категории» процентов входят в платежи по кредитам/картам/ломбарду — лимитов на них не ставим
  const SYS_CATS = ["💳 Проценты по кредиткам", "🏛 Проценты по кредитам", "🥇 Проценты по ломбарду"];
  // Бюджеты хранятся ПО МЕСЯЦАМ: budgets_m = { "ГГГГ-ММ": { limits: {категория: сумма}, cfg: {salary, extra, save} } }.
  // Нет записи за месяц = «бюджет не создан»: лимиты и параметры других месяцев не подтягиваются.
  const budgetsAll = () => { const b = AppStorage.get("budgets_m", {}); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };
  const budgetEntry = m => { const e = budgetsAll()[m]; return e && typeof e === "object" ? e : null; };
  const budgetExists = m => !!budgetEntry(m || curYm());
  const budgetMonths = () => Object.keys(budgetsAll()).filter(k => budgetEntry(k)).sort();
  function budgetCfg(m) {
    const c = (budgetEntry(m || curYm()) || {}).cfg || {};
    return {
      salary: c.salary == null || c.salary === "" ? null : UI.num(c.salary), extra: UI.num(c.extra), save: UI.num(c.save),
      // salMode: "avg" — среднее/заданное (по умолчанию), "actual" — фактически начислено по дням
      salMode: c.salMode === "actual" ? "actual" : "avg",
      // extraMode: "auto" — больше из заданного и фактического (по умолчанию), "fact", "manual", "none"
      extraMode: ["fact", "manual", "none"].includes(c.extraMode) ? c.extraMode : "auto"
    };
  }
  // Комментарии к лимитам: { категория: текст } (хранятся рядом с лимитами месяца, на расчёты не влияют)
  function budgetNotes(m) {
    const b = (budgetEntry(m || curYm()) || {}).notes || {}, o = {};
    Object.keys(b).forEach(k => { const t = String(b[k] == null ? "" : b[k]).trim(); if (t) o[k] = t; });
    return o;
  }
  function budgetLimits(m) {
    const b = (budgetEntry(m || curYm()) || {}).limits || {}, o = {};
    Object.keys(b).forEach(k => { if (UI.num(b[k]) > 0) o[k] = UI.num(b[k]); });
    return o;
  }
  // { "ГГГГ-ММ": { категория: сумма } } — по тем же правилам, что «Отчёты» (normOp)
  function expenseByMonth() {
    const out = {};
    ops().filter(isExpense).forEach(o => {
      const m = o.date.slice(0, 7); if (!m || !o.cat) return;
      const t = out[m] = out[m] || {};
      t[o.cat] = UI.r2((t[o.cat] || 0) + Math.abs(+o.amount || 0));
    });
    return out;
  }
  function expectedSalary(m, cfg) {
    const accrued = salary(m).accrued, cur = curYm();
    if (m < cur) return { v: accrued, src: "начислено по дням" };
    if (cfg.salMode === "actual") return { v: accrued, src: accrued > 0 ? "фактически начислено по дням" : "фактически: пока ничего не начислено" };
    if (cfg.salary != null) return { v: Math.max(cfg.salary, m === cur ? accrued : 0), src: "задано вручную" };
    const prev = [1, 2, 3, 4, 5, 6].map(i => salary(UI.date.shift(cur, -i)).accrued).filter(v => v > 0).slice(0, 3);
    const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
    if (m === cur && accrued > avg) return { v: accrued, src: "уже начислено" };
    return { v: Math.round(avg), src: prev.length ? "среднее за " + prev.length + " мес." : "нет данных — задайте вручную" };
  }
  function budget(m) {
    m = m || curYm();
    const exists = budgetExists(m), cfg = budgetCfg(m), limits = budgetLimits(m), notes = budgetNotes(m), today = UI.date.local(), cur = curYm();
    // откуда можно скопировать: ближайший ПРЕДЫДУЩИЙ месяц с бюджетом, иначе ближайший следующий
    const bms = budgetMonths().filter(k => k !== m), copyFrom = bms.filter(k => k < m).pop() || bms.filter(k => k > m)[0] || null;
    const dim = UI.date.daysIn(m);
    const dom = m < cur ? dim : m > cur ? 0 : +today.slice(8, 10);
    const daysLeft = m < cur ? 0 : m > cur ? dim : dim - dom + 1;
    const frac = dom / dim;

    const byM = expenseByMonth(), spent = byM[m] || {};
    const sal = expectedSalary(m, cfg);
    const factIncome = month(m).income;
    const otherIncome = cfg.extraMode === "fact" ? factIncome : cfg.extraMode === "manual" ? cfg.extra : cfg.extraMode === "none" ? 0 : Math.max(cfg.extra, factIncome);
    const otherSrc = { auto: "больше из заданного и фактического", fact: "только фактические за месяц", manual: "только заданная сумма", none: "не учитываются" }[cfg.extraMode];
    const income = sal.v + otherIncome;

    // обязательные платежи (кредиты / карты / ломбард): план и факт как в «Плане»
    const OPS = planOps();
    const fixed = finWanted().filter(w => w.agg).map(w => {
      const fact = Math.round(autoFact(w.src, m, OPS));
      return { title: w.title, note: w.note, plan: w.plan, fact, left: Math.max(0, w.plan - fact) };
    });
    // регулярные траты: если у категории есть лимит — они уже внутри лимита, иначе считаем отдельно
    const regs = (AppStorage.get("regulyarnye", []) || []).filter(r => r.tip === "Трата" && r.nazvanie).map(r => ({
      title: "🔁 " + r.nazvanie, note: r.den ? r.den + "-го числа" : "", plan: Math.round(UI.num(r.summa)), kat: r.kat, inLimit: limits[r.kat] != null
    }));
    const fixedPlan = fixed.reduce((a, x) => a + x.plan, 0) + regs.filter(r => !r.inLimit).reduce((a, x) => a + x.plan, 0);
    const limitsSum = Object.keys(limits).reduce((a, k) => a + limits[k], 0);
    const free = UI.r2(income - fixedPlan - limitsSum - cfg.save);

    const cats = Object.keys(limits).map(k => {
      const s = spent[k] || 0, l = limits[k], p = s / l;
      const proj = frac >= 0.15 && m === cur ? s / frac : null;
      let st = "g";
      if (s >= l) st = "r"; else if (p >= 0.8 || (proj != null && proj > l)) st = "o";
      return { name: k, spent: s, limit: l, note: notes[k] || "", pct: Math.round(p * 100), proj, st, left: Math.max(0, l - s) };
    }).sort((a, b) => b.pct - a.pct);
    const noLimit = Object.keys(spent).filter(k => limits[k] == null && !SYS_CATS.includes(k))
      .map(k => ({ name: k, spent: spent[k] })).sort((a, b) => b.spent - a.spent);
    const totalSpent = UI.r2(Object.keys(spent).reduce((a, k) => a + spent[k], 0));
    const varLeft = cats.reduce((a, c) => a + c.left, 0);

    // предложение лимитов: среднее по 3 предыдущим месяцам +5%
    const hist = [1, 2, 3].map(i => byM[UI.date.shift(m, -i)]).filter(Boolean), suggest = {};
    if (hist.length) {
      const all = new Set(); hist.forEach(h => Object.keys(h).forEach(k => all.add(k)));
      all.forEach(k => {
        if (SYS_CATS.includes(k) || limits[k] != null) return;
        const v = Math.ceil(hist.reduce((a, h) => a + (h[k] || 0), 0) / hist.length * 1.05 / 10) * 10;
        if (v >= 10) suggest[k] = v;
      });
    }
    return { m, exists, copyFrom, cfg, limits, dim, dom, daysLeft, frac, sal, otherIncome, otherSrc, factIncome, income, fixed, regs, fixedPlan, limitsSum, save: cfg.save, free,
      cats, noLimit, totalSpent, varLeft, perDay: daysLeft > 0 ? varLeft / daysLeft : 0, suggest, histN: hist.length };
  }

  global.Calc = { normOp, ops, isExpense, isIncome, salary, setSalaryClosed, salaryReceipts, month, kmDeltas, scooter, scItems, lombard,
        planOps, autoFact, planSummary, finWanted, scWanted, paymentsDue, budget, budgetCfg, budgetLimits, budgetNotes, budgetExists, budgetMonths };
})(window);
