import { createClient } from "npm:@supabase/supabase-js@2";

import {
  supabaseServiceRoleKey,
  supabaseUrl,
} from "../config.ts";

export const supabase = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  },
);
