import { normalizePhone } from "#lib/phone";

export const EMED_DEMO_DEVICE_ID = "emed-monitor-demo-001";
export const EMED_DEMO_DEVICE_LABEL = "eMed Home Monitor";

export type EmedDeviceLink = {
  deviceId: string;
  label: string;
  status: "active";
  linkedAt: string;
};

export type EmedReading = {
  at: string;
  weightKg: number;
  glucoseMmolL: number;
  restingHrBpm: number;
  bpSystolicMmHg: number;
  bpDiastolicMmHg: number;
};

/** Demo WhatsApp phone that receives a one-time eMed seed into durable state. */
export function emedDemoPhone(): string | null {
  const raw = process.env.EMED_DEMO_PHONE?.trim();
  if (!raw) return null;
  return normalizePhone(raw) || null;
}

export function isEmedDemoPhone(phoneNumber: string): boolean {
  const demo = emedDemoPhone();
  if (!demo) return false;
  return normalizePhone(phoneNumber) === demo;
}

/** Fixed seed rows written once into patient state (not regenerated per tool call). */
export function buildEmedDemoSeed(linkedAt: string = new Date().toISOString()): {
  device: EmedDeviceLink;
  readings: EmedReading[];
} {
  const base = new Date(linkedAt);
  // Anchor to local calendar days ending today.
  const day = (offsetFromToday: number, hourUtc = 8) => {
    const d = new Date(base);
    d.setUTCHours(hourUtc, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - offsetFromToday);
    return d.toISOString();
  };

  const readings: EmedReading[] = [
    {
      at: day(6),
      weightKg: 94.2,
      glucoseMmolL: 6.8,
      restingHrBpm: 74,
      bpSystolicMmHg: 128,
      bpDiastolicMmHg: 82,
    },
    {
      at: day(5),
      weightKg: 93.9,
      glucoseMmolL: 6.6,
      restingHrBpm: 72,
      bpSystolicMmHg: 126,
      bpDiastolicMmHg: 80,
    },
    {
      at: day(4),
      weightKg: 93.7,
      glucoseMmolL: 6.5,
      restingHrBpm: 88,
      bpSystolicMmHg: 130,
      bpDiastolicMmHg: 84,
    },
    {
      at: day(3),
      weightKg: 93.4,
      glucoseMmolL: 6.3,
      restingHrBpm: 71,
      bpSystolicMmHg: 124,
      bpDiastolicMmHg: 79,
    },
    {
      at: day(2),
      weightKg: 93.1,
      glucoseMmolL: 6.2,
      restingHrBpm: 70,
      bpSystolicMmHg: 122,
      bpDiastolicMmHg: 78,
    },
    {
      at: day(1),
      weightKg: 92.9,
      glucoseMmolL: 6.1,
      restingHrBpm: 69,
      bpSystolicMmHg: 121,
      bpDiastolicMmHg: 77,
    },
    {
      at: day(0),
      weightKg: 92.6,
      glucoseMmolL: 5.9,
      restingHrBpm: 68,
      bpSystolicMmHg: 120,
      bpDiastolicMmHg: 76,
    },
  ];

  return {
    device: {
      deviceId: EMED_DEMO_DEVICE_ID,
      label: EMED_DEMO_DEVICE_LABEL,
      status: "active",
      linkedAt,
    },
    readings,
  };
}

export function latestEmedReading(readings: EmedReading[]): EmedReading | null {
  if (readings.length === 0) return null;
  return [...readings].sort((a, b) => a.at.localeCompare(b.at)).at(-1) ?? null;
}

export function emedReadingsLastDays(
  readings: EmedReading[],
  days: number,
  now: Date = new Date(),
): EmedReading[] {
  const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
  return readings
    .filter((r) => Date.parse(r.at) >= cutoff)
    .sort((a, b) => a.at.localeCompare(b.at));
}
