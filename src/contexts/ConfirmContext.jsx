import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { AnimatePresence, motion } from "framer-motion";

const ConfirmContext = createContext(null);

export function ConfirmProvider({ children }) {
  const [confirmState, setConfirmState] = useState(null);

  const confirm = useCallback(({ title, message, confirmText = "Confirm" }) => {
    return new Promise((resolve) => {
      setConfirmState({
        title,
        message,
        confirmText,
        resolve,
      });
    });
  }, []);

  function handleClose(result) {
    if (confirmState?.resolve) {
      confirmState.resolve(result);
    }

    setConfirmState(null);
  }

  const value = useMemo(() => {
    return confirm;
  }, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      <AnimatePresence>
        {confirmState && (
          <motion.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            transition={{
              duration: 0.18,
            }}
            className="fixed inset-0 z-[120] flex items-end justify-center bg-black/45 p-4 sm:items-center sm:p-6"
          >
            {/* Backdrop Click */}
            <button
              onClick={() => handleClose(false)}
              className="absolute inset-0"
              aria-label="Close confirmation modal"
            />

            {/* Modal */}
            <motion.div
              initial={{
                opacity: 0,
                y: 24,
                scale: 0.96,
              }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                y: 18,
                scale: 0.98,
              }}
              transition={{
                duration: 0.22,
                ease: "easeOut",
              }}
              className="relative z-10 w-full max-w-md overflow-hidden rounded-[2.25rem] border border-white/10 bg-[#88a888]/95 shadow-[0_20px_80px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
            >
              {/* Atmosphere */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.08),transparent_38%)]" />

                <div className="absolute inset-0 bg-gradient-to-b from-white/[0.03] to-black/[0.08]" />
              </div>

              <div className="relative p-7 sm:p-8">
                <div className="mb-8">
                  <p className="mb-3 text-xs uppercase tracking-[0.3em] text-[#f1e8ca]/40">
                    Confirmation
                  </p>

                  <h2 className="mb-4 text-3xl text-[#f1e8ca]">
                    {confirmState.title}
                  </h2>

                  <p className="leading-relaxed text-[#f1e8ca]/70">
                    {confirmState.message}
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                  <button
                    onClick={() => handleClose(false)}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] px-6 py-4 text-[#f1e8ca]/70 transition hover:border-[#f1e8ca]/20 hover:text-[#f1e8ca]"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={() => handleClose(true)}
                    className="rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-6 py-4 text-[#f1e8ca] transition hover:bg-[#f1e8ca]/16"
                  >
                    {confirmState.confirmText}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const context = useContext(ConfirmContext);

  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }

  return context;
}
