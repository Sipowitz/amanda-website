export default function Hero() {
  return (
    <section className="flex min-h-screen items-center px-6 pt-32">
      <div className="mx-auto grid max-w-7xl gap-16 md:grid-cols-2 md:items-center">
        <div>
          <p className="mb-6 text-sm uppercase tracking-[0.35em] text-neutral-500">
            Personal Brand
          </p>

          <h1 className="mb-8 text-5xl font-light leading-tight md:text-7xl">
            Elegant digital experiences for modern businesses.
          </h1>

          <p className="max-w-xl text-lg leading-8 text-neutral-600">
            Creating refined and thoughtful websites that communicate your brand
            with clarity and confidence.
          </p>

          <button className="mt-10 rounded-full border border-black px-8 py-3 transition hover:bg-black hover:text-white">
            Learn More
          </button>
        </div>

        <div className="aspect-[4/5] overflow-hidden rounded-[2rem] bg-neutral-200" />
      </div>
    </section>
  );
}
