import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import AdminHeader from "../../components/admin/AdminHeader";
import AdminCard from "../../components/admin/AdminCard";

import { useAdminAuth } from "../../contexts/AdminAuthContext";
import { useToast } from "../../contexts/ToastContext";
import { useConfirm } from "../../contexts/ConfirmContext";

import {
  getEmailSettings,
  updateEmailSettings,
} from "../../services/adminService";

import {
  getReminderLabel,
  REMINDER_OPTIONS,
} from "../../constants/reminderOptions";

const timezoneOptions = [
  {
    value: "America/New_York",
    label: "Eastern Time — New York",
  },
  {
    value: "America/Chicago",
    label: "Central Time — Chicago",
  },
  {
    value: "America/Denver",
    label: "Mountain Time — Denver",
  },
  {
    value: "America/Phoenix",
    label: "Mountain Time — Arizona",
  },
  {
    value: "America/Los_Angeles",
    label: "Pacific Time — Los Angeles",
  },
  {
    value: "America/Anchorage",
    label: "Alaska Time",
  },
  {
    value: "Pacific/Honolulu",
    label: "Hawaii Time",
  },
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

function formatTimeValue(value) {
  if (!value) {
    return "";
  }

  return String(value).slice(0, 5);
}

function sortReminderHours(values) {
  return [...values]
    .map(Number)
    .filter(Number.isFinite)
    .sort((first, second) => second - first);
}

export default function AdminEmailSettings() {
  const [settings, setSettings] = useState(initialSettings);

  const [newReminderHours, setNewReminderHours] = useState("");

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const navigate = useNavigate();

  const { logout } = useAdminAuth();

  const toast = useToast();

  const confirm = useConfirm();

  useEffect(() => {
    loadSettings();
  }, []);

  const availableReminderOptions = useMemo(() => {
    return REMINDER_OPTIONS.filter(
      (option) =>
        !settings.bookingReminderHoursList.includes(option.value),
    );
  }, [settings.bookingReminderHoursList]);

  useEffect(() => {
    if (availableReminderOptions.length === 0) {
      setNewReminderHours("");

      return;
    }

    const currentSelectionIsAvailable = availableReminderOptions.some(
      (option) => String(option.value) === String(newReminderHours),
    );

    if (!currentSelectionIsAvailable) {
      setNewReminderHours(String(availableReminderOptions[0].value));
    }
  }, [availableReminderOptions, newReminderHours]);

  async function loadSettings() {
    try {
      setLoading(true);

      const data = await getEmailSettings();

      setSettings({
        adminNotificationEmail: data.admin_notification_email || "",
        bookingRemindersEnabled: data.booking_reminders_enabled,
        bookingReminderHoursList: sortReminderHours(
          data.booking_reminder_hours_list || [24],
        ),
        sendAdminReminders: data.send_admin_reminders,
        sendWindowStart: formatTimeValue(data.send_window_start),
        sendWindowEnd: formatTimeValue(data.send_window_end),
        timezone: data.timezone,
        confirmedBookingsOnly: data.confirmed_bookings_only,
        sendForUnpaid: data.send_for_unpaid,
        sendForPartPaid: data.send_for_part_paid,
        sendForPaid: data.send_for_paid,
      });
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to load email settings");
    } finally {
      setLoading(false);
    }
  }

  function handleInputChange(event) {
    const { name, type, checked, value } = event.target;

    setSettings((previousSettings) => ({
      ...previousSettings,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  function handleAddReminder() {
    const reminderHours = Number(newReminderHours);

    if (!Number.isFinite(reminderHours)) {
      toast.error("Select a valid reminder timing");

      return;
    }

    if (settings.bookingReminderHoursList.includes(reminderHours)) {
      toast.error("That reminder timing has already been added");

      return;
    }

    setSettings((previousSettings) => ({
      ...previousSettings,
      bookingReminderHoursList: sortReminderHours([
        ...previousSettings.bookingReminderHoursList,
        reminderHours,
      ]),
    }));
  }

  function handleRemoveReminder(reminderHours) {
    if (settings.bookingReminderHoursList.length === 1) {
      toast.error("At least one reminder timing must remain");

      return;
    }

    setSettings((previousSettings) => ({
      ...previousSettings,
      bookingReminderHoursList:
        previousSettings.bookingReminderHoursList.filter(
          (value) => value !== reminderHours,
        ),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (settings.bookingReminderHoursList.length === 0) {
      toast.error("At least one reminder timing is required");

      return;
    }

    if (settings.sendWindowEnd <= settings.sendWindowStart) {
      toast.error(
        "The end of the sending window must be later than the start",
      );

      return;
    }

    try {
      setSaving(true);

      const data = await updateEmailSettings({
        adminNotificationEmail: settings.adminNotificationEmail,
        bookingRemindersEnabled: settings.bookingRemindersEnabled,
        bookingReminderHoursList: sortReminderHours(
          settings.bookingReminderHoursList,
        ),
        sendAdminReminders: settings.sendAdminReminders,
        sendWindowStart: settings.sendWindowStart,
        sendWindowEnd: settings.sendWindowEnd,
        timezone: settings.timezone,
        confirmedBookingsOnly: settings.confirmedBookingsOnly,
        sendForUnpaid: settings.sendForUnpaid,
        sendForPartPaid: settings.sendForPartPaid,
        sendForPaid: settings.sendForPaid,
      });

      setSettings({
        adminNotificationEmail: data.admin_notification_email || "",
        bookingRemindersEnabled: data.booking_reminders_enabled,
        bookingReminderHoursList: sortReminderHours(
          data.booking_reminder_hours_list,
        ),
        sendAdminReminders: data.send_admin_reminders,
        sendWindowStart: formatTimeValue(data.send_window_start),
        sendWindowEnd: formatTimeValue(data.send_window_end),
        timezone: data.timezone,
        confirmedBookingsOnly: data.confirmed_bookings_only,
        sendForUnpaid: data.send_for_unpaid,
        sendForPartPaid: data.send_for_part_paid,
        sendForPaid: data.send_for_paid,
      });

      toast.success("Email settings updated successfully");
    } catch (error) {
      console.error(error);

      toast.error(error.message || "Failed to update email settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleLogout() {
    const confirmed = await confirm({
      title: "Logout",
      message: "Are you sure you want to logout?",
      confirmText: "Logout",
    });

    if (!confirmed) {
      return;
    }

    try {
      await logout();

      navigate("/");

      toast.success("Logged out successfully");
    } catch (error) {
      console.error(error);

      toast.error("Failed to logout");
    }
  }

  return (
    <div className="flex flex-col gap-10">
      <AdminHeader
        title="Email Settings"
        subtitle="System Configuration"
        description="Control when booking reminders are sent and which customers should receive them."
        onLogout={handleLogout}
      />

      <button
        type="button"
        onClick={() => navigate("/admin/settings")}
        className="flex w-fit items-center gap-2 text-sm font-medium text-[#536458] transition hover:text-[#2f4835]"
      >
        <span aria-hidden="true">←</span>

        <span>Back to Settings</span>
      </button>

      {loading ? (
        <AdminCard className="p-8">
          <p className="text-sm text-[#687068]">
            Loading email settings...
          </p>
        </AdminCard>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <AdminCard className="p-7">
            <div className="flex flex-col gap-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">
                  Admin Notifications
                </p>

                <h2 className="mt-3 font-serif text-3xl text-[#202620]">
                  Booking notification recipient
                </h2>

                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#626b62]">
                  New booking notifications and enabled admin reminders will
                  be sent to this address.
                </p>
              </div>

              <div className="flex max-w-2xl flex-col gap-2">
                <label
                  htmlFor="admin-notification-email"
                  className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                >
                  Admin notification email
                </label>

                <input
                  id="admin-notification-email"
                  type="email"
                  name="adminNotificationEmail"
                  value={settings.adminNotificationEmail}
                  onChange={handleInputChange}
                  autoComplete="email"
                  maxLength="254"
                  required
                  className="admin-input w-full"
                />

                <p className="text-xs leading-5 text-[#7a837b]">
                  This does not change the sender or reply-to address used by
                  the email service.
                </p>
              </div>
            </div>
          </AdminCard>

          <AdminCard className="p-7">
            <div className="flex flex-col gap-7">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="max-w-2xl">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">
                    Booking Reminders
                  </p>

                  <h2 className="mt-3 font-serif text-3xl text-[#202620]">
                    Automatic reminder emails
                  </h2>

                  <p className="mt-3 text-sm leading-7 text-[#626b62]">
                    Send customers one or more reminders before their
                    appointment. Reminders are processed during the permitted
                    sending hours configured below.
                  </p>
                </div>

                <label className="flex cursor-pointer items-center gap-3 rounded-full border border-[#d8ddd4] bg-[#f7f8f4] px-4 py-3">
                  <input
                    type="checkbox"
                    name="bookingRemindersEnabled"
                    checked={settings.bookingRemindersEnabled}
                    onChange={handleInputChange}
                    className="admin-checkbox"
                  />

                  <span className="text-sm font-medium text-[#334036]">
                    {settings.bookingRemindersEnabled
                      ? "Reminders enabled"
                      : "Reminders disabled"}
                  </span>
                </label>
              </div>

              <div className="h-px bg-[#e0e4dc]" />

              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]">
                    Reminder schedule
                  </p>

                  <p className="mt-2 text-xs leading-5 text-[#7a837b]">
                    Each configured reminder will be sent once before the
                    appointment.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
                  {settings.bookingReminderHoursList.map((reminderHours) => (
                    <div
                      key={reminderHours}
                      className="flex flex-col gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div>
                        <p className="text-sm font-semibold text-[#2d382f]">
                          {getReminderLabel(reminderHours)}
                        </p>

                        <p className="mt-1 text-xs text-[#727b73]">
                          Reminder interval: {reminderHours} hours
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveReminder(reminderHours)}
                        disabled={
                          !settings.bookingRemindersEnabled ||
                          settings.bookingReminderHoursList.length === 1
                        }
                        className="w-fit rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {availableReminderOptions.length > 0 && (
                  <div className="grid gap-3 rounded-2xl border border-dashed border-[#cfd7cd] bg-[#f7f9f5] p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <div className="flex flex-col gap-2">
                      <label
                        htmlFor="new-reminder-hours"
                        className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                      >
                        Add another reminder
                      </label>

                      <select
                        id="new-reminder-hours"
                        value={newReminderHours}
                        onChange={(event) =>
                          setNewReminderHours(event.target.value)
                        }
                        disabled={!settings.bookingRemindersEnabled}
                        className="admin-select w-full"
                      >
                        {availableReminderOptions.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={handleAddReminder}
                      disabled={
                        !settings.bookingRemindersEnabled ||
                        !newReminderHours
                      }
                      className="admin-button"
                    >
                      Add Reminder
                    </button>
                  </div>
                )}
              </div>

              <div className="h-px bg-[#e0e4dc]" />

              <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5">
                <input
                  type="checkbox"
                  name="sendAdminReminders"
                  checked={settings.sendAdminReminders}
                  onChange={handleInputChange}
                  disabled={!settings.bookingRemindersEnabled}
                  className="admin-checkbox mt-1"
                />

                <span>
                  <span className="block text-sm font-semibold text-[#2d382f]">
                    Send Amanda the same reminders
                  </span>

                  <span className="mt-1 block text-xs leading-5 text-[#727b73]">
                    Amanda will receive an admin reminder at the same time as
                    each customer reminder.
                  </span>
                </span>
              </label>

              <div className="grid gap-6 lg:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="reminder-timezone"
                    className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                  >
                    Business time zone
                  </label>

                  <select
                    id="reminder-timezone"
                    name="timezone"
                    value={settings.timezone}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    className="admin-select w-full"
                  >
                    {timezoneOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>

                  <p className="text-xs leading-5 text-[#7a837b]">
                    Reminder timings and sending hours use this time zone.
                  </p>
                </div>
              </div>
            </div>
          </AdminCard>

          <AdminCard className="p-7">
            <div className="flex flex-col gap-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">
                  Sending Window
                </p>

                <h2 className="mt-3 font-serif text-3xl text-[#202620]">
                  Normal sending hours
                </h2>

                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#626b62]">
                  If a reminder becomes due outside this window, it will wait
                  until the next permitted sending time.
                </p>
              </div>

              <div className="grid gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="send-window-start"
                    className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                  >
                    Earliest send time
                  </label>

                  <input
                    id="send-window-start"
                    type="time"
                    name="sendWindowStart"
                    value={settings.sendWindowStart}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    required
                    className="admin-input w-full"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <label
                    htmlFor="send-window-end"
                    className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#667166]"
                  >
                    Latest send time
                  </label>

                  <input
                    id="send-window-end"
                    type="time"
                    name="sendWindowEnd"
                    value={settings.sendWindowEnd}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    required
                    className="admin-input w-full"
                  />
                </div>
              </div>

              <div className="rounded-2xl border border-[#dce2d9] bg-[#f6f8f3] p-5">
                <p className="text-sm leading-7 text-[#566258]">
                  Reminders will currently be allowed between{" "}
                  <strong className="text-[#2d392f]">
                    {settings.sendWindowStart}
                  </strong>{" "}
                  and{" "}
                  <strong className="text-[#2d392f]">
                    {settings.sendWindowEnd}
                  </strong>{" "}
                  in the{" "}
                  <strong className="text-[#2d392f]">
                    {settings.timezone}
                  </strong>{" "}
                  time zone.
                </p>
              </div>
            </div>
          </AdminCard>

          <AdminCard className="p-7">
            <div className="flex flex-col gap-7">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#6a766a]">
                  Eligibility
                </p>

                <h2 className="mt-3 font-serif text-3xl text-[#202620]">
                  Which bookings receive reminders
                </h2>

                <p className="mt-3 max-w-2xl text-sm leading-7 text-[#626b62]">
                  Control which booking and payment states are included when
                  reminders are generated.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5">
                  <input
                    type="checkbox"
                    name="confirmedBookingsOnly"
                    checked={settings.confirmedBookingsOnly}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    className="admin-checkbox mt-1"
                  />

                  <span>
                    <span className="block text-sm font-semibold text-[#2d382f]">
                      Confirmed bookings only
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-[#727b73]">
                      Exclude bookings that are still awaiting confirmation.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5">
                  <input
                    type="checkbox"
                    name="sendForUnpaid"
                    checked={settings.sendForUnpaid}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    className="admin-checkbox mt-1"
                  />

                  <span>
                    <span className="block text-sm font-semibold text-[#2d382f]">
                      Unpaid bookings
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-[#727b73]">
                      Send reminders when no payment has been recorded.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5">
                  <input
                    type="checkbox"
                    name="sendForPartPaid"
                    checked={settings.sendForPartPaid}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    className="admin-checkbox mt-1"
                  />

                  <span>
                    <span className="block text-sm font-semibold text-[#2d382f]">
                      Part-paid bookings
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-[#727b73]">
                      Include bookings with a deposit or partial payment.
                    </span>
                  </span>
                </label>

                <label className="flex cursor-pointer items-start gap-4 rounded-2xl border border-[#dce1d8] bg-[#fafbf8] p-5">
                  <input
                    type="checkbox"
                    name="sendForPaid"
                    checked={settings.sendForPaid}
                    onChange={handleInputChange}
                    disabled={!settings.bookingRemindersEnabled}
                    className="admin-checkbox mt-1"
                  />

                  <span>
                    <span className="block text-sm font-semibold text-[#2d382f]">
                      Fully paid bookings
                    </span>

                    <span className="mt-1 block text-xs leading-5 text-[#727b73]">
                      Send appointment reminders after payment is complete.
                    </span>
                  </span>
                </label>
              </div>
            </div>
          </AdminCard>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#d9ded5] bg-white p-5 shadow-sm">
            <div>
              <p className="text-sm font-semibold text-[#2b352d]">
                Save email settings
              </p>

              <p className="mt-1 text-xs text-[#727a73]">
                These settings will be used by the reminder scheduler.
              </p>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="admin-button"
            >
              {saving ? "Saving..." : "Save Email Settings"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
