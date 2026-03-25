function StatCard({ item }) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
            {item.label}
          </p>
          <h3 className="mt-3 text-3xl font-semibold text-slate-900">
            {item.value}
          </h3>
        </div>
        <span className="rounded-2xl bg-slate-900 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white">
          {item.tag}
        </span>
      </div>
      <p className="mt-4 text-sm leading-6 text-slate-600">
        {item.helper}
      </p>
    </article>
  );
}

function ActionCard({ action }) {
  return (
    <button
      type="button"
      onClick={action.onClick}
      className="group rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-[0_18px_48px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-[0_22px_54px_rgba(14,116,144,0.16)]"
    >
      <div className="flex items-center justify-between gap-4">
        <span className="rounded-2xl bg-sky-100 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-sky-700">
          {action.badge}
        </span>
        <span className="text-slate-300 transition group-hover:text-sky-600">
          →
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

function FeedRow({ row }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-4 last:border-b-0">
      <div>
        <p className="text-sm font-medium text-slate-900">{row.title}</p>
        <p className="mt-1 text-sm text-slate-500">{row.detail}</p>
      </div>
      <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-600">
        {row.status}
      </span>
    </div>
  );
}

export default function EnterpriseDashboard({
  eyebrow,
  title,
  subtitle,
  stats,
  actions,
  focusTitle,
  focusBody,
  feedTitle,
  feedRows,
}) {
  return (
    <section className="min-h-full bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.16),_transparent_32%),linear-gradient(180deg,_#f8fbfd_0%,_#eef4f7_100%)] px-6 py-8 text-slate-900">
      <div className="mx-auto max-w-7xl">
        <div className="overflow-hidden rounded-[32px] border border-slate-200 bg-slate-950 text-white shadow-[0_28px_90px_rgba(15,23,42,0.24)]">
          <div className="grid gap-8 px-7 py-8 lg:grid-cols-[1.65fr_1fr] lg:px-10">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-200">
                {eyebrow}
              </p>
              <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-white lg:text-5xl">
                {title}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300 lg:text-base">
                {subtitle}
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-white/5 p-5 backdrop-blur">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-200">
                {focusTitle}
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-200">
                {focusBody}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-8 grid gap-5 lg:grid-cols-4">
          {stats.map((item) => (
            <StatCard key={item.label} item={item} />
          ))}
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  Quick Workspace
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-slate-900">
                  Operational Shortcuts
                </h2>
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {actions.map((action) => (
                <ActionCard key={action.title} action={action} />
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
              {feedTitle}
            </p>
            <div className="mt-4">
              {feedRows.map((row) => (
                <FeedRow key={row.title} row={row} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
