const TZ = 'Asia/Bangkok';

export const fmtTime = (iso: string) =>
  new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(new Date(iso));

export const fmtDay = (iso: string | Date) =>
  new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }).format(new Date(iso));

export const fmtDate = (iso: string | Date) =>
  new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit', timeZone: TZ }).format(new Date(iso));

export const fmtDateTime = (iso: string) => `${fmtDay(iso)} ${fmtTime(iso)}`;

export const fmtMoney = (n: number | string | null | undefined) =>
  `฿${Number(n ?? 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

export const weekdayShort = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

/** YYYY-MM-DD for a date in Bangkok time. */
export function localDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Start of a Bangkok-local day as a Date (UTC instant). */
export function dayStart(ymd: string): Date {
  return new Date(`${ymd}T00:00:00+07:00`);
}

export function addDays(ymd: string, n: number): string {
  const d = dayStart(ymd);
  d.setUTCDate(d.getUTCDate() + n);
  return localDate(d);
}

/** "อีก 2 ชม." style hint for how far away a time is. */
export function fromNow(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60000);
  if (mins < 0) return 'ผ่านไปแล้ว';
  if (mins < 60) return `อีก ${mins} นาที`;
  if (mins < 60 * 24) return `อีก ${Math.round(mins / 60)} ชม.`;
  return `อีก ${Math.round(mins / 1440)} วัน`;
}
