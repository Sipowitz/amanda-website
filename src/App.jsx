import { Routes, Route } from "react-router-dom";

import Home from "./pages/Home";
import About from "./pages/About";
import Booking from "./pages/Booking";
import Events from "./pages/Events";
import Shop from "./pages/Shop";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/about" element={<About />} />
      <Route path="/booking" element={<Booking />} />
      <Route path="/events" element={<Events />} />
      <Route path="/shop" element={<Shop />} />
    </Routes>
  );
}
