import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { api, API_BASE } from '../api/client';

const HOME = { admin: '/admin', employee: '/employee', client: '/client' };

/* ---------------- real, live information ---------------- */

function useLondonClock() {
  const [now, setNow] = useState('');
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit',
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function usePortalStatus() {
  const [online, setOnline] = useState(null);
  useEffect(() => {
    let on = true;
    const ping = () =>
      fetch(`${API_BASE}/health`).then((r) => on && setOnline(r.ok)).catch(() => on && setOnline(false));
    ping();
    const id = setInterval(ping, 30_000);
    return () => { on = false; clearInterval(id); };
  }, []);
  return online;
}

const acceptingStamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', month: 'long', year: 'numeric',
}).format(new Date());

/* ---------------- motion ---------------- */

function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); io.disconnect(); } },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/* ---------------- icons (consistent 1.6px stroke) ---------------- */

function I({ d, size = 22, className = '' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {d}
    </svg>
  );
}

const ic = {
  chat: <><path d="M21 11.5c0 4.1-4 7.5-9 7.5-1 0-2-.13-2.9-.38L4 20l1.2-3.4C4.07 15.2 3 13.46 3 11.5 3 7.4 7 4 12 4s9 3.4 9 7.5z" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" fill="currentColor" /></>,
  doc: <><path d="M6 3.5h8l4 4v13H6v-17z" /><path d="M14 3.5v4h4" /><path d="M9 12h6M9 15.5h6" /></>,
  send: <><path d="M21 3.5L10.5 14M21 3.5l-6.5 17-4-7-7-4 17.5-6z" /></>,
  academy: <><path d="M12 4L2.5 8.5 12 13l9.5-4.5L12 4z" /><path d="M6 10.5V16c0 1.4 2.7 3 6 3s6-1.6 6-3v-5.5" /></>,
  chart: <><path d="M4 20h16" /><path d="M7 16v-4M12 16V8M17 16v-6" /></>,
  ring: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5a8.5 8.5 0 016.7 13.7" className="text-gold-500" /></>,
  ledger: <><rect x="4" y="4.5" width="16" height="15" rx="2" /><path d="M4 9.5h16M9 4.5v15" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M4 7.5l8 5.5 8-5.5" /></>,
  folder: <><path d="M3.5 6.5h6l2 2.5h9v9.5h-17v-12z" /></>,
  shield: <><path d="M12 3.5l7.5 2.7v5c0 4.6-3.2 8.1-7.5 9.3-4.3-1.2-7.5-4.7-7.5-9.3v-5L12 3.5z" /><path d="M9 12l2.2 2.2 4-4.2" /></>,
  pen: <><path d="M14.5 4.5l5 5L8 21H3v-5L14.5 4.5z" /><path d="M12.5 6.5l5 5" /></>,
  linkedin: <><rect x="3.5" y="3.5" width="17" height="17" rx="2.5" /><path d="M8 10.5V17M8 7.6v.01M12.5 17v-3.6c0-1.3.9-2.4 2.1-2.4s2.1 1.1 2.1 2.4V17" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20.5 20.5" /></>,
  bulb: <><path d="M9.5 18h5M10 21h4" /><path d="M12 3.5a6 6 0 00-3.5 10.9c.8.6 1 1.6 1 2.6h5c0-1 .2-2 1-2.6A6 6 0 0012 3.5z" /></>,
  check: <path d="M4.5 12.5l4.5 4.5L19.5 6.5" />,
  arrow: <path d="M4 12h15m0 0l-5.5-5.5M19 12l-5.5 5.5" />,
  code: <><path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5" /></>,
  bank: <><path d="M3.5 9.5L12 4l8.5 5.5" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3.5 20h17" /></>,
  pulse2: <><path d="M3.5 12h4l2-5 4.5 10 2.5-5h4" /></>,
  cog: <><circle cx="12" cy="12" r="3.2" /><path d="M12 3.8v2.4M12 17.8v2.4M3.8 12h2.4M17.8 12h2.4M6.2 6.2l1.7 1.7M16.1 16.1l1.7 1.7M17.8 6.2l-1.7 1.7M7.9 16.1l-1.7 1.7" /></>,
  mega: <><path d="M4 10.5v3.5h3l6 4V6l-6 4H4z" /><path d="M16.5 9.5a4 4 0 010 5.5" /></>,
};

