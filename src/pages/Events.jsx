import PageTransition from "../components/PageTransition";

export default function Events() {
  return (
    <PageTransition>
      <section className="px-6 pb-24">
        <div className="mx-auto w-full max-w-5xl">
          <p className="mb-4 text-sm uppercase tracking-[0.35em] text-[#f1e8ca]/60">
            Events
          </p>

          <h1 className="mb-8 text-5xl font-light leading-[1.05] text-[#f1e8ca] md:text-7xl">
            Event Readings — Pricing & Booking
          </h1>

          <p className="mb-16 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
            A refined, intuitive experience for gatherings, celebrations, and
            corporate spaces.
          </p>

          <div className="space-y-16">
            <section>
              <h2 className="mb-6 text-3xl font-light text-[#f1e8ca]">
                Event Rates
              </h2>

              <p className="mb-8 max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
                I bring 20+ years of professional reading experience, grounded
                presence, and a seamless flow that keeps guests engaged.
              </p>

              <ul className="space-y-4 text-lg text-[#f1e8ca]/80">
                {[
                  ["$250/hour", "Standard Events"],
                  ["$300/hour", "Premium Events"],
                  ["$350/hour", "Corporate Events"],
                  ["$400/hour", "Executive & VIP Engagements"],
                ].map(([price, label]) => (
                  <li key={label} className="flex items-start gap-3">
                    <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#f1e8ca]/70" />
                    <span>
                      <strong className="text-[#f1e8ca]">{price}</strong> —{" "}
                      {label}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-8 text-lg font-medium text-[#f1e8ca]">
                2-hour minimum for all bookings
              </p>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f1e8ca]">
                Packages
              </h2>

              <div className="space-y-10">
                {[
                  {
                    title: "The Party Package — $550",
                    desc: "For birthdays, showers, and intimate gatherings.",
                    items: [
                      "2 hours of readings",
                      "Standard spread",
                      "Reflection cards for guests",
                    ],
                  },
                  {
                    title: "The Corporate Mini — $750",
                    desc: "A polished experience for teams and professional settings.",
                    items: [
                      "2 hours",
                      "Corporate rate",
                      "Custom event spread",
                      "Line-management system",
                    ],
                  },
                  {
                    title: "The Luxe Event — $1,200",
                    desc: "A cinematic, high-touch experience for premium events.",
                    items: [
                      "3 hours",
                      "Premium or corporate rate",
                      "Custom spread",
                      "Reflection cards",
                      "Ambient setup",
                      "Queue system",
                    ],
                  },
                ].map((pkg) => (
                  <div
                    key={pkg.title}
                    className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/5"
                  >
                    <h3 className="mb-4 text-2xl font-light text-[#f1e8ca]">
                      {pkg.title}
                    </h3>
                    <p className="mb-6 text-lg leading-[1.9] text-[#f1e8ca]/80">
                      {pkg.desc}
                    </p>
                    <ul className="space-y-3 text-[#f1e8ca]/80">
                      {pkg.items.map((i) => (
                        <li key={i}>• {i}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f1e8ca]">
                Add-Ons
              </h2>

              <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/5">
                <ul className="space-y-4 text-lg text-[#f1e8ca]/80">
                  <li>• Custom Event Spread — $75</li>
                  <li>• Keepsake Reflection Cards (25) — $50</li>
                  <li>• Line Management Kit — $40</li>
                  <li>• Playlist QR Card — $25</li>
                  <li>• Local Travel Fee — $50</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f1e8ca]">
                Deposit & Payment
              </h2>

              <div className="space-y-6 text-lg leading-[1.9] text-[#f1e8ca]/80">
                <p>
                  To reserve your date, a{" "}
                  <span className="font-medium text-[#f1e8ca]">
                    50% non-refundable deposit
                  </span>{" "}
                  is required.
                </p>

                <div>
                  <p className="mb-4">You're protected with flexibility:</p>

                  <ul className="space-y-4">
                    <li className="flex items-start gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#f1e8ca]/70" />
                      <span>
                        <strong className="text-[#f1e8ca]">
                          One complimentary reschedule
                        </strong>{" "}
                        (subject to availability)
                      </span>
                    </li>

                    <li className="flex items-start gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-[#f1e8ca]/70" />
                      <div>
                        If rescheduling isn't possible, your deposit may be
                        applied toward:
                        <ul className="mt-4 space-y-3 pl-6">
                          <li>
                            •{" "}
                            <strong className="text-[#f1e8ca]">
                              A private session
                            </strong>
                          </li>
                          <li>
                            •{" "}
                            <strong className="text-[#f1e8ca]">
                              A future event
                            </strong>{" "}
                            within 12 months
                          </li>
                        </ul>
                      </div>
                    </li>
                  </ul>
                </div>

                <p className="font-medium text-[#f1e8ca]">
                  Final balance is due 72 hours before the event.
                </p>

                <p>Payment options: card, invoice, digital pay.</p>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md transition-all duration-300 hover:-translate-y-1 hover:border-white/20 hover:bg-white/5 sm:p-10">
              <h2 className="mb-6 text-3xl font-light text-[#f1e8ca]">
                Booking
              </h2>

              <p className="max-w-4xl text-lg leading-[1.9] text-[#f1e8ca]/80">
                Your event deserves clarity, flow, and a reader who can hold the
                room. Submit your date request, and I'll confirm availability
                and next steps.
              </p>
            </section>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
