import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";

import Booking from "../../pages/Booking";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export default function BookingModal({ expectedMode }) {
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const returnFocusRef = useRef(document.activeElement);
  const navigate = useNavigate();
  const location = useLocation();
  const desktopHeightClass = expectedMode === "timed"
    ? "sm:min-h-[72vh]"
    : "sm:min-h-[60vh]";

  const closeModal = useCallback(() => {
    if (location.state?.openedFromServices) {
      navigate(-1);
    } else {
      navigate("/services", { replace: true });
    }
  }, [location.state, navigate]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const returnFocusElement = returnFocusRef.current;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeModal();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) {
        return;
      }

      const focusableElements = Array.from(
        dialogRef.current.querySelectorAll(focusableSelector),
      ).filter((element) => element.getClientRects().length > 0);

      if (!focusableElements.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);

      if (returnFocusElement?.isConnected) {
        returnFocusElement.focus({ preventScroll: true });
      }
    };
  }, [closeModal]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#263226]/35 p-2 backdrop-blur-[2px] sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="booking-dialog-title"
        tabIndex={-1}
        className={`relative max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-[1080px] overflow-y-auto overflow-x-hidden rounded-[1.5rem] border border-[#f1e8ca]/20 bg-[#789478]/95 shadow-[0_28px_90px_rgba(22,34,22,0.48)] [overscroll-behavior:contain] sm:max-h-[88vh] sm:w-[88vw] sm:rounded-[2rem] ${desktopHeightClass}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={closeModal}
          aria-label="Close booking dialog"
          className="sticky right-3 top-3 z-20 ml-auto mr-3 mt-3 flex h-11 w-11 items-center justify-center rounded-full border border-[#f1e8ca]/25 bg-[#526b52]/90 text-2xl font-light leading-none text-[#f1e8ca] shadow-lg backdrop-blur-md transition hover:border-[#f1e8ca]/50 hover:bg-[#496249] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f1e8ca] sm:right-5 sm:top-5 sm:mr-5 sm:mt-5"
        >
          <span aria-hidden="true">×</span>
        </button>

        <div className="-mt-11 pt-2 sm:pt-4">
          <Booking expectedMode={expectedMode} modal />
        </div>
      </div>
    </div>,
    document.body,
  );
}
