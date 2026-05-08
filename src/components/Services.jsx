export default function Services() {
  const services = [
    {
      title: "Brand Identity",
      description:
        "Thoughtful visual direction and online presence tailored to your business.",
    },
    {
      title: "Web Design",
      description:
        "Elegant responsive websites designed with simplicity and usability in mind.",
    },
    {
      title: "Creative Strategy",
      description:
        "Helping businesses communicate clearly through modern digital experiences.",
    },
  ];

  return (
    <section id="services" className="px-6 py-32">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-neutral-500">
            Services
          </p>

          <h2 className="text-4xl font-light md:text-5xl">What I Offer</h2>
        </div>

        <div className="grid gap-8 md:grid-cols-3">
          {services.map((service) => (
            <div
              key={service.title}
              className="rounded-[2rem] border border-neutral-200 bg-white p-8"
            >
              <h3 className="mb-4 text-2xl font-light">{service.title}</h3>

              <p className="leading-7 text-neutral-600">
                {service.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
