import MainLayout from "../layouts/MainLayout";
import PageTransition from "../components/PageTransition";

export default function Events() {
  return (
    <PageTransition>
      <MainLayout>
        <section className="px-6 py-32">
          <div className="mx-auto max-w-4xl">
            <p className="mb-4 text-sm uppercase tracking-[0.3em] text-neutral-500">
              Events
            </p>

            <h1 className="mb-8 text-5xl font-light">
              Upcoming experiences and gatherings.
            </h1>

            <p className="max-w-2xl text-lg leading-8 text-neutral-400">
              Event information and schedules will appear here.
            </p>
          </div>
        </section>
      </MainLayout>
    </PageTransition>
  );
}