/* ---------------- consultation booking (fully dynamic) ---------------- */

function ConsultationModal({ open, interest, onClose }) {
  const [form, setForm] = useState({ fullName: '', email: '', phone: '', message: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      setDone(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/public/consultations', {
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        interest: interest || '',
        message: form.message,
      });
      setDone(true);
      setForm({ fullName: '', email: '', phone: '', message: '' });
    } catch (err) {
      setError(err?.response?.data?.details?.[0]?.message || err?.response?.data?.error || 'Something went wrong — please try again.');
    } finally {
      setBusy(false);
    }
  }

  const field =
    'w-full rounded-xl border border-navy-800/15 bg-white px-4 py-3 text-[15px] text-ink placeholder:text-ink-soft/45 outline-none transition focus:border-gold-500 focus:ring-2 focus:ring-gold-500/25';

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-navy-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Book a free consultation"
    >
      <div
        className="max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-ivory shadow-card-lg sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-navy-900 px-7 py-6 sm:rounded-t-3xl">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.24em] text-gold-300">Free consultation</p>
          <h2 className="mt-1.5 font-display text-2xl text-ivory">Let's map your search</h2>
          <p className="mt-1 text-[13px] text-ivory/55">
            {interest ? `Enquiring about: ${interest} · ` : ''}No commitment — we reply within one working day.
          </p>
          <button onClick={onClose} aria-label="Close"
            className="absolute right-5 top-5 rounded-lg p-1.5 text-ivory/60 transition hover:bg-white/10 hover:text-ivory">
            <I size={18} d={<path d="M6 6l12 12M18 6L6 18" />} />
          </button>
        </div>

        {done ? (
          <div className="px-7 py-12 text-center">
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success-soft text-success">
              <I d={ic.check} size={30} />
            </span>
            <h3 className="mt-5 font-display text-2xl text-navy-800">Request received</h3>
            <p className="mx-auto mt-2 max-w-sm text-[14.5px] leading-relaxed text-ink-soft">
              Thank you — your consultation request is with our team. We'll reply to your
              email within one working day.
            </p>
            <button onClick={onClose}
              className="mt-7 rounded-full bg-navy-800 px-7 py-3 text-[14px] font-semibold text-ivory transition hover:bg-navy-700">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 px-7 py-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-navy-800/70">Full name *</span>
                <input required maxLength={120} className={field} placeholder="Your name"
                  value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-navy-800/70">Email *</span>
                <input required type="email" maxLength={254} className={field} placeholder="you@example.com"
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </label>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-navy-800/70">Phone (optional)</span>
              <input maxLength={40} className={field} placeholder="+44 …"
                value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12px] font-semibold uppercase tracking-wider text-navy-800/70">
                What roles are you looking for? (optional)
              </span>
              <textarea rows={3} maxLength={2000} className={field} placeholder="e.g. Senior engineering roles in London or remote…"
                value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
            </label>
            {error && <p className="text-sm font-medium text-danger" role="alert">{error}</p>}
            <button type="submit" disabled={busy}
              className="group inline-flex w-full items-center justify-center gap-2.5 rounded-full bg-gold-500 py-4 text-[15px] font-semibold text-navy-900 shadow-[0_10px_26px_-8px_rgba(201,162,39,0.6)] transition hover:bg-gold-400 disabled:opacity-60">
              {busy ? 'Sending…' : 'Request my consultation'}
              {!busy && <I d={ic.arrow} size={16} className="transition-transform group-hover:translate-x-1" />}
            </button>
            <p className="text-center text-[12px] text-ink-soft/70">
              Prefer email? <a href="mailto:hello@gethired.uk" className="font-semibold text-gold-600 hover:underline">hello@gethired.uk</a>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- brand mark (crops the GH monogram from the logo) ---------------- */

function LogoMark({ size = 42, className = '' }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-navy-800/10 ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/logo-mark.png" alt="" className="h-full w-full object-contain p-[3px]" />
    </span>
  );
}

/* ---------------- decorative dots ---------------- */

function Dots({ className = '' }) {
  return (
    <div
      className={`pointer-events-none absolute ${className}`}
      style={{
        backgroundImage: 'radial-gradient(rgba(201,162,39,0.45) 1.3px, transparent 1.3px)',
        backgroundSize: '18px 18px',
      }}
      aria-hidden="true"
    />
  );
}

