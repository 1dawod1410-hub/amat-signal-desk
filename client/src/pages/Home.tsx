import { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CircleGauge,
  Info,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  TriangleAlert,
  WalletCards,
  Zap,
} from "lucide-react";

const levels = [
  {
    label: "منطقة الطلب الأولى",
    eyebrow: "DEMAND ZONE",
    value: "$450 — $460",
    detail: "منطقة تفاعل متوقعة قرب EMA20 / VWMA20",
    tone: "mint",
    icon: Target,
  },
  {
    label: "الهدف الأول",
    eyebrow: "TARGET 01",
    value: "$478 — $483",
    detail: "استعادة المقاومة القصيرة والمتوسط 50 يوم",
    tone: "blue",
    icon: ArrowUpRight,
  },
  {
    label: "الهدف الثاني",
    eyebrow: "TARGET 02",
    value: "$492 — $505",
    detail: "منطقة المحور ومتوسط 100 يوم",
    tone: "violet",
    icon: TrendingUp,
  },
  {
    label: "وقف الخسارة الصارم",
    eyebrow: "HARD STOP",
    value: "إغلاق دون $438",
    detail: "إبطال الخطة التكتيكية على أساس الإغلاق اليومي",
    tone: "coral",
    icon: LockKeyhole,
  },
];

const modes = {
  bold: {
    label: "المتداول الجريء",
    short: "جريء",
    subtitle: "اقتناص محسوب مع حماية رأس المال",
    initial: "25% — 33%",
    add: "إغلاق يومي مؤكد فوق $471",
    addDetail: "أضف 25% أخرى بعد تأكيد الاختراق، والباقي فوق $478 — $483.",
    action: "دخول جزئي مسموح",
    actionTone: "mint",
    risk: "متوسط / مرتفع",
    riskDetail: "قبول تذبذب أعلى مقابل عدم تفويت الحركة",
  },
  conservative: {
    label: "المتداول المحافظ",
    short: "محافظ",
    subtitle: "تأكيد أولاً، ثم تحريك السيولة",
    initial: "0% — 25%",
    add: "فوق $471 أو ارتداد واضح من $450 — $460",
    addDetail: "لا دخول كامل قبل إغلاق مؤكد وإعادة اختبار ناجحة للمقاومة.",
    action: "انتظار التأكيد",
    actionTone: "amber",
    risk: "منخفض / منضبط",
    riskDetail: "سيولة أكبر خارج السوق لتقليل أثر الانعكاس",
  },
};

function LevelCard({ item }: { item: (typeof levels)[number] }) {
  const Icon = item.icon;
  return (
    <article className={`level-card level-${item.tone}`}>
      <div className="level-topline">
        <span className="level-icon"><Icon size={16} strokeWidth={2.2} /></span>
        <span className="eyebrow">{item.eyebrow}</span>
      </div>
      <h3>{item.label}</h3>
      <div className="level-value">{item.value}</div>
      <p>{item.detail}</p>
    </article>
  );
}

