export const REMINDER_OPTIONS = [
  {
    value: 12,
    label: "12 hours before",
  },
  {
    value: 24,
    label: "24 hours before",
  },
  {
    value: 48,
    label: "48 hours before",
  },
  {
    value: 72,
    label: "72 hours before",
  },
  {
    value: 168,
    label: "1 week before",
  },
];

export function getReminderLabel(hours) {
  const matchingOption = REMINDER_OPTIONS.find(
    (option) => option.value === Number(hours),
  );

  return matchingOption?.label || `${hours} hours before`;
}