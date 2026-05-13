import { createContext, useContext, useEffect, useState } from "react";

import { supabase } from "../lib/supabase";

const AdminAuthContext = createContext(null);

export function AdminAuthProvider({ children }) {
  const [session, setSession] = useState(null);

  const [loading, setLoading] = useState(true);

  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    async function loadSession() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setSession(session);

      setLoading(false);
    }

    loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);

      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }
  }

  async function logout() {
    try {
      setLoggingOut(true);

      const { error } = await supabase.auth.signOut();

      if (error) {
        throw error;
      }
    } finally {
      window.location.replace("/");
    }
  }

  return (
    <AdminAuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        loggingOut,
        login,
        logout,
        authenticated: !!session,
      }}
    >
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);

  if (!context) {
    throw new Error("useAdminAuth must be used within AdminAuthProvider");
  }

  return context;
}
