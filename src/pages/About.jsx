import MainLayout from "../layouts/MainLayout";

export default function About() {
  return (
    <MainLayout>
      <section className="px-6 py-32">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-neutral-500">
            About
          </p>

          <h1 className="mb-8 text-5xl font-light">
            A thoughtful and personal approach.
          </h1>

          <p className="max-w-2xl text-lg leading-8 text-neutral-600">
            This page will tell your story, philosophy, and approach to your
            work.
          </p>
        </div>
      </section>
    </MainLayout>
  );
}
