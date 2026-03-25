import logo from "../../assets/pace-bgr.png";

export default function PublicAuthShell({
  children,
  title = "",
  subtitle = "",
  cardWidthClass = "max-w-[420px]",
  logoWidthClass = "w-[360px]",
  showTagline = false,
  tagline = "Process Automation & Control Environment",
  headerSlot = null,
  footerSlot = null,
  align = "center",
}) {
  const headerAlignment =
    align === "left" ? "items-start text-left" : "items-center text-center";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,_#f7f8fb_0%,_#eef3f8_100%)]">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-[-8%] top-[-12%] h-64 w-64 rounded-full bg-sky-100/70 blur-3xl" />
        <div className="absolute right-[-10%] top-[8%] h-80 w-80 rounded-full bg-blue-100/60 blur-3xl" />
        <div className="absolute bottom-[-12%] left-[20%] h-72 w-72 rounded-full bg-slate-200/60 blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.6)_0%,rgba(255,255,255,0)_38%,rgba(255,255,255,0.45)_100%)]" />
      </div>

      <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
        <div className={`w-full ${cardWidthClass}`}>
          <div className="rounded-[30px] border border-slate-200/80 bg-white/92 p-6 shadow-[0_28px_90px_rgba(15,23,42,0.10)] backdrop-blur md:p-8">
            <div className={`flex flex-col ${headerAlignment}`}>
              <div className={`${logoWidthClass} max-w-full`}>
                <img
                  src={logo}
                  alt="PACE ERP"
                  className="w-full h-auto"
                  loading="eager"
                />
              </div>

              {showTagline ? (
                <p className="mt-2 text-[15px] tracking-[0.08em] text-slate-600 md:text-base">
                  {tagline}
                </p>
              ) : null}

              {title ? (
                <h1 className="mt-4 text-[26px] font-semibold tracking-tight text-slate-900">
                  {title}
                </h1>
              ) : null}

              {subtitle ? (
                <p className="mt-3 max-w-xl text-sm leading-6 text-slate-500">
                  {subtitle}
                </p>
              ) : null}

              {headerSlot}
            </div>

            <div className="mt-6">{children}</div>

            {footerSlot ? <div className="mt-6">{footerSlot}</div> : null}

            <div className="mt-6 text-center text-xs tracking-[0.14em] text-slate-400">
              (c) Almega Group
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
