import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { supabase } from "../../lib/supabase";

export default function AdminLogin() {
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [resetMode, setResetMode] = useState(false);

  const navigate = useNavigate();

  const toast = useToast();

  const { authenticated, loading, login } = useAdminAuth();

  useEffect(() => {
    if (!loading && authenticated) {
      navigate("/admin/dashboard");
    }
  }, [authenticated, loading, navigate]);

  async function handleLogin(event) {
    event.preventDefault();

    try {
      setSubmitting(true);

      await login(email, password);

      toast.success("Welcome back");
    } catch (error) {
      console.error(error);

      toast.error("Invalid email or password");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordReset(event) {
    event.preventDefault();

    try {
      setSubmitting(true);

      const redirectTo = `${window.location.origin}/reset-password`;

      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        throw error;
      }

      toast.success(
        "Password reset email sent. Check your inbox and follow the link.",
      );

      setResetMode(false);
    } catch (error) {
      console.error(error);

      toast.error(
        error.message || "The password reset email could not be sent.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return null;
  }

  return (
    <section className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#9ebd9e] px-5 py-12 sm:px-6 sm:py-16">
      {/* Background atmosphere */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.16),transparent_36%),radial-gradient(circle_at_bottom_right,rgba(44,72,49,0.18),transparent_44%)]" />

        <div className="absolute left-[-120px] top-[8%] h-[360px] w-[360px] rounded-full bg-white/[0.08] blur-[90px]" />

        <div className="absolute bottom-[-140px] right-[-100px] h-[380px] w-[380px] rounded-full bg-[#35533a]/15 blur-[100px]" />

        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.035] via-transparent to-black/[0.07]" />
      </div>

      <div className="relative z-10 w-full max-w-[460px]">
        <div className="overflow-hidden rounded-[2rem] border border-[#dfe2d8] bg-[#fbfaf6] shadow-[0_28px_80px_rgba(45,65,48,0.22)]">
          <div className="px-7 py-8 sm:px-10 sm:py-10">
            <div className="mb-8">
              <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.32em] text-[#637267]">
                Admin Access
              </p>

              <h1 className="font-serif text-4xl font-normal leading-tight text-[#253126] sm:text-[2.75rem]">
                {resetMode ? "Reset Password" : "Admin Login"}
              </h1>

              <p className="mt-4 max-w-sm text-sm leading-7 text-[#667068]">
                {resetMode
                  ? "Enter your admin email address and a secure recovery link will be sent to you."
                  : "Secure access to the booking management dashboard."}
              </p>
            </div>

            <form
              onSubmit={resetMode ? handlePasswordReset : handleLogin}
              className="flex flex-col gap-5"
            >
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="admin-email"
                  className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#647067]"
                >
                  Email
                </label>

                <input
                  id="admin-email"
                  type="email"
                  autoComplete="email"
                  required
                  disabled={submitting}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-14 rounded-xl border border-[#d8ddd4] bg-white px-4 text-sm text-[#253126] outline-none transition duration-200 placeholder:text-[#9ca39c] hover:border-[#bdc8bc] focus:border-[#55735b] focus:ring-4 focus:ring-[#55735b]/10 disabled:cursor-not-allowed disabled:opacity-55"
                  placeholder="Enter admin email"
                />
              </div>

              {!resetMode && (
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="admin-password"
                    className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#647067]"
                  >
                    Password
                  </label>

                  <input
                    id="admin-password"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={submitting}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-14 rounded-xl border border-[#d8ddd4] bg-white px-4 text-sm text-[#253126] outline-none transition duration-200 placeholder:text-[#9ca39c] hover:border-[#bdc8bc] focus:border-[#55735b] focus:ring-4 focus:ring-[#55735b]/10 disabled:cursor-not-allowed disabled:opacity-55"
                    placeholder="Enter password"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="mt-2 h-14 rounded-xl border border-[#426047] bg-[#496a50] px-8 text-sm font-semibold text-white shadow-[0_10px_25px_rgba(45,82,52,0.16)] transition duration-200 hover:border-[#36513b] hover:bg-[#3f5f46] focus:outline-none focus:ring-4 focus:ring-[#496a50]/20 disabled:cursor-not-allowed disabled:opacity-55"
              >
                {submitting
                  ? resetMode
                    ? "Sending..."
                    : "Signing In..."
                  : resetMode
                    ? "Send Recovery Email"
                    : "Enter Admin"}
              </button>

              <div className="flex flex-col items-center gap-4 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => {
                    setResetMode((current) => !current);
                    setPassword("");
                  }}
                  className="text-sm font-medium text-[#5e6d61] transition hover:text-[#35543b] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetMode ? "Return to Login" : "Forgot Password?"}
                </button>

                {!resetMode && (
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => navigate("/")}
                    className="text-sm font-medium text-[#5e6d61] transition hover:text-[#35543b] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Return to Website
                  </button>
                )}
              </div>
            </form>
          </div>

          <div className="border-t border-[#e2e4de] bg-[#f4f3ee] px-7 py-4 text-center sm:px-10">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#879087]">
              Amanda Beach · Booking Management
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}