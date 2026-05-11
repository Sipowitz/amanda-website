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
              Event Readings — Pricing & Booking A refined, intuitive experience
              for gatherings, celebrations, and corporate spaces. Event Rates I
              bring 20+ years of professional reading experience, grounded
              presence, and a seamless flow that keeps guests engaged. $250/hour
              — Standard Events $300/hour — Premium Events $350/hour — Corporate
              Events $400/hour — Executive & VIP Engagements 2‑hour minimum for
              all bookings Packages The Party Package — $550 For birthdays,
              showers, and intimate gatherings. 2 hours of readings Standard
              spread Reflection cards for guests The Corporate Mini — $750 A
              polished experience for teams and professional settings. 2 hours
              Corporate rate Custom event spread Line‑management system The Luxe
              Event — $1,200 A cinematic, high‑touch experience for premium
              events. 3 hours Premium or corporate rate Custom spread Reflection
              cards Ambient setup Queue system Add‑Ons Custom Event Spread — $75
              Keepsake Reflection Cards (25) — $50 Line Management Kit — $40
              Playlist QR Card — $25 Local Travel Fee — $50 Deposit & Payment To
              reserve your date, a 50% non‑refundable deposit is required.
              You’re protected with flexibility: One complimentary reschedule
              (subject to availability) If rescheduling isn’t possible, your
              deposit may be applied toward: A private session, or A future
              event within 12 months Final balance is due 72 hours before the
              event. Payment options: card, invoice, digital pay. Booking Your
              event deserves clarity, flow, and a reader who can hold the room.
              Submit your date request, and I’ll confirm availability and next
              steps.
            </p>
          </div>
        </section>
      </MainLayout>
    </PageTransition>
  );
}
