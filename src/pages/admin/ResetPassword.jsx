import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import { supabase } from "../../lib/supabase";

import { useToast } from "../../contexts/ToastContext";

import AdminCard from "../../components/admin/AdminCard";

export default function ResetPassword() {
  const [password, setPassword] = useState("");

  const [confirmPassword, setConfirmPassword] = useState("");

  const [checkingSession, setCheckingSession] = useState(true);

  const [recoverySessionAvailable, setRecoverySessionAvailable] =
    useState(false);

  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

  const toast = useToast();

  useEffect(() => {
    let mounted = true;

    async function checkRecoverySession() {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (!mounted) {
        return;
      }

      if (error) {
        console.error(error);
      }

      setRecoverySessionAvailable(Boolean(session));
      setCheckingSession(false);
    }

    checkRecoverySession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) {
        return;
      }

      if (event === "PASSWORD_RECOVERY" || session) {
        setRecoverySessionAvailable(Boolean(session));
        setCheckingSession(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();

    if (password.length < 8) {
      toast.error("Your new password must contain at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      toast.error("The passwords do not match.");
      return;
    }

    try {
      setSubmitting(true);

      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      await supabase.auth.signOut();

      toast.success("Your password has been changed successfully.");

      navigate("/admin/login", {
        replace: true,
      });
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Your password could not be changed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (checkingSession) {
    return (
      <section className="flex min-h-screen items-center justify-center bg-[#9ebd9e] px-6 text-[#f1e8ca]">
        <p className="text-sm uppercase tracking-[0.22em] text-[#f1e8ca]/60">
          Validating recovery link...
        </p>
      </section>
    );
  }

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#9ebd9e] px-6 py-16 text-[#f1e8ca]">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute left-[-120px] top-[10%] h-[320px] w-[320px] rounded-full bg-[#f1e8ca]/[0.04] blur-3xl" />

        <div className="absolute bottom-[-120px] right-[-80px] h-[320px] w-[320px] rounded-full bg-black/[0.08] blur-3xl" />

        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_55%)]" />
      </div>

      <div className="relative z-10 w-full max-w-md">
        <AdminCard className="p-8">
          <div className="mb-8">
            <p className="mb-4 text-xs uppercase tracking-[0.35em] text-[#f1e8ca]/45">
              Account Recovery
            </p>

            <h1 className="text-4xl leading-none text-[#f1e8ca]">
              Choose New Password
            </h1>

            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#f1e8ca]/60">
              Enter and confirm the new password for your administrator
              account.
            </p>
          </div>

          {!recoverySessionAvailable ? (
            <div className="flex flex-col gap-4">
              <p className="rounded-2xl border border-red-200/15 bg-red-500/10 p-5 text-sm leading-relaxed text-[#f1e8ca]/80">
                This recovery link is invalid or has expired. Request a new
                password-reset email from the admin login page.
              </p>

              <button
                type="button"
                onClick={() => navigate("/admin/login")}
                className="h-12 rounded-2xl border border-white/10 bg-white/[0.03] px-8 text-sm text-[#f1e8ca]/65 transition duration-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-[#f1e8ca]"
              >
                Return to Admin Login
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="new-password"
                  className="text-[11px] uppercase tracking-[0.22em] text-[#f1e8ca]/45"
                >
                  New Password
                </label>

                <input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={submitting}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-14 rounded-2xl border border-white/10 bg-black/[0.08] px-5 text-sm text-[#f1e8ca] outline-none backdrop-blur-xl transition duration-300 placeholder:text-[#f1e8ca]/30 hover:border-white/15 focus:border-[#f1e8ca]/35 focus:bg-black/[0.12] disabled:opacity-50"
                  placeholder="At least 8 characters"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  htmlFor="confirm-password"
                  className="text-[11px] uppercase tracking-[0.22em] text-[#f1e8ca]/45"
                >
                  Confirm Password
                </label>

                <input
                  id="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={submitting}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  className="h-14 rounded-2xl border border-white/10 bg-black/[0.08] px-5 text-sm text-[#f1e8ca] outline-none backdrop-blur-xl transition duration-300 placeholder:text-[#f1e8ca]/30 hover:border-white/15 focus:border-[#f1e8ca]/35 focus:bg-black/[0.12] disabled:opacity-50"
                  placeholder="Repeat new password"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="mt-3 h-14 rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 text-sm text-[#f1e8ca] backdrop-blur-xl transition duration-300 hover:border-[#f1e8ca]/25 hover:bg-[#f1e8ca]/14 disabled:opacity-50"
              >
                {submitting ? "Changing Password..." : "Change Password"}
              </button>
            </form>
          )}
        </AdminCard>
      </div>
    </section>
  );
}