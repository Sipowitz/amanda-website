import PageTransition from "../components/PageTransition";

export default function Shop() {
  return (
    <PageTransition>
      <section className="min-h-[calc(100vh-5rem)] px-6 pb-24">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-neutral-500">
            Shop
          </p>

          <h1 className="mb-8 text-5xl font-light">
            Curated products and offerings.
          </h1>

          <p className="max-w-2xl text-lg leading-8 text-neutral-400">
            Future products and collections will appear here.
          </p>
        </div>
      </section>
    </PageTransition>
  );
}
