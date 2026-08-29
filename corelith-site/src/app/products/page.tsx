import type { Metadata } from "next";
import Link from "next/link";
import { products } from "@/content/products";
import { PageHead } from "@/components/PageHead";
import { Arrow, Band, GoLink } from "@/components/primitives";

export const metadata: Metadata = {
  title: "Products",
  description:
    "Technology Corelith Technologies develops and ships for itself, starting with Paralith — an agentic development environment.",
  alternates: { canonical: "/products" },
};

export default function ProductsPage() {
  return (
    <>
      <PageHead
        index="—"
        datum="Products"
        title="We build for our clients. We also build for ourselves."
        lead="Running our own products is how we find out what survives production. Paralith is the one currently shipping."
        measure={`${products.length} product shipping`}
      />

      <Band tone="ground">
        <div className="shell">
          {/* The facts are a specification, so they sit on a machined plate:
              one .panel carrying the whole readout, the rim span first inside
              it, the rows kept as bare hairline seams rather than nested
              cards. A spec sheet is one plate, not a grid of tiles. */}
          {products.map((product) => (
            <article
              key={product.slug}
              className="reveal grid grid-cols-1 gap-x-16 gap-y-10 lg:grid-cols-12"
            >
              <div className="lg:col-span-5">
                <div className="flex items-center gap-3">
                  <h2 className="text-[length:var(--step-page)] leading-none">
                    {product.wordmark}
                  </h2>
                  <span className="tag tag-accent">{product.status}</span>
                </div>
                <p className="mono mt-5 text-[var(--ink-2)]">{product.category}</p>
                <p className="mt-8 max-w-[44ch] text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
                  {product.brief}
                </p>
                <GoLink href={`/products/${product.slug}`} className="mt-9">
                  Explore {product.name}
                </GoLink>
              </div>

              <div className="lg:col-span-7">
                <div className="panel p-6 sm:p-8">
                  <span className="panel-rim" aria-hidden="true" />
                  <dl>
                    {product.facts.map((fact, i) => (
                      <div
                        key={fact.label}
                        className={`grid grid-cols-2 gap-6 py-4 ${i === 0 ? "" : "border-t"}`}
                        style={{ borderColor: "var(--hair)" }}
                      >
                        <dt className="mono text-[var(--ink-3)]">{fact.label}</dt>
                        <dd className="mono-plain text-[15px] text-[var(--ink)]">{fact.value}</dd>
                      </div>
                    ))}
                    <div
                      className="grid grid-cols-2 gap-6 border-t py-4"
                      style={{ borderColor: "var(--hair)" }}
                    >
                      <dt className="mono text-[var(--ink-3)]">Platforms</dt>
                      <dd className="flex flex-col gap-1.5">
                        {product.platforms.map((platform) => (
                          <span key={platform.name} className="mono-plain text-[15px]">
                            <span className="text-[var(--ink)]">{platform.name}</span>
                            <span className="text-[var(--ink-3)]"> — {platform.state.toLowerCase()}</span>
                          </span>
                        ))}
                      </dd>
                    </div>
                  </dl>
                </div>
              </div>
            </article>
          ))}
        </div>
      </Band>

      {/* The architecture supports more products; saying so is honest, listing
          imaginary ones would not be. */}
      <Band tone="recessed" tight>
        <div className="shell grid grid-cols-1 gap-x-16 gap-y-6 lg:grid-cols-12">
          <h2 className="text-[length:var(--step-head)] lg:col-span-5">More is in development.</h2>
          <div className="lg:col-span-7">
            <p className="text-[length:var(--step-lead)] leading-[1.5] text-[var(--ink-2)]">
              Corelith has other products in progress. They are not listed here because nothing has
              shipped yet, and a product page for something you cannot use is an advertisement for a
              plan. When one is real it will appear here with a version number attached.
            </p>
            <Link href="/research" className="btn btn-secondary mt-8">
              What we are working on
              <Arrow />
            </Link>
          </div>
        </div>
      </Band>
    </>
  );
}
