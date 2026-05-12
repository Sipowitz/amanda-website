import PageTransition from "../components/PageTransition";

export default function Events() {
  return (
    <PageTransition>
      <section className="px-6 pb-24">
        <div className="mx-auto max-w-3xl">
          <p className="mb-4 text-xs uppercase tracking-[0.35em] text-emerald-100/50">
            Events
          </p>

          <h1 className="mb-6 text-4xl font-light tracking-tight text-[#f3efe7] sm:text-5xl">
            Event Readings — Pricing & Booking
          </h1>

          <p className="mb-16 max-w-2xl text-base leading-8 text-[#d8d2c8]/80 sm:text-lg">
            A refined, intuitive experience for gatherings, celebrations, and
            corporate spaces.
          </p>

          <div className="space-y-16">
            <section>
              <h2 className="mb-6 text-3xl font-light text-[#f3efe7]">
                Event Rates
              </h2>

              <p className="mb-8 max-w-2xl text-base leading-8 text-[#d8d2c8]/80">
                I bring 20+ years of professional reading experience, grounded
                presence, and a seamless flow that keeps guests engaged.
              </p>

              <ul className="space-y-4 text-lg text-[#f5f1e8]">
                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />
                  <span>
                    <strong>$250/hour</strong> — Standard Events
                  </span>
                </li>

                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />
                  <span>
                    <strong>$300/hour</strong> — Premium Events
                  </span>
                </li>

                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />
                  <span>
                    <strong>$350/hour</strong> — Corporate Events
                  </span>
                </li>

                <li className="flex items-start gap-3">
                  <span className="mt-2 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />
                  <span>
                    <strong>$400/hour</strong> — Executive & VIP Engagements
                  </span>
                </li>
              </ul>

              <p className="mt-8 text-lg font-medium text-[#f3efe7]">
                2-hour minimum for all bookings
              </p>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f3efe7]">
                Packages
              </h2>

              <div className="space-y-10">
                <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
                  <h3 className="mb-4 text-2xl font-light text-[#f3efe7]">
                    The Party Package — $550
                  </h3>

                  <p className="mb-6 text-base leading-8 text-[#d8d2c8]/80">
                    For birthdays, showers, and intimate gatherings.
                  </p>

                  <ul className="space-y-3 text-[#ece7de]">
                    <li>• 2 hours of readings</li>
                    <li>• Standard spread</li>
                    <li>• Reflection cards for guests</li>
                  </ul>
                </div>

                <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
                  <h3 className="mb-4 text-2xl font-light text-[#f3efe7]">
                    The Corporate Mini — $750
                  </h3>

                  <p className="mb-6 text-base leading-8 text-[#d8d2c8]/80">
                    A polished experience for teams and professional settings.
                  </p>

                  <ul className="space-y-3 text-[#ece7de]">
                    <li>• 2 hours</li>
                    <li>• Corporate rate</li>
                    <li>• Custom event spread</li>
                    <li>• Line-management system</li>
                  </ul>
                </div>

                <div className="rounded-3xl border border-emerald-200/10 bg-emerald-950/10 p-8 backdrop-blur-md">
                  <h3 className="mb-4 text-2xl font-light text-[#f3efe7]">
                    The Luxe Event — $1,200
                  </h3>

                  <p className="mb-6 text-base leading-8 text-[#d8d2c8]/80">
                    A cinematic, high-touch experience for premium events.
                  </p>

                  <ul className="space-y-3 text-[#ece7de]">
                    <li>• 3 hours</li>
                    <li>• Premium or corporate rate</li>
                    <li>• Custom spread</li>
                    <li>• Reflection cards</li>
                    <li>• Ambient setup</li>
                    <li>• Queue system</li>
                  </ul>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f3efe7]">
                Add-Ons
              </h2>

              <div className="rounded-3xl border border-white/10 bg-black/10 p-8 backdrop-blur-md">
                <ul className="space-y-4 text-lg text-[#ece7de]">
                  <li>• Custom Event Spread — $75</li>
                  <li>• Keepsake Reflection Cards (25) — $50</li>
                  <li>• Line Management Kit — $40</li>
                  <li>• Playlist QR Card — $25</li>
                  <li>• Local Travel Fee — $50</li>
                </ul>
              </div>
            </section>

            <section>
              <h2 className="mb-8 text-3xl font-light text-[#f3efe7]">
                Deposit & Payment
              </h2>

              <div className="space-y-6 text-base leading-8 text-[#d8d2c8]/80">
                <p>
                  To reserve your date, a{" "}
                  <span className="font-medium text-[#f3efe7]">
                    50% non-refundable deposit
                  </span>{" "}
                  is required.
                </p>

                <div>
                  <p className="mb-4">You’re protected with flexibility:</p>

                  <ul className="space-y-4 pl-2">
                    <li className="flex items-start gap-3">
                      <span className="mt-3 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />
                      <span>
                        <strong className="text-[#f3efe7]">
                          One complimentary reschedule
                        </strong>{" "}
                        (subject to availability)
                      </span>
                    </li>

                    <li className="flex items-start gap-3">
                      <span className="mt-3 h-1.5 w-1.5 rounded-full bg-emerald-200/80" />

                      <div>
                        If rescheduling isn’t possible, your deposit may be
                        applied toward:
                        <ul className="mt-4 space-y-3 pl-6">
                          <li>
                            •{" "}
                            <strong className="text-[#f3efe7]">
                              A private session
                            </strong>
                          </li>

                          <li>
                            •{" "}
                            <strong className="text-[#f3efe7]">
                              A future event
                            </strong>{" "}
                            within 12 months
                          </li>
                        </ul>
                      </div>
                    </li>
                  </ul>
                </div>

                <p className="font-medium text-[#f3efe7]">
                  Final balance is due 72 hours before the event.
                </p>

                <p>Payment options: card, invoice, digital pay.</p>
              </div>
            </section>

            <section className="rounded-3xl border border-emerald-200/10 bg-black/10 p-8 backdrop-blur-md sm:p-10">
              <h2 className="mb-6 text-3xl font-light text-[#f3efe7]">
                Booking
              </h2>

              <p className="max-w-2xl text-base leading-8 text-[#ece7de] sm:text-lg">
                Your event deserves clarity, flow, and a reader who can hold the
                room. Submit your date request, and I’ll confirm availability
                and next steps.
              </p>
            </section>
          </div>
        </div>
      </section>
    </PageTransition>
  );
}
