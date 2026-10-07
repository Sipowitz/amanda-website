import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link, Outlet, useMatch } from "react-router-dom";

import { getActiveServices } from "../services/bookingService";

const staticServices = [
  { slug: "parties-gatherings", title: "Parties & Gatherings", description: "Intuitive readings for private parties, celebrations and gatherings, creating a memorable and engaging experience for your guests." },
  { slug: "corporate-public-events", title: "Corporate & Public Events", description: "Professional intuitive services for corporate functions, public events, festivals and other larger gatherings." },
];

function formatPrice(amount, currency) {
  return (amount / 100).toLocaleString("en-US", { style: "currency", currency });
}

export default function Services() {
  const modalOpen = Boolean(useMatch("/services/:serviceSlug/:bookingAction"));
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    getActiveServices().then((result) => { if (active) setServices(result); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const cards = [...services.map((service) => ({ ...service, bookable: true })), ...staticServices];
  return <>
    <section aria-hidden={modalOpen ? "true" : undefined} inert={modalOpen} className="px-6 pb-24">
      <div className="mx-auto w-full max-w-7xl"><motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }} className="max-w-5xl">
        <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">Services</p>
        <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">Ways to Work Together</h1>
        <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">Choose the service that fits what you need. Timed readings share one appointment calendar; untimed requests need no appointment.</p>
        {error && <p role="status" className="mb-8 text-[#f1e8ca]/70">Services could not be loaded. Please try again shortly.</p>}
        <div className="space-y-6">
          {loading ? <p className="text-[#f1e8ca]/70">Loading services...</p> : cards.map((service, index) => {
            const timed = service.booking_mode === "timed";
            const route = service.bookable ? `/services/${service.slug}/${timed ? "book" : "request"}` : null;
            return <motion.div key={`${service.bookable ? "booking" : "static"}:${service.slug}`} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 0.1 + index * 0.08, ease: [0.22, 1, 0.36, 1] }} className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md md:p-10">
              <h2 className="text-3xl font-light text-[#f1e8ca]">{service.name || service.title}</h2>
              {service.bookable && <div className="mt-3 flex flex-wrap items-center gap-3"><p className="text-2xl font-light text-[#f1e8ca]">{formatPrice(service.price_amount, service.currency)}</p>{timed && <span className="text-xs uppercase tracking-[0.18em] text-[#f1e8ca]/50">{service.duration_minutes} minutes</span>}</div>}
              <p className="mt-5 max-w-3xl text-lg leading-[1.8] text-[#f1e8ca]/75">{service.public_summary || service.description}</p>
              {route && <Link to={route} state={{ openedFromServices: true }} data-service-trigger={service.slug} className="mt-10 inline-flex items-center gap-3 rounded-full border border-[#f1e8ca]/30 px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#f1e8ca] transition-all duration-300 hover:border-[#f1e8ca]/60 hover:bg-white/10">{timed ? "Book now" : "Request now"}<span aria-hidden="true">-&gt;</span></Link>}
            </motion.div>;
          })}
        </div>
      </motion.div></div>
    </section>
    <Outlet />
  </>;
}
