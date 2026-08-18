import BookingModal from "../components/booking/BookingModal";
import Services from "./Services";

export default function ServicesBooking({ expectedMode }) {
  return (
    <>
      <div aria-hidden="true" inert="">
        <Services />
      </div>
      <BookingModal expectedMode={expectedMode} />
    </>
  );
}
