export const MAX_SERVICE_PRICE_AMOUNT = 100000000;

export function parseServicePriceAmount(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value.trim())) return null;

  const [dollars, fraction = ""] = value.trim().split(".");
  const cents = Number(dollars) * 100 + Number(fraction.padEnd(2, "0"));

  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_SERVICE_PRICE_AMOUNT ? cents : null;
}
