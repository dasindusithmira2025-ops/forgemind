import Link from "next/link";
import { nav } from "@/content/site";
import { Arrow } from "@/components/primitives";
import { FieldStatic } from "@/components/visuals/FieldStatic";

export default function NotFound() {
  return (
    <section className="on-ground flex min-h-[70vh] items-center">
      <div className="shell grid grid-cols-1 items-center gap-12 py-[clamp(56px,8vw,120px)] lg:grid-cols-12">
        <div className="lg:col-span-7">
          <div className="flex items-baseline gap-4">
            <span className="index">404</span>
            <span className="mono text-[var(--ink-3)]">Page not found</span>
          </div>

          <h1 className="mt-8 max-w-[15ch] text-[length:var(--step-page)]">
            That page is not here.
          </h1>

          <p className="mt-7 max-w-[46ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
            Either it moved, or it never existed. Both are worth knowing about — if you followed a
            link from somewhere, tell us where and we will fix it.
          </p>

          <nav aria-label="Main sections" className="mt-10">
            <p className="mono text-[var(--ink-3)]">Try one of these</p>
            <ul className="mt-4">
              {nav.map((item, i) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-baseline gap-5 border-t py-4"
                    style={{ borderColor: "var(--hair)" }}
                  >
                    <span className="index">{String(i + 1).padStart(2, "0")}</span>
                    <span className="text-[17px] font-medium text-[var(--ink)]">{item.label}</span>
                    <span className="ml-auto text-[var(--ink-3)] transition-transform duration-[260ms] group-hover:translate-x-1.5">
                      <Arrow />
                    </span>
                  </Link>
                </li>
              ))}
              <li className="border-t" style={{ borderColor: "var(--hair)" }} />
            </ul>
          </nav>
        </div>

        <div className="flex justify-center lg:col-span-5">
          <FieldStatic className="h-[clamp(200px,30vw,380px)] w-[clamp(200px,30vw,380px)] text-[var(--ink-3)]" />
        </div>
      </div>
    </section>
  );
}