export default function Home() {
  const [mode, setMode] = useState<"bold" | "conservative">("bold");
  const plan = modes[mode];

  return (
    <main dir="rtl" className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar container">
        <div className="brand-lockup">
          <div className="brand-mark"><Activity size={18} /></div>
          <div>
            <div className="brand-name">Signal Desk</div>
            <div className="brand-sub">Equity intelligence · MVP</div>
          </div>
        </div>
        <div className="topbar-actions">
          <span className="live-dot"><i /> السوق مفتوح</span>
          <button className="icon-button" aria-label="معلومات التطبيق"><Info size={17} /></button>
        </div>
      </header>

      <section className="container hero-grid">
        <div className="hero-copy">
          <div className="breadcrumb"><span>US EQUITIES</span><b>/</b><span>NASDAQ</span><b>/</b><strong>AMAT</strong></div>
          <div className="hero-title-row">
            <div className="ticker-badge">A</div>
            <div>
              <div className="company-kicker">Applied Materials, Inc.</div>
              <h1>AMAT <span>NASDAQ</span></h1>
            </div>
          </div>
          <p className="hero-description">لوحة قرار مركّزة تجمع السعر، مناطق التنفيذ، وصحة الشركة في شاشة واحدة.</p>
          <div className="data-stamp"><span className="pulse" /> آخر تحديث: 24 سبتمبر 2026 · 09:37 ET</div>
        </div>

        <div className="price-card glass-panel">
          <div className="price-card-head"><span>السعر اللحظي</span><span className="price-source">Yahoo Finance · delayed view</span></div>
          <div className="price-row">
            <div>
              <div className="price">$462<span>.37</span></div>
              <div className="day-move"><ArrowDownRight size={16} /> −$12.01 <b>−2.53%</b></div>
            </div>
            <div className="spark-wrap" aria-label="رسم سعري مصغر">
              <svg viewBox="0 0 180 68" role="img" aria-hidden="true">
                <defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#5ee0ba" stopOpacity=".24" /><stop offset="1" stopColor="#5ee0ba" stopOpacity="0" /></linearGradient></defs>
                <path className="spark-area" d="M0,16 C16,11 19,31 34,27 S56,25 66,34 S83,29 94,36 S111,28 120,42 S142,34 153,50 S169,46 180,59 L180,68 L0,68 Z" />
                <path className="spark-line" d="M0,16 C16,11 19,31 34,27 S56,25 66,34 S83,29 94,36 S111,28 120,42 S142,34 153,50 S169,46 180,59" />
                <circle cx="180" cy="59" r="3.5" className="spark-point" />
              </svg>
            </div>
          </div>
          <div className="trend-strip">
            <div className="trend-badge"><TriangleAlert size={15} /> تصحيحي</div>
            <span>فوق SMA 200 · تحت مقاومة 468 — 471</span>
          </div>
        </div>
      </section>

      <section className="container mode-section">
        <div className="mode-copy">
          <div className="section-label"><Sparkles size={14} /> قرار التنفيذ</div>
          <h2>اختر إيقاعك</h2>
          <p>المستويات ثابتة، لكن حجم الخطوة يتغير حسب قدرتك على تحمل الانعكاس.</p>
        </div>
        <div className="mode-toggle" role="group" aria-label="خطة التداول">
          <button className={mode === "bold" ? "active" : ""} onClick={() => setMode("bold")}><Zap size={15} /> خطة {modes.bold.short}</button>
          <button className={mode === "conservative" ? "active" : ""} onClick={() => setMode("conservative")}><ShieldCheck size={15} /> خطة {modes.conservative.short}</button>
        </div>
      </section>

      <section className="container main-grid">
        <div className="levels-panel glass-panel">
          <div className="panel-heading">
            <div><span className="section-label"><Target size={14} /> Execution map</span><h2>خريطة المستويات</h2></div>
            <span className="neutral-chip">Daily frame</span>
          </div>
          <div className="levels-grid">{levels.map((item) => <LevelCard key={item.eyebrow} item={item} />)}</div>
        </div>

        <aside className="side-stack">
          <article className="risk-panel glass-panel">
            <div className="panel-heading compact"><div><span className="section-label"><WalletCards size={14} /> Position sizing</span><h2>إدارة السيولة</h2></div><CircleGauge size={21} className="muted-icon" /></div>
            <div className="allocation-visual"><div className="allocation-bar"><span style={{ width: mode === "bold" ? "31%" : "18%" }} /></div><div className="allocation-labels"><span>نقد متاح</span><strong>{plan.initial}</strong></div></div>
            <div className="risk-row"><div><span className="mini-label">الدخول الأولي</span><strong>{plan.initial}</strong></div><div className={`status-pill ${plan.actionTone}`}>{plan.action}</div></div>
            <div className="add-rule"><div className="rule-icon"><ArrowUpRight size={17} /></div><div><span className="mini-label">شرط إضافة بقية السيولة</span><strong>{plan.add}</strong><p>{plan.addDetail}</p></div></div>
            <div className="risk-foot"><span>درجة المخاطرة</span><b>{plan.risk}</b><small>{plan.riskDetail}</small></div>
          </article>

          <article className="financial-panel glass-panel">
            <div className="panel-heading compact"><div><span className="section-label"><TrendingUp size={14} /> Financial health</span><h2>صحة مالية قوية</h2></div><span className="health-score">A−</span></div>
            <div className="financial-metrics"><div><span>إيرادات Q3</span><strong>$9.11B</strong><b className="positive">+25% YoY</b></div><div><span>الهامش الإجمالي</span><strong>50.3%</strong><b className="positive">+1.5 pt</b></div></div>
            <p className="financial-note">نتائج قوية تدعم الاتجاه، لكن التقييم المرتفع يتطلب تأكيداً فنياً قبل زيادة الانكشاف.</p>
          </article>
        </aside>
      </section>

      <section className="container footer-grid">
        <div className="playbook glass-panel"><div className="section-label"><ShieldCheck size={14} /> Playbook · {plan.label}</div><h2>{plan.subtitle}</h2><div className="playbook-line"><span className="line-dot mint-dot" /> لا شراء كامل قبل الإشارة المحددة</div><div className="playbook-line"><span className="line-dot coral-dot" /> وقف الخطة عند إغلاق دون $438</div></div>
        <div className="disclaimer"><span><Info size={14} /> هذه لوحة بحثية تعليمية وليست أمراً تداولياً.</span><strong>AMAT / USD</strong></div>
      </section>
    </main>
  );
}
