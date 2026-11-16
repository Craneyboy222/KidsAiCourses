/** Small readers for `FormData`, so actions never have to deal with `File | string | null`. */

export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

/** As typed: passwords are never trimmed. */
export function raw(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export function ticked(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return value === "on" || value === "true" || value === "1" || value === "yes";
}

/** A whole number from a select, or NaN when nothing was chosen. */
export function wholeNumber(formData: FormData, name: string): number {
  const value = text(formData, name);
  return /^\d{1,4}$/.test(value) ? Number(value) : Number.NaN;
}

/** The month and year posted by `<MonthYearPicker name="birth" />`. */
export function birthFrom(formData: FormData): { birthMonth: number; birthYear: number } {
  return { birthMonth: wholeNumber(formData, "birthMonth"), birthYear: wholeNumber(formData, "birthYear") };
}

/** Consent ticks posted as `consent.<key>`, for the keys the form showed (listed in `consentKeys`). */
export function consentChoices(formData: FormData): Record<string, boolean> {
  const keys = text(formData, "consentKeys").split(",").map((key) => key.trim()).filter((key) => /^[a-z][a-z0-9_]{2,63}$/.test(key));
  return Object.fromEntries(keys.map((key) => [key, ticked(formData, `consent.${key}`)]));
}
