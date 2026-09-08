import { supabase } from "../lib/supabase";

export async function getBusinessTimezone() {
  const { data, error } = await supabase.rpc("get_business_timezone");
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new Error("Business timezone is unavailable.");
  // Server owns validation/defaulting. A failed request never silently changes
  // the customer's timezone; keep availability closed until it can be loaded.
  new Intl.DateTimeFormat("en-US", { timeZone: data }).format();
  return data;
}
