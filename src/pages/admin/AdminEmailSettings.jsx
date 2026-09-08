import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AdminCard from "../../components/admin/AdminCard";
import AdminHeader from "../../components/admin/AdminHeader";
import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useConfirm } from "../../contexts/ConfirmContext";
import { useToast } from "../../contexts/ToastContext";
import { getEmailSettings, updateEmailSettings } from "../../services/adminService";
import { REMINDER_OPTIONS } from "../../constants/reminderOptions";

const timezoneOptions = [
  ["America/New_York", "Eastern Time — New York"],
  ["America/Chicago", "Central Time — Chicago"],
  ["America/Denver", "Mountain Time — Denver"],
  ["America/Phoenix", "Mountain Time — Arizona"],
  ["America/Los_Angeles", "Pacific Time — Los Angeles"],
  ["America/Anchorage", "Alaska Time"],
  ["Pacific/Honolulu", "Hawaii Time"],
];

const initialSettings = {
  adminNotificationEmail: "",
  bookingRemindersEnabled: false,
  bookingReminderHoursList: [24],
  sendAdminReminders: false,
  sendWindowStart: "08:00",
  sendWindowEnd: "20:00",
  timezone: "America/Chicago",
  confirmedBookingsOnly: true,
  sendForUnpaid: true,
  sendForPartPaid: true,
  sendForPaid: true,
};

const formatTimeValue = (value) => (value ? String(value).slice(0, 5) : "");
const sortReminderHours = (values) => [...values].map(Number).filter(Number.isFinite).sort((a, b) => b - a);
const mapSettings = (data) => ({
  adminNotificationEmail: data.admin_notification_email || "",
  bookingRemindersEnabled: data.booking_reminders_enabled,
  bookingReminderHoursList: sortReminderHours(data.booking_reminder_hours_list || [24]),
  sendAdminReminders: data.send_admin_reminders,
  sendWindowStart: formatTimeValue(data.send_window_start),
  sendWindowEnd: formatTimeValue(data.send_window_end),
  timezone: data.timezone || initialSettings.timezone,
  // Preserve backend compatibility fields even though they are intentionally hidden.
  confirmedBookingsOnly: data.confirmed_bookings_only,
  sendForUnpaid: data.send_for_unpaid,
  sendForPartPaid: data.send_for_part_paid,
  sendForPaid: data.send_for_paid,
});

