import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Activity, ArrowDownRight, ArrowUpRight, Bell, BellOff, CircleGauge, Info, LoaderCircle,
  LockKeyhole, Search, Send, ShieldCheck, Sparkles, Target, TrendingUp,
  TriangleAlert, Volume2, WalletCards, Wifi, WifiOff, X, Zap,
} from "lucide-react";

type Mode = "bold" | "conservative";
type AlertKind = "demand" | "target1" | "target2";
type AlertSettings = Record<AlertKind, boolean>;
type RangeState = { demandLow: string; demandHigh: string; target1Low: string; target1High: string; target2Low: string; target2High: string };

const DEFAULT_WATCHLIST = ["AMAT", "TSLA", "NVDA", "PL"];
const DEFAULT_ALERTS: AlertSettings = { demand: false, target1: false, target2: false };
const WATCHLIST_KEY = "signal-desk-watchlist-v4";
const ALERTS_KEY = "signal-desk-alerts-v4";
const modes = {
  bold: { label: "المتداول الجريء", short: "جريء", subtitle: "اقتناص محسوب مع حماية رأس المال", initial: "25% — 33%", add: "إغلاق يومي مؤكد فوق المقاومة", action: "دخول جزئي مسموح", risk: "متوسط / مرتفع", riskDetail: "قبول تذبذب أعلى مقابل عدم تفويت الحركة" },
  conservative: { label: "المتداول المحافظ", short: "محافظ", subtitle: "تأكيد أولاً، ثم تحريك السيولة", initial: "0% — 25%", add: "إغلاق مؤكد أو ارتداد من الطلب", action: "انتظار التأكيد", risk: "منخفض / منضبط", riskDetail: "سيولة أكبر خارج السوق لتقليل أثر الانعكاس" },
};

