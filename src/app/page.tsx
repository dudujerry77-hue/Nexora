import Link from 'next/link';
import { Store, Zap, Plug, Bell, BarChart3, ShieldCheck, Check, type LucideIcon } from 'lucide-react';

const HOW_IT_WORKS = [
  { title: 'Connect', body: 'Create a store and generate a Nexora API key, webhook secret, or SDK public key.' },
  { title: 'Send events', body: 'Your website or app pushes orders, products, and inventory to Nexora via API or signed webhooks.' },
  { title: 'Manage', body: 'Everything lands in one dashboard, in real time, with notifications the moment it happens.' },
];

const FEATURES: { icon: LucideIcon; title: string; body: string }[] = [
  { icon: Store, title: 'Multiple stores', body: 'Connect a restaurant, a fashion brand, and an electronics shop switch between them in one click.' },
  { icon: Zap, title: 'Real-time orders', body: 'New orders push straight to your dashboard over a live event stream no refresh needed.' },
  { icon: Plug, title: 'Open integrations', body: 'A documented API, signed webhooks, and a JavaScript SDK. Built to add more connectors later, never scraped.' },
  { icon: Bell, title: 'Notifications', body: 'New orders, low stock, and connection issues surface in one notification center, with unread indicators.' },
  { icon: BarChart3, title: 'Analytics', body: 'Revenue, order volume, and low-stock alerts across every store or one at a time.' },
  { icon: ShieldCheck, title: 'Security by default', body: 'Hashed API keys, HMAC signed webhooks, RBAC, and strict store level data isolation. See docs/AUTH.md.' },
];

const PRICING = [
  { name: 'Starter', price: '$0', tagline: 'For one store getting started', features: ['1 store', 'Nexora API + Webhooks', 'JS SDK', 'Email notifications'] },
  { name: 'Growth', price: '$49/mo', tagline: 'For teams running multiple stores', features: ['Up to 10 stores', 'Staff roles & permissions', 'Real time dashboard', 'Priority support'] },
  { name: 'Scale', price: 'Talk to us', tagline: 'For platforms and franchises', features: ['Unlimited stores', 'Custom connectors', 'Audit log export', 'Dedicated support'] },
];

export default function LandingPage() {
  return (
    <main>
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-lg font-bold tracking-tight">NEXORA</span>
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/login" className="text-[rgb(var(--text-muted))] hover:text-[rgb(var(--text))]">
            Log in
          </Link>
          <Link href="/register" className="rounded-lg bg-brand-600 px-4 py-2 font-medium text-white hover:bg-brand-700">
            Get Started
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-brand-600 dark:text-brand-400">
          One dashboard. Every store.
        </p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Manage every store from one place.</h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[rgb(var(--text-muted))]">
          Connect your shopping websites and apps to Nexora and manage orders, products, customers, inventory, and
          notifications from a single dashboard.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link href="/register" className="rounded-lg bg-brand-600 px-6 py-3 font-medium text-white hover:bg-brand-700">
            Get Started
          </Link>
          <Link href="#how-it-works" className="rounded-lg border border-[rgb(var(--border))] px-6 py-3 font-medium hover:bg-black/5 dark:hover:bg-white/5">
            View Demo
          </Link>
        </div>
      </section>

      <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold">How Nexora works</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {HOW_IT_WORKS.map((step, i) => (
            <div key={step.title} className="card p-6">
              <div className="mb-3 text-sm font-semibold text-brand-600 dark:text-brand-400">Step {i + 1}</div>
              <h3 className="mb-2 font-semibold">{step.title}</h3>
              <p className="text-sm text-[rgb(var(--text-muted))]">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="card p-6">
              <f.icon className="mb-3 h-7 w-7 text-brand-600 dark:text-brand-400" strokeWidth={1.5} aria-hidden="true" />
              <h3 className="mb-2 font-semibold">{f.title}</h3>
              <p className="text-sm text-[rgb(var(--text-muted))]">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 py-16 text-center">
        <h2 className="mb-3 text-2xl font-bold">Security</h2>
        <p className="mx-auto max-w-2xl text-[rgb(var(--text-muted))]">
          Password hashing, hashed & revocable API keys, HMAC signed webhooks with replay protection, role based
          access control, and per store data isolation are built in from day one  not bolted on later. Read the
          full breakdown in <code className="rounded bg-black/5 px-1 dark:bg-white/10">docs/AUTH.md</code>.
        </p>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-10 text-center text-2xl font-bold">Pricing</h2>
        <div className="grid gap-6 sm:grid-cols-3">
          {PRICING.map((tier) => (
            <div key={tier.name} className="card flex flex-col p-6">
              <h3 className="font-semibold">{tier.name}</h3>
              <div className="mt-2 text-2xl font-bold">{tier.price}</div>
              <p className="mt-1 text-sm text-[rgb(var(--text-muted))]">{tier.tagline}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm">
                {tier.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400" strokeWidth={2} aria-hidden="true" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-10 text-center text-sm text-[rgb(var(--text-muted))]">
        NEXORA One dashboard. Every store.
      </footer>
    </main>
  );
}
