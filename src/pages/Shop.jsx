import MainLayout from "../layouts/MainLayout";
import PageTransition from "../components/PageTransition";

export default function Shop() {
  return (
    <PageTransition>
      <MainLayout>
        <section className="px-6 py-32">
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
      </MainLayout>
    </PageTransition>
  );
}
