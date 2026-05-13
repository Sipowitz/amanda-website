import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import { useAdminAuth } from "../../contexts/AdminAuthContext";

export default function AdminLogin() {
  const [email, setEmail] = useState("");

  const [password, setPassword] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const navigate = useNavigate();

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

      navigate("/admin/dashboard");
    } catch (error) {
      console.error(error);

      alert("Invalid email or password");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return null;
  }

  return (
    <section className="min-h-screen bg-[#9ebd9e] px-6 pb-24 pt-24 text-[#f1e8ca]">
      <div className="mx-auto max-w-xl">
        <div className="rounded-[2.5rem] border border-white/10 bg-black/10 p-10 backdrop-blur-xl">
          <p className="mb-4 text-sm uppercase tracking-[0.3em] text-[#f1e8ca]/45">
            Admin Access
          </p>

          <h1 className="mb-10 text-5xl">Admin Login</h1>

          <form onSubmit={handleLogin} className="flex flex-col gap-6">
            <input
              type="email"
              placeholder="Email"
              required
              disabled={submitting}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 text-[#f1e8ca] outline-none transition focus:border-[#f1e8ca]/35 disabled:opacity-50"
            />

            <input
              type="password"
              placeholder="Password"
              required
              disabled={submitting}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-6 py-5 text-[#f1e8ca] outline-none transition focus:border-[#f1e8ca]/35 disabled:opacity-50"
            />

            <button
              type="submit"
              disabled={submitting}
              className="rounded-2xl border border-[#f1e8ca]/15 bg-[#f1e8ca]/10 px-8 py-5 text-[#f1e8ca] transition duration-300 hover:bg-[#f1e8ca]/16 disabled:opacity-50"
            >
              {submitting ? "Signing In..." : "Enter Admin"}
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => navigate("/")}
              className="rounded-2xl border border-white/10 bg-white/[0.03] px-8 py-5 text-[#f1e8ca]/70 transition duration-300 hover:border-[#f1e8ca]/20 hover:text-[#f1e8ca] disabled:opacity-50"
            >
              Cancel
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
