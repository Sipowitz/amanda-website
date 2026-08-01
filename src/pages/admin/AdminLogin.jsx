import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

import { useToast } from "../../contexts/ToastContext";

import { supabase } from "../../lib/supabase";

import AdminCard from "../../components/admin/AdminCard";

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
              Admin Access
            </p>

            <h1 className="text-4xl leading-none text-[#f1e8ca]">
              {resetMode ? "Reset Password" : "Admin Login"}
            </h1>

            <p className="mt-4 max-w-sm text-sm leading-relaxed text-[#f1e8ca]/60">
              {resetMode
                ? "Enter your admin email address and a secure recovery link will be sent to you."
                : "Secure access to the booking management dashboard."}
            </p>
          </div>

          <form
            onSubmit={resetMode ? handlePasswordReset : handleLogin}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              <label
                htmlFor="admin-email"
                className="text-[11px] uppercase tracking-[0.22em] text-[#f1e8ca]/45"
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
                className="h-14 rounded-2xl border border-white/10 bg-black/[0.08] px-5 text-sm text-[#f1e8ca] outline-none backdrop-blur-xl transition duration-300 placeholder:text-[#f1e8ca]/30 hover:border-white/15 focus:border-[#f1e8ca]/35 focus:bg-black/[0.12] disabled:opacity-50"
                placeholder="Enter admin email"
              />
            </div>

            {!resetMode && (
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="admin-password"
                  className="text-[11px] uppercase tracking-[0.22em] text-[#f1e8ca]/45"
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
                  className="h-14 rounded-2xl border border-white/10 bg-black/[0.08] px-5 text-sm text-[#f1e8ca] outline-none backdrop-blur-xl transition duration-300 placeholder:text-[#f1e8ca]/30 hover:border-white/15 focus:border-[#f1e8ca]/35 focus:bg-black/[0.12] disabled:opacity-50"
                  placeholder="Enter password"
                />
              </div>
            )}

            <div className="mt-3 flex flex-col gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="h-14 rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 text-sm text-[#f1e8ca] backdrop-blur-xl transition duration-300 hover:border-[#f1e8ca]/25 hover:bg-[#f1e8ca]/14 disabled:opacity-50"
              >
                {submitting
                  ? resetMode
                    ? "Sending..."
                    : "Signing In..."
                  : resetMode
                    ? "Send Recovery Email"
                    : "Enter Admin"}
              </button>

              <button
                type="button"
                disabled={submitting}
                onClick={() => {
                  setResetMode((current) => !current);
                  setPassword("");
                }}
                className="h-12 rounded-2xl border border-white/10 bg-white/[0.03] px-8 text-sm text-[#f1e8ca]/65 transition duration-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-[#f1e8ca] disabled:opacity-50"
              >
                {resetMode ? "Return to Login" : "Forgot Password?"}
              </button>

              {!resetMode && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => navigate("/")}
                  className="h-12 rounded-2xl border border-white/10 bg-white/[0.03] px-8 text-sm text-[#f1e8ca]/65 transition duration-300 hover:border-white/15 hover:bg-white/[0.05] hover:text-[#f1e8ca] disabled:opacity-50"
                >
                  Return to Website
                </button>
              )}
            </div>
          </form>
        </AdminCard>
      </div>
    </section>
  );
}