function money(value: number) { return `$${value.toFixed(2)}`; }
function range(a: number, b: number) { return `${money(a)} — ${money(b)}`; }
function defaultRanges(symbol: string, price: number): RangeState {
  const values = symbol === "AMAT" ? [450, 460, 478, 483, 492, 505] : [price * .96, price * .99, price * 1.035, price * 1.045, price * 1.065, price * 1.09];
  return { demandLow: values[0].toFixed(2), demandHigh: values[1].toFixed(2), target1Low: values[2].toFixed(2), target1High: values[3].toFixed(2), target2Low: values[4].toFixed(2), target2High: values[5].toFixed(2) };
}
function levelsFor(symbol: string, price: number, custom?: RangeState) {
  const r = custom ?? defaultRanges(symbol, price);
  if (!price && symbol !== "AMAT") return { demand: "—", target1: "—", target2: "—", stop: "—", resistance: "—" };
  return { demand: range(Number(r.demandLow), Number(r.demandHigh)), target1: range(Number(r.target1Low), Number(r.target1High)), target2: range(Number(r.target2Low), Number(r.target2High)), stop: `إغلاق دون ${money(symbol === "AMAT" ? 438 : price * .93)}`, resistance: money(Number(r.target1Low) - 7) };
}
function formatBillions(value: number | null) { return value === null ? "—" : `$${(value / 1e9).toFixed(2)}B`; }
function formatPercent(value: number | null) { return value === null ? "—" : `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function readJson<T>(key: string, fallback: T): T { if (typeof window === "undefined") return fallback; try { const parsed = JSON.parse(window.localStorage.getItem(key) ?? "null"); return parsed ?? fallback; } catch { return fallback; } }
function playAlertTone() { if (typeof window === "undefined") return; try { const context = new AudioContext(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 880; oscillator.type = "sine"; gain.gain.setValueAtTime(0.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.45); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.46); } catch { /* audio may require a prior gesture */ } }

function LevelCard({ label, eyebrow, value, detail, tone, icon: Icon }: { label: string; eyebrow: string; value: string; detail: string; tone: string; icon: typeof Target }) {
  return <article className={`level-card level-${tone}`}><div className="level-topline"><span className="level-icon"><Icon size={16} strokeWidth={2.2} /></span><span className="eyebrow">{eyebrow}</span></div><h3>{label}</h3><div className="level-value">{value}</div><p>{detail}</p></article>;
}

export default function Home() {
  const [symbol, setSymbol] = useState("AMAT");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("bold");
  const [watchlist, setWatchlist] = useState<string[]>(() => readJson(WATCHLIST_KEY, DEFAULT_WATCHLIST));
  const [alerts, setAlerts] = useState<AlertSettings>(() => readJson(`${ALERTS_KEY}:AMAT`, DEFAULT_ALERTS));
  const [customRanges, setCustomRanges] = useState<RangeState>(() => defaultRanges("AMAT", 0));
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramEnabled, setTelegramEnabled] = useState(true);
  const [notice, setNotice] = useState("");
  const activeAlertRef = useRef<Record<string, boolean>>({});
  const marketQuery = trpc.market.quote.useQuery({ symbol }, { refetchInterval: 60000, retry: 1, staleTime: 30000 });
  const ruleQuery = trpc.alerts.rule.useQuery({ symbol });
  const historyQuery = trpc.alerts.history.useQuery({ limit: 25 });
  const telegramQuery = trpc.telegram.status.useQuery();
  const saveRule = trpc.alerts.saveRule.useMutation({ onSuccess: () => { setNotice("تم حفظ نطاقات التنبيه"); ruleQuery.refetch(); } });
  const recordLocal = trpc.alerts.recordLocal.useMutation({ onSuccess: () => historyQuery.refetch() });
  const saveTelegram = trpc.telegram.save.useMutation({ onSuccess: (data) => { setNotice("تم حفظ إعدادات Telegram"); setTelegramChatId(data.chatId); telegramQuery.refetch(); } });
  const testTelegram = trpc.telegram.test.useMutation({ onSuccess: () => setNotice("تم إرسال رسالة الاختبار إلى Telegram"), onError: (error) => setNotice(error.message) });
  const scheduleTelegram = trpc.telegram.schedule.useMutation({ onSuccess: () => { setNotice("تم تفعيل الفحص الخلفي كل دقيقة"); telegramQuery.refetch(); }, onError: (error) => setNotice(error.message) });
  const marketData = marketQuery.data;
  const price = marketData?.quote.price ?? 0;
  const change = marketData?.quote.change ?? 0;
  const percent = marketData?.quote.percent ?? 0;
  const apiMessage = marketQuery.isLoading ? "جاري جلب بيانات السوق..." : marketQuery.error ? "تعذر الوصول إلى المصدرين" : `متصل · ${marketData?.provider ?? "API"}`;
  const plan = modes[mode];
  const levels = useMemo(() => levelsFor(symbol, price, customRanges), [symbol, price, customRanges]);
  const companyName = marketData?.companyName ?? `${symbol} · Live API`;
  const financials = marketData?.fundamentals;
  const alertRanges = useMemo(() => ({ demand: [Number(customRanges.demandLow), Number(customRanges.demandHigh)] as const, target1: [Number(customRanges.target1Low), Number(customRanges.target1High)] as const, target2: [Number(customRanges.target2Low), Number(customRanges.target2High)] as const }), [customRanges]);

  useEffect(() => { window.localStorage.setItem(WATCHLIST_KEY, JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { setAlerts(readJson(`${ALERTS_KEY}:${symbol}`, DEFAULT_ALERTS)); }, [symbol]);
  useEffect(() => { window.localStorage.setItem(`${ALERTS_KEY}:${symbol}`, JSON.stringify(alerts)); }, [alerts, symbol]);
  useEffect(() => { const dbRule = ruleQuery.data; setCustomRanges(dbRule ? { demandLow: String(dbRule.demandLow), demandHigh: String(dbRule.demandHigh), target1Low: String(dbRule.target1Low), target1High: String(dbRule.target1High), target2Low: String(dbRule.target2Low), target2High: String(dbRule.target2High) } : defaultRanges(symbol, price)); }, [ruleQuery.data, symbol, price]);
  useEffect(() => { if (telegramQuery.data?.chatId) { setTelegramChatId(telegramQuery.data.chatId); setTelegramEnabled(telegramQuery.data.enabled); } }, [telegramQuery.data]);
  useEffect(() => {
    if (!marketData || !price) return;
    (Object.entries(alertRanges) as Array<[AlertKind, readonly [number, number]]>).forEach(([kind, [low, high]]) => {
      const key = `${symbol}:${kind}`; const inRange = price >= low && price <= high;
      if (!inRange) { activeAlertRef.current[key] = false; return; }
      if (alerts[kind] && !activeAlertRef.current[key]) {
        activeAlertRef.current[key] = true; playAlertTone();
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(`${symbol} · تنبيه سعري`, { body: `السعر ${money(price)} داخل ${kind === "demand" ? "منطقة الطلب" : "الهدف"}.` });
        recordLocal.mutate({ symbol, alertType: kind, price: price.toFixed(2), rangeLabel: range(low, high), provider: marketData.provider });
      }
    });
  }, [alerts, alertRanges, marketData, price, symbol]);

  function addToWatchlist(next: string) { setWatchlist((current) => current.includes(next) ? current : [...current, next].slice(-8)); }
  function submitSearch(event: FormEvent) { event.preventDefault(); const next = input.trim().toUpperCase().replace(/[^A-Z.\-]/g, ""); if (next) { addToWatchlist(next); setSymbol(next); setInput(""); } }
  async function toggleAlert(kind: AlertKind) { if (!alerts[kind] && typeof Notification !== "undefined" && Notification.permission === "default") await Notification.requestPermission(); setAlerts((current) => ({ ...current, [kind]: !current[kind] })); }
  function updateRange(key: keyof RangeState, value: string) { setCustomRanges((current) => ({ ...current, [key]: value })); }
  function saveCurrentRanges() { saveRule.mutate({ symbol, ...customRanges }); }
  function saveCurrentTelegram() { saveTelegram.mutate({ chatId: telegramChatId, enabled: telegramEnabled }); }
  const positive = change >= 0;
  const chartPath = positive ? "M0,57 C18,53 23,41 39,45 S59,29 77,35 S98,22 116,28 S138,16 153,22 S170,10 180,13" : "M0,16 C16,11 19,31 34,27 S56,25 66,34 S83,29 94,36 S111,28 120,42 S142,34 153,50 S169,46 180,59";
  const inputFields: Array<[keyof RangeState, string]> = [["demandLow", "طلب من"], ["demandHigh", "إلى"], ["target1Low", "هدف 1 من"], ["target1High", "إلى"], ["target2Low", "هدف 2 من"], ["target2High", "إلى"]];

  return <main dir="rtl" className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar container"><div className="brand-lockup"><div className="brand-mark"><Activity size={18} /></div><div><div className="brand-name">Signal Desk <span className="v2-badge">v5</span></div><div className="brand-sub">Equity intelligence · live workspace</div></div></div><div className="topbar-actions"><span className="live-dot"><i /> السوق مفتوح</span><button className="icon-button" aria-label="معلومات التطبيق"><Info size={17} /></button></div></header>
    <div className="sticky-tools"><div className="container tools-inner"><form className="search-box" onSubmit={submitSearch}><Search size={17} /><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="ابحث عن رمز سهم… مثل TSLA أو NVDA" aria-label="بحث عن رمز سهم" /><button type="submit">استدعاء</button></form><div className="watchlist"><span className="watch-label">مراقبة سريعة</span>{watchlist.map((item) => <span className="watch-item" key={item}><button className={item === symbol ? "watch-chip active" : "watch-chip"} onClick={() => setSymbol(item)}>{item}</button><button className="watch-remove" aria-label={`حذف ${item}`} onClick={() => setWatchlist((current) => current.filter((entry) => entry !== item))}><X size={11} /></button></span>)}</div></div></div>
    <section className="container hero-grid"><div className="hero-copy"><div className="breadcrumb"><span>US EQUITIES</span><b>/</b><span>{marketData?.exchange ?? "NASDAQ"}</span><b>/</b><strong>{symbol}</strong></div><div className="hero-title-row"><div className="ticker-badge">{symbol.slice(0, 1)}</div><div><div className="company-kicker">{companyName}</div><h1>{symbol} <span>{marketData?.exchange ?? "NASDAQ"}</span></h1></div></div><p className="hero-description">لوحة قرار مركّزة تجمع السعر، مناطق التنفيذ، وصحة الشركة في شاشة واحدة.</p><div className="data-stamp"><span className="pulse" /> {marketData ? new Date(marketData.quote.marketTime * 1000).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" }) : "جاري انتظار البيانات الحية"}</div></div>
      <div className="price-card glass-panel"><div className="price-card-head"><span>السعر اللحظي</span><span className={marketData ? "price-source live-source" : "price-source"}>{marketData ? <><Wifi size={12} /> {apiMessage}{marketData.fallbackUsed ? " · احتياطي" : ""}</> : <><WifiOff size={12} /> {apiMessage}</>}</span></div><div className="price-row"><div><div className="price">{price ? money(price) : "—"}</div><div className={positive ? "day-move positive-move" : "day-move"}>{positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />} {marketData ? `${positive ? "+" : ""}${money(change)}` : "—"} <b>{marketData ? `${positive ? "+" : ""}${percent.toFixed(2)}%` : "—"}</b></div></div><div className="spark-wrap"><svg viewBox="0 0 180 68" role="img" aria-label="رسم سعري مصغر"><defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={positive ? "#5ee0ba" : "#f27e77"} stopOpacity=".24" /><stop offset="1" stopColor={positive ? "#5ee0ba" : "#f27e77"} stopOpacity="0" /></linearGradient></defs><path className="spark-area" d={`${chartPath} L180,68 L0,68 Z`} /><path className={positive ? "spark-line positive-line" : "spark-line"} d={chartPath} /><circle cx="180" cy={positive ? "13" : "59"} r="3.5" className={positive ? "spark-point positive-point" : "spark-point"} /></svg></div></div><div className="trend-strip"><div className={positive ? "trend-badge trend-positive" : "trend-badge"}>{positive ? <TrendingUp size={15} /> : <TriangleAlert size={15} />} {marketData ? (positive ? "صاعد لحظياً" : "تصحيحي") : "بانتظار السعر"}</div><span>تحديث تلقائي كل 60 ثانية عبر proxy خادمي</span></div></div></section>
    <section className="container mode-section"><div className="mode-copy"><div className="section-label"><Sparkles size={14} /> قرار التنفيذ</div><h2>اختر إيقاعك</h2><p>المستويات ثابتة، لكن حجم الخطوة يتغير حسب قدرتك على تحمل الانعكاس.</p></div><div className="mode-toggle" role="group" aria-label="خطة التداول"><button className={mode === "bold" ? "active" : ""} onClick={() => setMode("bold")}><Zap size={15} /> خطة {modes.bold.short}</button><button className={mode === "conservative" ? "active" : ""} onClick={() => setMode("conservative")}><ShieldCheck size={15} /> خطة {modes.conservative.short}</button></div></section>
    <section className="container main-grid"><div className="levels-panel glass-panel"><div className="panel-heading"><div><span className="section-label"><Target size={14} /> Execution map · {symbol}</span><h2>خريطة المستويات</h2></div><span className="neutral-chip">Daily frame</span></div><div className="levels-grid"><LevelCard label="منطقة الطلب الأولى" eyebrow="DEMAND ZONE" value={levels.demand} detail="منطقة تفاعل متوقعة قرب المتوسطات القصيرة" tone="mint" icon={Target} /><LevelCard label="الهدف الأول" eyebrow="TARGET 01" value={levels.target1} detail="استعادة المقاومة القصيرة والمتوسط 50 يوم" tone="blue" icon={ArrowUpRight} /><LevelCard label="الهدف الثاني" eyebrow="TARGET 02" value={levels.target2} detail="منطقة امتداد الحركة بعد تثبيت الاختراق" tone="violet" icon={TrendingUp} /><LevelCard label="وقف الخسارة الصارم" eyebrow="HARD STOP" value={levels.stop} detail="إبطال الخطة التكتيكية على أساس الإغلاق اليومي" tone="coral" icon={LockKeyhole} /></div><p className="model-note"><Info size={13} /> النطاقات قابلة للتعديل والحفظ من لوحة إعدادات v5.</p></div>
      <aside className="side-stack"><article className="risk-panel glass-panel"><div className="panel-heading compact"><div><span className="section-label"><WalletCards size={14} /> Position sizing</span><h2>إدارة السيولة</h2></div><CircleGauge size={21} className="muted-icon" /></div><div className="allocation-visual"><div className="allocation-bar"><span style={{ width: mode === "bold" ? "31%" : "18%" }} /></div><div className="allocation-labels"><span>نقد متاح</span><strong>{plan.initial}</strong></div></div><div className="risk-row"><div><span className="mini-label">الدخول الأولي</span><strong>{plan.initial}</strong></div><div className={`status-pill ${mode === "bold" ? "mint" : "amber"}`}>{plan.action}</div></div><div className="add-rule"><div className="rule-icon"><ArrowUpRight size={17} /></div><div><span className="mini-label">شرط إضافة بقية السيولة</span><strong>{plan.add.replace("المقاومة", levels.resistance)}</strong><p>{mode === "bold" ? `أضف 25% أخرى بعد تأكيد ${levels.resistance}، والباقي بعد الهدف الأول.` : `لا دخول كامل قبل إغلاق مؤكد وإعادة اختبار ناجحة للمقاومة.`}</p></div></div><div className="risk-foot"><span>درجة المخاطرة</span><b>{plan.risk}</b><small>{plan.riskDetail}</small></div></article>
        <article className="financial-panel glass-panel"><div className="panel-heading compact"><div><span className="section-label"><TrendingUp size={14} /> Financial health</span><h2>الصحة المالية</h2></div><span className="health-score">{financials?.available ? "LIVE" : "—"}</span></div><div className="financial-metrics"><div><span>آخر إيرادات ربع سنوي</span><strong>{formatBillions(financials?.revenue ?? null)}</strong><b className="positive">{formatPercent(financials?.revenueGrowthYoY ?? null)} YoY</b></div><div><span>الهامش الصافي</span><strong>{formatPercent(financials?.netMargin ?? null)}</strong><b className="positive">{financials?.quarter ?? "—"}</b></div></div><p className="financial-note">{financials?.available ? `من ${marketData?.provider ?? "API"} · ${financials.quarter ?? "آخر ربع متاح"}. الهامش الإجمالي: ${formatPercent(financials.grossMargin)}.` : "تُحمّل البيانات المالية من المصدر الخادمي."}</p></article></aside></section>
    <section className="container v5-grid"><article className="glass-panel settings-panel"><div className="panel-heading compact"><div><span className="section-label"><Target size={14} /> Custom ranges</span><h2>إعدادات النطاقات · {symbol}</h2></div><span className="health-score">DB</span></div><p className="financial-note">عدّل أسعار الطلب والأهداف يدوياً، ثم احفظها في قاعدة البيانات لتستخدمها التنبيهات الخلفية.</p><div className="range-form">{inputFields.map(([key, label]) => <label key={key}><span>{label}</span><input inputMode="decimal" value={customRanges[key]} onChange={(event) => updateRange(key, event.target.value)} /></label>)}</div><button className="v5-primary" onClick={saveCurrentRanges} disabled={saveRule.isPending}>{saveRule.isPending ? "جاري الحفظ..." : "حفظ النطاقات"}</button></article>
      <article className="glass-panel settings-panel"><div className="panel-heading compact"><div><span className="section-label"><Send size={14} /> Telegram bot</span><h2>تنبيهات الهاتف</h2></div><span className={telegramQuery.data?.configured ? "health-score" : "neutral-chip"}>{telegramQuery.data?.configured ? "READY" : "TOKEN مطلوب"}</span></div><p className="financial-note">يُحفظ Chat ID فقط في قاعدة البيانات. توكن البوت لا يظهر في المتصفح ويُقرأ من سر المشروع.</p><label className="telegram-input"><span>Telegram Chat ID</span><input value={telegramChatId} onChange={(event) => setTelegramChatId(event.target.value)} placeholder="مثال: 123456789" /></label><label className="toggle-line"><input type="checkbox" checked={telegramEnabled} onChange={(event) => setTelegramEnabled(event.target.checked)} /> تفعيل إرسال Telegram</label><div className="button-row"><button className="v5-primary" onClick={saveCurrentTelegram} disabled={saveTelegram.isPending}>حفظ الإعدادات</button><button className="v5-secondary" onClick={() => testTelegram.mutate({ chatId: telegramChatId })} disabled={!telegramChatId || testTelegram.isPending}>اختبار الرسالة</button></div><button className="schedule-button" onClick={() => scheduleTelegram.mutate()} disabled={!telegramQuery.data?.configured || !telegramChatId || scheduleTelegram.isPending}>{telegramQuery.data?.scheduled ? "الفحص الخلفي مفعّل كل دقيقة" : "تفعيل التنبيهات حتى عند إغلاق التطبيق"}</button><small className="settings-hint">يتطلب نشر الموقع قبل تشغيل الجدولة الخلفية.</small></article></section>
    <section className="container history-panel glass-panel"><div className="panel-heading compact"><div><span className="section-label"><Bell size={14} /> Alert history</span><h2>سجل التنبيهات</h2></div><span className="neutral-chip">{historyQuery.data?.length ?? 0} سجل</span></div><div className="history-table"><div className="history-header"><span>السهم</span><span>النوع</span><span>السعر</span><span>المصدر</span><span>التوصيل</span><span>التاريخ</span></div>{historyQuery.data?.length ? historyQuery.data.map((row) => <div className="history-row" key={row.id}><strong>{row.symbol}</strong><span>{row.alertType === "demand" ? "منطقة الطلب" : row.alertType === "target1" ? "الهدف الأول" : "الهدف الثاني"}</span><span>${row.price}</span><span>{row.provider}</span><span>{row.delivery === "telegram" ? "Telegram" : "المتصفح"}</span><time>{new Date(row.createdAt).toLocaleString("ar-EG")}</time></div>) : <div className="history-empty">لا توجد تنبيهات مسجلة بعد. سيظهر أول تنبيه هنا مع السعر والمصدر ووقت الإرسال.</div>}</div></section>
    <section className="container footer-grid"><div className="playbook glass-panel"><div className="section-label"><ShieldCheck size={14} /> Playbook · {plan.label}</div><h2>{plan.subtitle}</h2><div className="playbook-line"><span className="line-dot mint-dot" /> لا شراء كامل قبل الإشارة المحددة</div><div className="playbook-line"><span className="line-dot coral-dot" /> وقف الخطة عند {levels.stop}</div></div><div className="disclaimer"><span><Info size={14} /> هذه لوحة بحثية تعليمية وليست أمراً تداولياً.</span><strong>{symbol} / USD</strong></div></section>
    {notice && <button className="notice-toast" onClick={() => setNotice("")}>{notice} ×</button>}
    {marketQuery.isFetching && <div className="loading-toast"><LoaderCircle size={14} /> تحديث بيانات {symbol}...</div>}
  </main>;
}
