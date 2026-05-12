import Hero from "../components/Hero";
import Services from "../components/Services";
import PageTransition from "../components/PageTransition";

export default function Home() {
  return (
    <PageTransition>
      <Hero />
      <Services />
    </PageTransition>
  );
}
