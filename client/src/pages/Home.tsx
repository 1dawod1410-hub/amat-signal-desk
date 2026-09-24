import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowUpRight, CircleGauge, Info, LoaderCircle,
  LockKeyhole, Search, ShieldCheck, Sparkles, Target, TrendingUp,
  TriangleAlert, WalletCards, Wifi, WifiOff, Zap,
} from "lucide-react";

type Mode = "bold" | "conservative";
type Quote = { price: number; change: number; percent: number; asOf: string; live: boolean };
type Profile = { company: string; financial: { revenue: string; growth: string; margin: string; note: string } };

const watchlist = ["AMAT", "TSLA", "NVDA", "PL"];
const seededQuotes: Record<string, Quote> = {
  AMAT: { price: 462.37, change: -12.01, percent: -2.53, asOf: "24 سبتمبر 2026 · 09:37 ET", live: false },
  TSLA: { price: 428.62, change: 3.84, percent: 0.90, asOf: "لقطة تجريبية", live: false },
  NVDA: { price: 184.17, change: -1.26, percent: -0.68, asOf: "لقطة تجريبية", live: false },
  PL: { price: 24.86, change: 0.41, percent: 1.68, asOf: "لقطة تجريبية", live: false },
};
const profiles: Record<string, Profile> = {
  AMAT: { company: "Applied Materials, Inc.", financial: { revenue: "$9.11B", growth: "+25% YoY", margin: "50.3%", note: "نتائج Q3 قوية تدعم الاتجاه، لكن التقييم المرتفع يتطلب تأكيداً فنياً قبل زيادة الانكشاف." } },
  TSLA: { company: "Tesla, Inc.", financial: { revenue: "Live API", growth: "Pending", margin: "Pending", note: "البيانات الأساسية لهذا الرمز ستظهر بعد ربط مزود fundamentals مستقل." } },
  NVDA: { company: "NVIDIA Corporation", financial: { revenue: "Live API", growth: "Pending", margin: "Pending", note: "السعر حي عبر Yahoo Finance؛ المؤشرات الأساسية التفصيلية تحتاج موصل fundamentals." } },
  PL: { company: "PL Group, Inc.", financial: { revenue: "Live API", growth: "Pending", margin: "Pending", note: "رمز مخصص للعرض السريع؛ تحقق من اسم الشركة قبل استخدامه في قرار استثماري." } },
};
const modes = {
  bold: { label: "المتداول الجريء", short: "جريء", subtitle: "اقتناص محسوب مع حماية رأس المال", initial: "25% — 33%", add: "إغلاق يومي مؤكد فوق المقاومة", action: "دخول جزئي مسموح", risk: "متوسط / مرتفع", riskDetail: "قبول تذبذب أعلى مقابل عدم تفويت الحركة" },
  conservative: { label: "المتداول المحافظ", short: "محافظ", subtitle: "تأكيد أولاً، ثم تحريك السيولة", initial: "0% — 25%", add: "إغلاق مؤكد أو ارتداد من الطلب", action: "انتظار التأكيد", risk: "منخفض / منضبط", riskDetail: "سيولة أكبر خارج السوق لتقليل أثر الانعكاس" },
};

function money(value: number) { return `$${value.toFixed(2)}`; }
function range(a: number, b: number) { return `${money(a)} — ${money(b)}`; }
function levelsFor(symbol: string, price: number) {
  if (symbol === "AMAT") return { demand: "$450 — $460", target1: "$478 — $483", target2: "$492 — $505", stop: "إغلاق دون $438", resistance: "$471" };
  return { demand: range(price * .96, price * .99), target1: range(price * 1.035, price * 1.045), target2: range(price * 1.065, price * 1.09), stop: `إغلاق دون ${money(price * .93)}`, resistance: money(price * 1.025) };
}
async function fetchQuote(symbol: string, signal: AbortSignal): Promise<Quote> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`, { signal });
  if (!response.ok) throw new Error("quote unavailable");
  const json = await response.json();
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  const price = Number(meta?.regularMarketPrice ?? meta?.currentTradingPeriod?.regular?.price);
  const previous = Number(meta?.previousClose ?? meta?.chartPreviousClose);
  if (!Number.isFinite(price) || !Number.isFinite(previous)) throw new Error("invalid quote");
  const change = price - previous;
  return { price, change, percent: (change / previous) * 100, asOf: `تحديث حي · ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" })}`, live: true };
}

function LevelCard({ label, eyebrow, value, detail, tone, icon: Icon }: { label: string; eyebrow: string; value: string; detail: string; tone: string; icon: typeof Target }) {
  return <article className={`level-card level-${tone}`}><div className="level-topline"><span className="level-icon"><Icon size={16} strokeWidth={2.2} /></span><span className="eyebrow">{eyebrow}</span></div><h3>{label}</h3><div className="level-value">{value}</div><p>{detail}</p></article>;
}

