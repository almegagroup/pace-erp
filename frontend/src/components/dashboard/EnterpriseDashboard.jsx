function StatCard({ item }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
        {item.label}
      </p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <h3 className="text-2xl font-semibold text-slate-900">{item.value}</h3>
        <span className="rounded-full bg-sky-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sky-700">
          {item.tag}
        </span>
      </div>
    </article>
  );
}

function ActionCard({ action }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-[0_10px_28px_rgba(15,23,42,0.06)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_16px_36px_rgba(14,116,144,0.12)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-2xl bg-sky-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">
          {action.badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          ->
        </span>
      </div>
      <h3 className="mt-4 text-lg font-semibold text-slate-900">
        {action.title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {action.description}
      </p>
    </button>
  );
}

export default function EnterpriseDashboard({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
}) {
  return (
    <section className="min-h-full bg-[linear-gradient(180deg,_#f8fbfd_0%,_#eef4f7_100%)] px-6 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-[28px] border border-slate-200 bg-white px-6 py-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.26em] text-sky-700">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 lg:text-3xl">
            {title}
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
            {subtitle}
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {stats.map((item) => (
            <StatCard key={item.label} item={item} />
          ))}
        </div>

        <div className="mt-6 rounded-[28px] border border-slate-200 bg-white p-6 shadow-[0_14px_40px_rgba(15,23,42,0.08)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            Quick Workspace
          </p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {actions.map((action) => (
              <ActionCard key={action.title} action={action} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
