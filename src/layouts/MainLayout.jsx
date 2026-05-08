import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

export default function MainLayout({ children }) {
  return (
    <div className="min-h-screen bg-[#f8f5f1] text-[#111111]">
      <Navbar />

      <main className="pt-24">{children}</main>

      <Footer />
    </div>
  );
}
