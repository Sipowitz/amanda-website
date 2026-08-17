import { motion } from "framer-motion";

const iconClass = "h-6 w-6";

function IconCircle({ children, size = "default" }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full border border-[#f1e8ca]/12 bg-[#f1e8ca]/[0.07] text-[#f1e8ca]/85 ${
        size === "large" ? "h-14 w-14 sm:h-16 sm:w-16" : "h-12 w-12"
      }`}
    >
      {children}
    </span>
  );
}

function EnvelopeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClass} aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true">
      <path d="M7.2 3.8 9.7 7a1.5 1.5 0 0 1-.1 2l-1.4 1.4a15.7 15.7 0 0 0 5.4 5.4l1.4-1.4a1.5 1.5 0 0 1 2-.1l3.2 2.5a1.5 1.5 0 0 1 .4 1.8l-.7 1.7a2 2 0 0 1-1.9 1.2A15.5 15.5 0 0 1 2.5 6a2 2 0 0 1 1.2-1.9l1.7-.7a1.5 1.5 0 0 1 1.8.4Z" />
    </svg>
  );
}

function LocationIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true">
      <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={iconClass} aria-hidden="true">
      <path d="M14 4v10.2a4.2 4.2 0 1 1-3.4-4.1" />
      <path d="M14 4c.7 2.5 2.4 4 5 4.4" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className={iconClass} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none" />
    </svg>
  );
}

const contactDetails = [
  {
    label: "Email:",
    value: "reach.amanda.beach@gmail.com",
    href: "mailto:reach.amanda.beach@gmail.com",
    icon: <EnvelopeIcon />,
  },
  {
    label: "Phone:",
    value: "(831) 440-6599",
    href: "tel:+18314406599",
    icon: <PhoneIcon />,
  },
  {
    label: "Service Area:",
    value: "Available for private sessions, parties, and public events.",
    icon: <LocationIcon />,
  },
];

const socialLinks = [
  {
    platform: "TikTok",
    handle: "@amandabeachintuitive",
    href: "https://www.tiktok.com/@amandabeachintuitive?_r=1&_t=ZT-98vbapFjf37",
    icon: <TikTokIcon />,
  },
  {
    platform: "Instagram",
    handle: "@herbeachness",
    href: "https://www.instagram.com/herbeachness?igsh=cGRqN255Z2FhY3Nn&utm_source=qr",
    icon: <InstagramIcon />,
  },
];

export default function Contact() {
  return (
    <section className="px-6 pb-24">
      <div className="mx-auto w-full max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-5xl"
        >
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">
            Contact
          </p>

          <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            Get in Touch
          </h1>

          <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
            Whether you're interested in a private reading, booking an event, or
            simply have a question, I'd love to hear from you.
          </p>

          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-black/10 p-6 backdrop-blur-md sm:p-8 md:p-10">
              <h2 className="mb-8 text-3xl font-light text-[#f1e8ca]">
                Contact Details
              </h2>

              <div className="space-y-7">
                {contactDetails.map((detail) => (
                  <div key={detail.label} className="flex items-start gap-4 sm:items-center sm:gap-5">
                    <IconCircle>{detail.icon}</IconCircle>
                    <p className="min-w-0 text-base leading-7 text-[#f1e8ca]/80 sm:text-lg">
                      <span className="font-semibold text-[#f1e8ca]">{detail.label}</span>{" "}
                      {detail.href ? (
                        <a href={detail.href} className="break-words transition-colors duration-300 hover:text-[#fff9e5]">
                          {detail.value}
                        </a>
                      ) : (
                        detail.value
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-black/10 p-6 backdrop-blur-md sm:p-8 md:p-10">
              <h2 className="mb-8 text-3xl font-light text-[#f1e8ca]">
                Socials
              </h2>

              <div className="grid gap-4 md:grid-cols-2">
                {socialLinks.map((social) => (
                  <a
                    key={social.platform}
                    href={social.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex min-w-0 items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.045] p-4 transition-colors duration-300 hover:border-[#f1e8ca]/22 hover:bg-white/[0.075] sm:gap-5 sm:p-5"
                  >
                    <IconCircle size="large">{social.icon}</IconCircle>

                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-[#f1e8ca]/55 sm:text-xs">
                        {social.platform}
                      </p>
                      <p className="mt-1 break-words text-base text-[#f1e8ca] sm:text-lg">
                        {social.handle}
                      </p>
                    </div>

                    <span aria-hidden="true" className="shrink-0 text-xl text-[#f1e8ca]/55 transition duration-300 group-hover:translate-x-1 group-hover:text-[#f1e8ca]">
                      →
                    </span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
