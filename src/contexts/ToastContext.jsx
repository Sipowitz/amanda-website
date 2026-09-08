import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { AnimatePresence, motion } from "framer-motion";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    ({ type = "info", message }) => {
      const id =
  typeof crypto !== "undefined" &&
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      setToasts((prev) => [
        {
          id,
          type,
          message,
        },
        ...prev,
      ]);

      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast],
  );

  const value = useMemo(() => {
    return {
      success(message) {
        showToast({
          type: "success",
          message,
        });
      },

      error(message) {
        showToast({
          type: "error",
          message,
        });
      },

      info(message) {
        showToast({
          type: "info",
          message,
        });
      },
    };
  }, [showToast]);

  function getToastStyles(type) {
    switch (type) {
      case "success":
        return {
          border: "border-[#b9d7b9]/60",
          background: "bg-[#243b2b]/95",
          icon: "✓",
        };

      case "error":
        return {
          border: "border-[#f0b4a8]/70",
          background: "bg-[#3f2928]/95",
          icon: "✕",
        };

      default:
        return {
          border: "border-[#d8e3d5]/45",
          background: "bg-[#293b31]/95",
          icon: "•",
        };
    }
  }

  return (
    <ToastContext.Provider value={value}>
      {children}

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex justify-center px-4 sm:justify-end">
        <div className="flex w-full max-w-sm flex-col gap-3">
          <AnimatePresence>
            {toasts.map((toast) => {
              const styles = getToastStyles(toast.type);

              return (
                <motion.div
                  key={toast.id}
                  initial={{
                    opacity: 0,
                    y: 20,
                    scale: 0.96,
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    scale: 1,
                  }}
                  exit={{
                    opacity: 0,
                    y: 12,
                    scale: 0.96,
                  }}
                  transition={{
                    duration: 0.22,
                    ease: "easeOut",
                  }}
                  className={`pointer-events-auto overflow-hidden rounded-[1.75rem] border ${styles.border} ${styles.background} text-[#fff8e7] shadow-[0_16px_45px_rgba(20,35,24,0.28)] backdrop-blur-2xl`}
                >
                  <div className="flex items-start gap-4 p-5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-sm text-[#f1e8ca]">
                      {styles.icon}
                    </div>

                    <div className="flex-1 pt-0.5">
                      <p className="text-sm leading-relaxed text-[#fff8e7]">
                        {toast.message}
                      </p>
                    </div>

                    <button
                      onClick={() => removeToast(toast.id)}
                      aria-label="Dismiss notification"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#fff8e7]/75 transition hover:bg-white/10 hover:text-[#fff8e7]"
                    >
                      ✕
                    </button>
                  </div>

                  <motion.div
                    initial={{
                      width: "100%",
                    }}
                    animate={{
                      width: 0,
                    }}
                    transition={{
                      duration: 4,
                      ease: "linear",
                    }}
                    className="h-[2px] bg-white/20"
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