/* ================================================================ */

export default function Landing() {
  const { user } = useAuth();
  const portalTo = user ? HOME[user.role] : '/login';
  const clock = useLondonClock();
  const online = usePortalStatus();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [consult, setConsult] = useState(null);
  const openConsult = (interest) => {
    setMenuOpen(false);
    setConsult({ interest: interest || '' });
  };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links = [
    ['#how', 'How it works'],
    ['#package', "What's included"],
    ['#pricing', 'Packages'],
    ['#faq', 'FAQ'],
  ];

  return (
    <div className="bg-ivory text-ink">
      {/* ================= NAV ================= */}
      <header className={`sticky top-0 z-50 bg-ivory/95 backdrop-blur transition-shadow ${scrolled ? 'shadow-[0_1px_0_rgba(10,31,68,0.08),0_8px_24px_-16px_rgba(10,31,68,0.25)]' : ''}`}>
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-5 py-3.5 lg:px-8">
          <a href="#top" className="flex items-center gap-2.5">
            <LogoMark size={42} />
            <span className="leading-tight">
              <span className="block font-display text-[17px] font-semibold text-navy-800">Get Hired UK</span>
              <span className="block text-[9px] font-semibold uppercase tracking-[0.18em] text-gold-600">Your career · Our mission · Your success</span>
            </span>
          </a>
          <nav className="hidden items-center gap-7 xl:flex" aria-label="Primary">
            {links.map(([href, label]) => (
              <a key={href} href={href} className="text-[13.5px] font-medium text-ink-soft transition-colors hover:text-navy-800">
                {label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-3 lg:flex">
            <Link to={portalTo} className="rounded-full border border-navy-800/20 px-5 py-2.5 text-[13.5px] font-semibold text-navy-800 transition hover:border-navy-800/50">
              Client Portal
            </Link>
            <button onClick={() => openConsult()}
              className="rounded-full bg-gold-500 px-5 py-2.5 text-[13.5px] font-semibold text-navy-900 shadow-[0_4px_14px_-4px_rgba(201,162,39,0.5)] transition hover:bg-gold-400">
              Book consultation
            </button>
          </div>
          <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-navy-800 lg:hidden" aria-label="Open menu">
            <I size={24} d={<path d="M4 7h16M4 12h16M4 17h16" />} />
          </button>
        </div>
      </header>

      {/* mobile menu */}
      {menuOpen && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-navy-950 px-6 py-5 lg:hidden">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <LogoMark size={38} />
              <span className="font-display text-xl text-ivory">Get Hired <span className="text-gold-300">UK</span></span>
            </span>
            <button onClick={() => setMenuOpen(false)} aria-label="Close menu" className="rounded-lg p-2 text-ivory">
              <I size={22} d={<path d="M6 6l12 12M18 6L6 18" />} />
            </button>
          </div>
          <nav className="mt-12 flex flex-col gap-6" aria-label="Mobile">
            {links.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenuOpen(false)} className="font-display text-[1.9rem] text-ivory">
                {label}
              </a>
            ))}
            <Link to={portalTo} className="font-display text-[1.9rem] text-gold-300">
              Client Portal
            </Link>
          </nav>
          <button onClick={() => openConsult()}
            className="mt-auto rounded-xl bg-gold-500 py-4 text-center font-semibold text-navy-900">
            Book a consultation
          </button>
        </div>
      )}

      {/* ================= HERO ================= */}
      <section id="top" className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute -top-40 right-[-15%] h-[34rem] w-[34rem] rounded-full bg-gold-300/25 blur-3xl" />
          <div className="absolute bottom-[-20%] left-[-10%] h-[26rem] w-[26rem] rounded-full bg-navy-100/60 blur-3xl" />
        </div>
        <Dots className="right-8 top-24 hidden h-40 w-40 opacity-60 lg:block" />

        <div className="relative mx-auto grid max-w-7xl items-center gap-14 px-5 pb-20 pt-14 lg:grid-cols-2 lg:gap-10 lg:px-8 lg:pb-28 lg:pt-20">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-gold-500/40 bg-gold-100/70 px-4 py-1.5 text-[12px] font-semibold text-navy-800">
                <span className="h-1.5 w-1.5 rounded-full bg-gold-600" aria-hidden="true" />
                Now accepting clients — {acceptingStamp}
              </span>
            </Reveal>
            <Reveal delay={80}>
              <h1 className="mt-6 font-display text-[2.7rem] leading-[1.08] tracking-tight text-navy-800 sm:text-6xl">
                We apply.
                <br />You interview.
                <br /><span className="relative inline-block text-gold-600">
                  You get hired.
                  <svg className="absolute -bottom-2.5 left-0 w-full" viewBox="0 0 260 10" fill="none" aria-hidden="true">
                    <path d="M3 7.5C60 2.5 160 2 257 6" stroke="#C9A227" strokeWidth="3.5" strokeLinecap="round" opacity="0.55" />
                  </svg>
                </span>
              </h1>
            </Reveal>
            <Reveal delay={160}>
              <p className="mt-7 max-w-lg text-[16.5px] leading-[1.75] text-ink-soft">
                Hand your job search to a dedicated specialist. We find the right roles across
                your chosen fields, tailor your CV and cover letter to every single one, and
                apply on your behalf — while you watch it all happen live on your personal portal.
              </p>
            </Reveal>
            <Reveal delay={240} className="mt-8 flex flex-wrap items-center gap-4">
              <button onClick={() => openConsult()}
                className="group inline-flex items-center gap-2.5 rounded-full bg-navy-800 px-7 py-4 text-[15px] font-semibold text-ivory shadow-[0_14px_30px_-10px_rgba(10,31,68,0.5)] transition hover:bg-navy-700">
                Book a free consultation
                <I d={ic.arrow} size={17} className="transition-transform group-hover:translate-x-1" />
              </button>
              <a href="#how" className="inline-flex items-center gap-2 rounded-full border border-navy-800/20 px-6 py-4 text-[15px] font-semibold text-navy-800 transition hover:border-gold-500 hover:text-gold-600">
                See how it works
              </a>
            </Reveal>
            <Reveal delay={320}>
              <ul className="mt-10 flex max-w-lg flex-wrap gap-x-8 gap-y-3">
                {[
                  [ic.send, 'Up to 40 applications a month'],
                  [ic.pen, 'Every document tailored'],
                  [ic.mail, 'Reported daily at 19:00'],
                ].map(([d, t]) => (
                  <li key={t} className="flex items-center gap-2.5 text-[13.5px] font-medium text-ink-soft">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gold-600 shadow-card">
                      <I d={d} size={15} />
                    </span>
                    {t}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* real product, layered */}
          <Reveal delay={200} className="relative">
            <div className="relative lg:pl-6">
              <div className="absolute -inset-y-8 -right-10 left-16 rounded-[2.5rem] bg-gradient-to-br from-navy-800 to-navy-950 shadow-card-lg" aria-hidden="true" />
              <Dots className="-bottom-6 left-0 h-28 w-40 opacity-70" />
              {/* browser frame — real dashboard */}
              <div className="relative overflow-hidden rounded-2xl border border-navy-800/10 bg-white shadow-[0_30px_60px_-20px_rgba(5,15,38,0.55)]">
                <div className="flex items-center gap-2 border-b border-navy-800/10 bg-ivory px-4 py-2.5">
                  <span className="flex gap-1.5" aria-hidden="true">
                    <i className="h-2.5 w-2.5 rounded-full bg-[#f16057]" />
                    <i className="h-2.5 w-2.5 rounded-full bg-[#f3b63e]" />
                    <i className="h-2.5 w-2.5 rounded-full bg-[#41c163]" />
                  </span>
                  <span className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-4 py-1 text-[11px] text-ink-soft shadow-sm">
                    <I d={ic.shield} size={11} className="text-success" /> portal.gethired.uk
                  </span>
                </div>
                <img
                  src="/marketing/dashboard-desktop.png"
                  alt="The Get Hired UK client dashboard: momentum meter at 24 of 40 applications, LinkedIn tracker and master documents"
                  className="block w-full"
                  loading="eager"
                />
              </div>
              {/* phone — real mobile view */}
              <div className="absolute -bottom-10 -left-2 hidden w-[124px] overflow-hidden rounded-[1.4rem] border-[5px] border-navy-950 bg-navy-950 shadow-[0_24px_40px_-16px_rgba(5,15,38,0.6)] sm:block">
                <img src="/marketing/dashboard-mobile.png" alt="" aria-hidden="true" className="block w-full" />
              </div>
              <p className="mt-5 text-right text-[11px] text-ink-soft/60 lg:mt-7">Actual portal · shown with sample data</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= LIVE STATUS STRIP ================= */}
      <div className="border-y border-navy-800/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-10 gap-y-2 px-5 py-4 lg:justify-between lg:px-8">
          <p className="flex items-center gap-2.5 text-[12.5px] font-medium text-ink-soft">
            <span className={`h-2 w-2 rounded-full ${online === null ? 'bg-navy-800/20' : online ? 'bg-success' : 'bg-danger'}`} aria-hidden="true" />
            Client portal {online === null ? 'checking…' : online ? 'online' : 'offline'}
            <span className="text-ink-soft/40">·</span>
            London {clock || '—'}
          </p>
          <p className="hidden text-[12.5px] font-medium text-ink-soft sm:block">
            One named specialist per client · 3–5 career domains · no recycled PDFs, ever
          </p>
          <a href="mailto:hello@gethired.uk" className="text-[12.5px] font-semibold text-gold-600 hover:underline">
            hello@gethired.uk
          </a>
        </div>
      </div>

      {/* ================= HOW IT WORKS ================= */}
      <section id="how" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-gold-600">How it works</p>
              <h2 className="mt-3 font-display text-3xl tracking-tight text-navy-800 sm:text-[2.6rem] sm:leading-[1.15]">
                Six steps between you<br className="hidden sm:block" /> and your next offer
              </h2>
            </Reveal>
          </div>
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [ic.chat, 'Free consultation', 'We meet, understand your background and ambitions, and agree how we can help — before any commitment.'],
              [ic.target, 'Strategy & domains', 'Together we define the 3–5 career domains your search should focus on. Focus is what makes volume work.'],
              [ic.doc, 'Master documents', 'Your specialist writes a master CV and cover letter for each domain. Nothing is used until you approve it.'],
              [ic.send, 'Daily applications', 'We source live roles every working day and apply with documents rewritten for each specific job.'],
              [ic.linkedin, 'LinkedIn & preparation', 'Your profile is rebuilt to recruiter standard while interview guides and coaching notes fill your prep hub.'],
              [ic.chart, 'Watch it happen', 'Every application appears on your portal the day it is filed — and the Daily Pulse email confirms it each evening.'],
            ].map(([d, title, body], i) => (
              <Reveal key={title} delay={(i % 3) * 90}>
                <div className="group relative h-full rounded-2xl border border-navy-800/10 bg-white p-7 shadow-card transition-all duration-300 hover:-translate-y-1.5 hover:shadow-card-lg">
                  <div className="flex items-center justify-between">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800 text-gold-300 transition-colors group-hover:bg-gold-500 group-hover:text-navy-900">
                      <I d={d} />
                    </span>
                    <span className="font-display text-[2.6rem] leading-none text-navy-800/10">{String(i + 1).padStart(2, '0')}</span>
                  </div>
                  <h3 className="mt-5 font-display text-[1.3rem] text-navy-800">{title}</h3>
                  <p className="mt-2.5 text-[14.5px] leading-[1.75] text-ink-soft">{body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= THE COMPLETE PACKAGE ================= */}
      <section id="package" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="grid gap-14 lg:grid-cols-12">
            <div className="lg:col-span-4">
              <Reveal>
                <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-gold-600">What's included</p>
                <h2 className="mt-3 font-display text-3xl tracking-tight text-navy-800 sm:text-[2.4rem] sm:leading-[1.15]">
                  The complete<br />career package
                </h2>
                <p className="mt-5 max-w-sm text-[15px] leading-[1.8] text-ink-soft">
                  Everything below is part of every engagement — not an upsell menu. One team,
                  one fee, the whole job.
                </p>
                <button onClick={() => openConsult()}
                  className="group mt-8 inline-flex items-center gap-2.5 rounded-full bg-gold-500 px-6 py-3.5 text-[14px] font-semibold text-navy-900 shadow-[0_10px_24px_-8px_rgba(201,162,39,0.6)] transition hover:bg-gold-400">
                  Start with a consultation
                  <I d={ic.arrow} size={16} className="transition-transform group-hover:translate-x-1" />
                </button>
              </Reveal>
            </div>
            <div className="lg:col-span-7 lg:col-start-6">
              <div className="relative">
                <span className="absolute bottom-4 left-[23px] top-4 hidden w-px bg-gradient-to-b from-gold-500/60 via-gold-500/25 to-transparent sm:block" aria-hidden="true" />
                <div className="space-y-8">
                  {[
                    [ic.pen, 'CV revamp — per domain', 'From your history we build a master CV for each domain: achievements quantified, language matched to your market, formatted for both humans and screening software.'],
                    [ic.doc, 'Cover letter crafting', 'A master letter per domain — then rewritten for every single application so it speaks to that company and that role. Never a template with the name swapped.'],
                    [ic.linkedin, 'LinkedIn lift-off', 'Headline, summary, experience and keywords rebuilt to recruiter standard, with progress tracked on your dashboard from Not Started to Complete.'],
                    [ic.search, 'A job search partner', 'Your named specialist sources live roles daily inside your domains, applies at pace, and adjusts direction with you as the interviews start.'],
                    [ic.bulb, 'Interview insights', 'The prep hub carries our guides and coaching notes — the 90-second introduction, STAR stories, salary negotiation — refreshed as you progress.'],
                  ].map(([d, title, body], i) => (
                    <Reveal key={title} delay={i * 70}>
                      <div className="relative flex gap-5">
                        <span className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-full border-2 border-gold-500 bg-ivory text-gold-600">
                          <I d={d} size={19} />
                        </span>
                        <div className="pt-0.5">
                          <h3 className="font-display text-[1.25rem] text-navy-800">{title}</h3>
                          <p className="mt-2 max-w-xl text-[14.5px] leading-[1.8] text-ink-soft">{body}</p>
                        </div>
                      </div>
                    </Reveal>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ================= AREAS OF FOCUS ================= */}
      <section className="border-y border-navy-800/10 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-gold-600">Areas of focus</p>
              <h2 className="mt-3 font-display text-3xl tracking-tight text-navy-800 sm:text-[2.4rem]">
                Professional roles, UK-wide
              </h2>
              <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
                Your 3–5 domains keep the search sharp. These are the fields we work in most.
              </p>
            </Reveal>
          </div>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              [ic.code, 'Technology & Engineering', 'Software, data, platform, DevOps, technical leadership'],
              [ic.bank, 'Finance & Fintech', 'Banking, payments, analysis, risk and compliance'],
              [ic.pulse2, 'Healthcare & Pharma', 'Clinical operations, regulatory, commercial roles'],
              [ic.cog, 'Operations & Delivery', 'Programme, project and operations management'],
              [ic.mega, 'Marketing & Media', 'Brand, growth, content and communications'],
              [ic.chart, 'Product & Strategy', 'Product management, strategy, business analysis'],
            ].map(([d, title, sub], i) => (
              <Reveal key={title} delay={(i % 3) * 80}>
                <div className="flex h-full items-start gap-4 rounded-2xl border border-navy-800/10 bg-ivory/60 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-gold-500/50 hover:bg-white hover:shadow-card">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy-800/[0.06] text-navy-800">
                    <I d={d} size={20} />
                  </span>
                  <div>
                    <h3 className="text-[15.5px] font-semibold text-navy-800">{title}</h3>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{sub}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= PACKAGES ================= */}
      <section id="pricing" className="scroll-mt-24">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-28">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-gold-600">Packages</p>
              <h2 className="mt-3 font-display text-3xl tracking-tight text-navy-800 sm:text-[2.4rem]">
                Three packages. One standard.
              </h2>
              <p className="mt-4 text-[15px] leading-[1.8] text-ink-soft">
                Pricing is shared during your consultation — shaped to your seniority and
                your market, and agreed plainly before anything begins.
              </p>
            </Reveal>
          </div>

          <div className="mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-3">
            {[
              { name: 'Silver', jobs: 20, tag: 'A steady start', dark: false },
              { name: 'Gold', jobs: 30, tag: 'Focused momentum', dark: false },
              { name: 'Platinum', jobs: 40, tag: 'Our full weight', dark: true },
            ].map((p, i) => (
              <Reveal key={p.name} delay={i * 110}>
                <div className={`relative flex h-full flex-col rounded-3xl p-8 sm:p-9 ${
                  p.dark
                    ? 'bg-gradient-to-b from-navy-800 to-navy-950 text-ivory shadow-[0_30px_60px_-20px_rgba(5,15,38,0.55)] ring-2 ring-gold-500'
                    : 'border border-navy-800/10 bg-white text-ink shadow-card'
                }`}>
                  {p.dark && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-gold-500 px-4 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-navy-900">
                      Most popular
                    </span>
                  )}
                  <div className="flex items-baseline justify-between">
                    <h3 className={`font-display text-[1.6rem] ${p.dark ? 'text-gold-300' : 'text-navy-800'}`}>{p.name}</h3>
                    <span className={`text-[12px] font-semibold uppercase tracking-[0.14em] ${p.dark ? 'text-ivory/45' : 'text-ink-soft/70'}`}>{p.tag}</span>
                  </div>
                  <div className="mt-6 flex items-baseline gap-3">
                    <span className="font-display text-[4.2rem] leading-none tracking-tight">{p.jobs}</span>
                    <span className={`text-[13.5px] leading-snug ${p.dark ? 'text-ivory/55' : 'text-ink-soft'}`}>
                      tailored applications<br />per month, up to
                    </span>
                  </div>
                  <div className={`my-7 h-px ${p.dark ? 'bg-white/10' : 'bg-navy-800/10'}`} aria-hidden="true" />
                  <ul className={`space-y-3.5 text-[14.5px] ${p.dark ? 'text-ivory/85' : 'text-ink'}`}>
                    {[
                      '3–5 domains with master documents',
                      'A named, dedicated specialist',
                      'Live dashboard + Daily Pulse email',
                      'LinkedIn rebuilt to recruiter standard',
                      'Interview preparation hub',
                    ].map((f) => (
                      <li key={f} className="flex items-start gap-3">
                        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${p.dark ? 'bg-gold-500/20 text-gold-300' : 'bg-gold-100 text-gold-600'}`}>
                          <I d={ic.check} size={11} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <button onClick={() => openConsult(`${p.name} package`)}
                    className={`mt-9 block w-full rounded-full py-3.5 text-center text-[14px] font-semibold transition ${
                      p.dark
                        ? 'bg-gold-500 text-navy-900 hover:bg-gold-400'
                        : 'border border-navy-800/25 text-navy-800 hover:border-navy-800 hover:bg-navy-800 hover:text-ivory'
                    }`}>
                    Enquire about {p.name}
                  </button>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= FAQ ================= */}
      <section id="faq" className="scroll-mt-24 border-t border-navy-800/10 bg-white">
        <div className="mx-auto max-w-7xl px-5 py-20 lg:px-8 lg:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <Reveal>
              <p className="text-[12px] font-bold uppercase tracking-[0.24em] text-gold-600">FAQ</p>
              <h2 className="mt-3 font-display text-3xl tracking-tight text-navy-800 sm:text-[2.4rem]">
                Questions you should ask
              </h2>
            </Reveal>
          </div>
          <div className="mx-auto mt-12 grid max-w-5xl gap-x-8 gap-y-4 lg:grid-cols-2">
            {[
              ['Who actually writes my applications?', 'Your named specialist — the same person throughout. They write master documents for each domain, then rewrite both documents for every individual role before applying.'],
              ['How do I know the work is happening?', 'Every application appears on your portal the day it is filed — employer, role, date, link — and the Daily Pulse email each evening states exactly how many went out. If a day is quiet, you see that too.'],
              ['What kinds of roles do you cover?', 'Professional roles across the UK market — technology, finance, healthcare, operations, marketing, product and adjacent fields. Your domains keep it focused.'],
              ['Can I pause or change direction?', 'Yes. Domains, targets and pace can be adjusted with your specialist at any time; your dashboard reflects changes immediately.'],
              ['How fast does it start?', 'The consultation sets your strategy. Master documents are typically drafted within the first week, and applications begin as soon as you approve them.'],
              ['Do you use my accounts to apply?', 'We agree the approach at consultation — applications are made in your name, with your knowledge, and everything we submit is visible to you on the portal.'],
            ].map(([q, a], i) => (
              <Reveal key={q} delay={(i % 2) * 70}>
                <details className="group rounded-2xl border border-navy-800/10 bg-ivory/50 transition-colors open:bg-white open:shadow-card">
                  <summary className="flex cursor-pointer items-center justify-between gap-5 px-6 py-4.5 py-5 text-[15px] font-semibold text-navy-800 [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-800/[0.06] text-navy-800 transition-transform group-open:rotate-45">
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                        <path d="M6 1.5v9M1.5 6h9" strokeLinecap="round" />
                      </svg>
                    </span>
                  </summary>
                  <p className="px-6 pb-5 text-[14px] leading-[1.8] text-ink-soft">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ================= CTA ================= */}
      <section className="relative overflow-hidden bg-navy-950">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="absolute left-1/2 top-[-50%] h-[30rem] w-[46rem] -translate-x-1/2 rounded-full bg-gold-500/10 blur-3xl" />
        </div>
        <Dots className="right-10 top-10 hidden h-28 w-40 opacity-30 lg:block" />
        <div className="relative mx-auto max-w-4xl px-5 py-20 text-center lg:py-24">
          <Reveal>
            <h2 className="font-display text-3xl leading-[1.15] tracking-tight text-ivory sm:text-5xl">
              Keep your evenings.
              <br /><span className="text-gold-300">We'll do the applying.</span>
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-[15.5px] leading-[1.8] text-ivory/60">
              A free consultation maps your domains, your targets and your first month —
              before you commit to anything.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-4">
              <button onClick={() => openConsult()}
                className="group inline-flex items-center gap-2.5 rounded-full bg-gold-500 px-8 py-4 text-[15px] font-semibold text-navy-900 shadow-[0_14px_36px_-10px_rgba(201,162,39,0.55)] transition hover:bg-gold-400">
                Book a free consultation
                <I d={ic.arrow} size={17} className="transition-transform group-hover:translate-x-1" />
              </button>
              <Link to={portalTo}
                className="inline-flex items-center rounded-full border border-white/25 px-8 py-4 text-[15px] font-semibold text-ivory transition hover:border-gold-300/70 hover:text-gold-300">
                Client Portal
              </Link>
            </div>
            <p className="mt-7 text-[12.5px] text-ivory/35">hello@gethired.uk · replies within one working day</p>
          </Reveal>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-white/10 bg-navy-950">
        <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
          <div className="grid gap-10 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="flex items-center gap-2.5">
                <LogoMark size={38} />
                <span className="font-display text-lg text-ivory">Get Hired UK</span>
              </div>
              <p className="mt-4 max-w-xs text-[13.5px] leading-relaxed text-ivory/45">
                A dedicated team that runs your job search — sourcing, tailoring and applying —
                with every step visible on your personal portal.
              </p>
            </div>
            <nav className="md:col-span-2" aria-label="Footer site">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ivory/35">Explore</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px]">
                {links.map(([href, label]) => (
                  <li key={href}><a href={href} className="text-ivory/60 transition hover:text-gold-300">{label}</a></li>
                ))}
              </ul>
            </nav>
            <div className="md:col-span-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ivory/35">Get started</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px] text-ivory/60">
                <li>
                  <button onClick={() => openConsult()} className="transition hover:text-gold-300">
                    Book a consultation
                  </button>
                </li>
                <li><Link to="/login" className="transition hover:text-gold-300">Client Portal</Link></li>
                <li><a href="mailto:hello@gethired.uk" className="transition hover:text-gold-300">hello@gethired.uk</a></li>
              </ul>
            </div>
            <div className="md:col-span-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-ivory/35">Office</p>
              <ul className="mt-4 space-y-2.5 text-[13.5px] text-ivory/60">
                <li>London, United Kingdom</li>
                <li className="tabular-nums">Local time · {clock || '—'}</li>
                <li className="flex items-center gap-2">
                  <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-success' : 'bg-navy-100/30'}`} aria-hidden="true" />
                  Portal {online === null ? '…' : online ? 'online' : 'offline'}
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-12 flex flex-col justify-between gap-2 border-t border-white/10 pt-6 text-[12px] text-ivory/30 sm:flex-row">
            <p>© {new Date().getFullYear()} Get Hired UK. All rights reserved.</p>
            <p>Portal screenshots show sample data.</p>
          </div>
        </div>
      </footer>

      <ConsultationModal
        open={Boolean(consult)}
        interest={consult?.interest}
        onClose={() => setConsult(null)}
      />
    </div>
  );
}