export default function Home() {
  const [symbol, setSymbol] = useState("AMAT");
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<Mode>("bold");
  const [quote, setQuote] = useState(seededQuotes.AMAT);
  const [loading, setLoading] = useState(false);
  const [apiMessage, setApiMessage] = useState("جاري مزامنة السعر...");
  const plan = modes[mode];
  const profile = profiles[symbol] ?? { company: `${symbol} · Equity`, financial: { revenue: "Live API", growth: "Pending", margin: "Pending", note: "المستويات أدناه نموذجية ومبنية على السعر الحالي؛ أضف موصل fundamentals للتحقق من القوائم المالية." } };
  const levels = useMemo(() => levelsFor(symbol, quote.price), [symbol, quote.price]);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    setLoading(true); setApiMessage("جاري جلب السعر...");
    fetchQuote(symbol, controller.signal).then((next) => { if (mounted) { setQuote(next); setApiMessage("متصل · Yahoo Finance"); } }).catch(() => { if (mounted) { setQuote({ ...(seededQuotes[symbol] ?? { price: quote.price, change: 0, percent: 0, asOf: "لقطة محلية", live: false }), live: false }); setApiMessage("وضع احتياطي · لقطة محلية"); } }).finally(() => mounted && setLoading(false));
    const timer = window.setInterval(() => { fetchQuote(symbol, controller.signal).then((next) => mounted && setQuote(next)).catch(() => undefined); }, 60000);
    return () => { mounted = false; controller.abort(); window.clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  function submitSearch(event: FormEvent) { event.preventDefault(); const next = input.trim().toUpperCase().replace(/[^A-Z.\-]/g, ""); if (next) { setSymbol(next); setInput(""); } }
  const positive = quote.change >= 0;
  const chartPath = positive ? "M0,57 C18,53 23,41 39,45 S59,29 77,35 S98,22 116,28 S138,16 153,22 S170,10 180,13" : "M0,16 C16,11 19,31 34,27 S56,25 66,34 S83,29 94,36 S111,28 120,42 S142,34 153,50 S169,46 180,59";

  return <main dir="rtl" className="app-shell">
    <div className="ambient ambient-one" /><div className="ambient ambient-two" />
    <header className="topbar container"><div className="brand-lockup"><div className="brand-mark"><Activity size={18} /></div><div><div className="brand-name">Signal Desk <span className="v2-badge">v2</span></div><div className="brand-sub">Equity intelligence · live workspace</div></div></div><div className="topbar-actions"><span className="live-dot"><i /> السوق مفتوح</span><button className="icon-button" aria-label="معلومات التطبيق"><Info size={17} /></button></div></header>
    <div className="sticky-tools"><div className="container tools-inner"><form className="search-box" onSubmit={submitSearch}><Search size={17} /><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="ابحث عن رمز سهم… مثل TSLA أو NVDA" aria-label="بحث عن رمز سهم" /><button type="submit">استدعاء</button></form><div className="watchlist"><span className="watch-label">مراقبة سريعة</span>{watchlist.map((item) => <button key={item} className={item === symbol ? "watch-chip active" : "watch-chip"} onClick={() => setSymbol(item)}>{item}</button>)}</div></div></div>
    <section className="container hero-grid"><div className="hero-copy"><div className="breadcrumb"><span>US EQUITIES</span><b>/</b><span>NASDAQ</span><b>/</b><strong>{symbol}</strong></div><div className="hero-title-row"><div className="ticker-badge">{symbol.slice(0, 1)}</div><div><div className="company-kicker">{profile.company}</div><h1>{symbol} <span>NASDAQ</span></h1></div></div><p className="hero-description">لوحة قرار مركّزة تجمع السعر، مناطق التنفيذ، وصحة الشركة في شاشة واحدة.</p><div className="data-stamp"><span className="pulse" /> {quote.asOf}</div></div>
      <div className="price-card glass-panel"><div className="price-card-head"><span>السعر اللحظي</span><span className={quote.live ? "price-source live-source" : "price-source"}>{quote.live ? <><Wifi size={12} /> {apiMessage}</> : <><WifiOff size={12} /> {apiMessage}</>}</span></div><div className="price-row"><div><div className="price">{money(quote.price)}</div><div className={positive ? "day-move positive-move" : "day-move"}>{positive ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />} {positive ? "+" : ""}{money(quote.change)} <b>{positive ? "+" : ""}{quote.percent.toFixed(2)}%</b></div></div><div className="spark-wrap"><svg viewBox="0 0 180 68" role="img" aria-label="رسم سعري مصغر"><defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor={positive ? "#5ee0ba" : "#f27e77"} stopOpacity=".24" /><stop offset="1" stopColor={positive ? "#5ee0ba" : "#f27e77"} stopOpacity="0" /></linearGradient></defs><path className="spark-area" d={`${chartPath} L180,68 L0,68 Z`} /><path className={positive ? "spark-line positive-line" : "spark-line"} d={chartPath} /><circle cx="180" cy={positive ? "13" : "59"} r="3.5" className={positive ? "spark-point positive-point" : "spark-point"} /></svg></div></div><div className="trend-strip"><div className={positive ? "trend-badge trend-positive" : "trend-badge"}>{positive ? <TrendingUp size={15} /> : <TriangleAlert size={15} />} {positive ? "صاعد لحظياً" : "تصحيحي"}</div><span>المستويات النموذجية تتطلب تأكيد الإغلاق اليومي</span></div></div></section>
    <section className="container mode-section"><div className="mode-copy"><div className="section-label"><Sparkles size={14} /> قرار التنفيذ</div><h2>اختر إيقاعك</h2><p>المستويات ثابتة، لكن حجم الخطوة يتغير حسب قدرتك على تحمل الانعكاس.</p></div><div className="mode-toggle" role="group" aria-label="خطة التداول"><button className={mode === "bold" ? "active" : ""} onClick={() => setMode("bold")}><Zap size={15} /> خطة {modes.bold.short}</button><button className={mode === "conservative" ? "active" : ""} onClick={() => setMode("conservative")}><ShieldCheck size={15} /> خطة {modes.conservative.short}</button></div></section>
    <section className="container main-grid"><div className="levels-panel glass-panel"><div className="panel-heading"><div><span className="section-label"><Target size={14} /> Execution map · {symbol}</span><h2>خريطة المستويات</h2></div><span className="neutral-chip">Daily frame</span></div><div className="levels-grid"><LevelCard label="منطقة الطلب الأولى" eyebrow="DEMAND ZONE" value={levels.demand} detail="منطقة تفاعل متوقعة قرب المتوسطات القصيرة" tone="mint" icon={Target} /><LevelCard label="الهدف الأول" eyebrow="TARGET 01" value={levels.target1} detail="استعادة المقاومة القصيرة والمتوسط 50 يوم" tone="blue" icon={ArrowUpRight} /><LevelCard label="الهدف الثاني" eyebrow="TARGET 02" value={levels.target2} detail="منطقة امتداد الحركة بعد تثبيت الاختراق" tone="violet" icon={TrendingUp} /><LevelCard label="وقف الخسارة الصارم" eyebrow="HARD STOP" value={levels.stop} detail="إبطال الخطة التكتيكية على أساس الإغلاق اليومي" tone="coral" icon={LockKeyhole} /></div><p className="model-note"><Info size={13} /> {symbol === "AMAT" ? "المستويات متوافقة مع خطة AMAT الأساسية." : "رمز جديد: تم اشتقاق النطاقات آلياً من السعر الحالي، وليست بديلاً عن تحليل الشارت."}</p></div>
      <aside className="side-stack"><article className="risk-panel glass-panel"><div className="panel-heading compact"><div><span className="section-label"><WalletCards size={14} /> Position sizing</span><h2>إدارة السيولة</h2></div><CircleGauge size={21} className="muted-icon" /></div><div className="allocation-visual"><div className="allocation-bar"><span style={{ width: mode === "bold" ? "31%" : "18%" }} /></div><div className="allocation-labels"><span>نقد متاح</span><strong>{plan.initial}</strong></div></div><div className="risk-row"><div><span className="mini-label">الدخول الأولي</span><strong>{plan.initial}</strong></div><div className={`status-pill ${mode === "bold" ? "mint" : "amber"}`}>{plan.action}</div></div><div className="add-rule"><div className="rule-icon"><ArrowUpRight size={17} /></div><div><span className="mini-label">شرط إضافة بقية السيولة</span><strong>{symbol === "AMAT" ? plan.add.replace("المقاومة", levels.resistance) : `${plan.add} · ${levels.resistance}`}</strong><p>{mode === "bold" ? `أضف 25% أخرى بعد تأكيد ${levels.resistance}، والباقي بعد الهدف الأول.` : `لا دخول كامل قبل إغلاق مؤكد وإعادة اختبار ناجحة للمقاومة.`}</p></div></div><div className="risk-foot"><span>درجة المخاطرة</span><b>{plan.risk}</b><small>{plan.riskDetail}</small></div></article>
        <article className="financial-panel glass-panel"><div className="panel-heading compact"><div><span className="section-label"><TrendingUp size={14} /> Financial health</span><h2>الصحة المالية</h2></div><span className="health-score">{symbol === "AMAT" ? "A−" : "LIVE"}</span></div><div className="financial-metrics"><div><span>إيرادات Q3</span><strong>{profile.financial.revenue}</strong><b className="positive">{profile.financial.growth}</b></div><div><span>الهامش الإجمالي</span><strong>{profile.financial.margin}</strong><b className="positive">{symbol === "AMAT" ? "+1.5 pt" : "Pending"}</b></div></div><p className="financial-note">{profile.financial.note}</p></article></aside></section>
    <section className="container footer-grid"><div className="playbook glass-panel"><div className="section-label"><ShieldCheck size={14} /> Playbook · {plan.label}</div><h2>{plan.subtitle}</h2><div className="playbook-line"><span className="line-dot mint-dot" /> لا شراء كامل قبل الإشارة المحددة</div><div className="playbook-line"><span className="line-dot coral-dot" /> وقف الخطة عند {levels.stop}</div></div><div className="disclaimer"><span><Info size={14} /> هذه لوحة بحثية تعليمية وليست أمراً تداولياً.</span><strong>{symbol} / USD</strong></div></section>
    {loading && <div className="loading-toast"><LoaderCircle size={14} /> تحديث بيانات {symbol}...</div>}
  </main>;
}