export default function AdminEmailSettings({ embedded = false }) {
  const [settings, setSettings] = useState(initialSettings);
  const [savedTimezone, setSavedTimezone] = useState(initialSettings.timezone);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();
  const { logout } = useAdminAuth();
  const toast = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    let cancelled = false;
    getEmailSettings().then((data) => {
      if (!cancelled) {
        const mapped = mapSettings(data);
        setSettings(mapped);
        setSavedTimezone(mapped.timezone);
      }
    }).catch((error) => {
      console.error(error);
      if (!cancelled) toast.error("Failed to load settings");
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [toast]);

  function handleInputChange(event) {
    const { name, type, checked, value } = event.target;
    setSettings((current) => ({ ...current, [name]: type === "checkbox" ? checked : value }));
  }

  function handleReminderToggle(hours) {
    setSettings((current) => {
      const selected = current.bookingReminderHoursList.includes(hours);
      if (selected && current.bookingReminderHoursList.length === 1) return current;
      return { ...current, bookingReminderHoursList: selected ? current.bookingReminderHoursList.filter((value) => value !== hours) : sortReminderHours([...current.bookingReminderHoursList, hours]) };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (settings.bookingReminderHoursList.length === 0) {
      toast.error("At least one reminder timing is required");
      return;
    }
    if (settings.sendWindowEnd <= settings.sendWindowStart) {
      toast.error("The end of the sending window must be later than the start");
      return;
    }
    if (settings.timezone !== savedTimezone) {
      const accepted = await confirm({
        title: "Change business timezone?",
        message: "Changing the business timezone affects existing appointment times as well as reminders. Are you sure you want to continue?",
        confirmText: "Change timezone",
      });
      if (!accepted) return;
    }
    try {
      setSaving(true);
      const data = await updateEmailSettings({
        adminNotificationEmail: settings.adminNotificationEmail,
        bookingRemindersEnabled: settings.bookingRemindersEnabled,
        bookingReminderHoursList: sortReminderHours(settings.bookingReminderHoursList),
        sendAdminReminders: settings.sendAdminReminders,
        sendWindowStart: settings.sendWindowStart,
        sendWindowEnd: settings.sendWindowEnd,
        timezone: settings.timezone,
        confirmedBookingsOnly: settings.confirmedBookingsOnly,
        sendForUnpaid: settings.sendForUnpaid,
        sendForPartPaid: settings.sendForPartPaid,
        sendForPaid: settings.sendForPaid,
      });
      const mapped = mapSettings(data);
      setSettings(mapped);
      setSavedTimezone(mapped.timezone);
      toast.success("Settings updated successfully");
    } catch (error) {
      console.error(error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    const accepted = await confirm({ title: "Logout", message: "Are you sure you want to logout?", confirmText: "Logout" });
    if (!accepted) return;
    try {
      await logout();
      navigate("/");
      toast.success("Logged out successfully");
    } catch (error) {
      console.error(error);
      toast.error("Failed to logout");
    }
  }

  const content = loading ? <AdminCard className="p-8"><p className="text-sm text-[#687068]">Loading settings...</p></AdminCard> : (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <AdminCard className="p-7"><div className="flex flex-col gap-6"><div><p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">Notifications</p><h2 className="mt-3 font-serif text-3xl text-[#202620]">Booking notifications</h2><p className="mt-3 max-w-2xl text-sm leading-7 text-[#626b62]">Booking and admin reminders will be sent to this email address.</p></div><div className="flex max-w-2xl flex-col gap-2"><label htmlFor="admin-notification-email" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">Notification email</label><input id="admin-notification-email" type="email" name="adminNotificationEmail" value={settings.adminNotificationEmail} onChange={handleInputChange} autoComplete="email" maxLength="254" required className="admin-input w-full" /></div><label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5"><input type="checkbox" name="sendAdminReminders" checked={settings.sendAdminReminders} onChange={handleInputChange} disabled={!settings.bookingRemindersEnabled} className="admin-checkbox mt-1" /><span><span className="block text-sm font-semibold text-[#2d382f]">Send Amanda booking reminders</span><span className="mt-1 block text-xs leading-5 text-[#727b73]">Receive the same appointment reminders as customers.</span></span></label></div></AdminCard>
      <AdminCard className="p-7"><div className="flex flex-col gap-7"><div><p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">Booking reminders</p><h2 className="mt-3 font-serif text-3xl text-[#202620]">Customer reminders</h2><p className="mt-3 text-sm leading-7 text-[#626b62]">Choose when customers should be reminded before an appointment.</p></div><label className="flex cursor-pointer items-center gap-3 rounded-full border border-[#d8ddd4] bg-[#f7f8f4] px-4 py-3"><input type="checkbox" name="bookingRemindersEnabled" checked={settings.bookingRemindersEnabled} onChange={handleInputChange} className="admin-checkbox" /><span className="text-sm font-medium text-[#334036]">{settings.bookingRemindersEnabled ? "Reminders enabled" : "Reminders disabled"}</span></label><fieldset disabled={!settings.bookingRemindersEnabled} className="flex flex-col gap-3"><legend className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">Reminder schedule</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{REMINDER_OPTIONS.map((option) => <label key={option.value} className="flex cursor-pointer items-center gap-3 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-4"><input type="checkbox" checked={settings.bookingReminderHoursList.includes(option.value)} onChange={() => handleReminderToggle(option.value)} className="admin-checkbox" /><span className="text-sm text-[#2d382f]">{option.value === 168 ? "1 week before" : option.value === 24 ? "1 day before" : option.value === 48 ? "2 days before" : option.value === 72 ? "3 days before" : "12 hours before"}</span></label>)}</div><div className="grid gap-6 sm:grid-cols-2"><div className="flex flex-col gap-2"><label htmlFor="send-window-start" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">Earliest send time</label><input id="send-window-start" type="time" name="sendWindowStart" value={settings.sendWindowStart} onChange={handleInputChange} required className="admin-input w-full" /></div><div className="flex flex-col gap-2"><label htmlFor="send-window-end" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">Latest send time</label><input id="send-window-end" type="time" name="sendWindowEnd" value={settings.sendWindowEnd} onChange={handleInputChange} required className="admin-input w-full" /></div></div></fieldset></div></AdminCard>
      <AdminCard className="p-7"><div className="flex flex-col gap-5"><div><p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">Business time</p><h2 className="mt-3 font-serif text-3xl text-[#202620]">Business timezone</h2><p className="mt-3 text-sm leading-7 text-[#626b62]">This timezone is used for appointments and reminders.</p></div><label htmlFor="reminder-timezone" className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">Timezone</label><select id="reminder-timezone" name="timezone" value={settings.timezone} onChange={handleInputChange} className="admin-select w-full">{timezoneOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></AdminCard>
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#d9ded5] bg-white p-5 shadow-sm"><div><p className="text-sm font-semibold text-[#2b352d]">Save settings</p><p className="mt-1 text-xs text-[#727a73]">Changes apply to future reminders and appointment availability.</p></div><button type="submit" disabled={saving} className="admin-button">{saving ? "Saving..." : "Save Settings"}</button></div>
    </form>
  );

  return <div className="flex flex-col gap-10">{!embedded && <AdminHeader title="Settings" subtitle="Notifications & reminders" description="Manage the settings Amanda uses day to day." onLogout={handleLogout} />}{content}</div>;
}
