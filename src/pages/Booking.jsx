import MainLayout from "../layouts/MainLayout";
import PageTransition from "../components/PageTransition";

export default function Booking() {
  return (
    <PageTransition>
      <MainLayout>
        <section className="px-6 py-32">
          <div className="mx-auto max-w-4xl">
            <p className="mb-4 text-sm uppercase tracking-[0.3em] text-neutral-500">
              Booking
            </p>

            <h1 className="mb-8 text-5xl font-light">Reserve your session.</h1>

            <p className="max-w-2xl text-lg leading-8 text-neutral-400">
              Booking information and services will appear here.
            </p>
          </div>
        </section>
      </MainLayout>
    </PageTransition>
  );
}
