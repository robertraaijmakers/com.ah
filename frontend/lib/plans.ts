import { type FamilyMember } from "@/lib/api";


export const PLANS_KEY = "/plans/";

// Order Monday, delivery Tuesday night → cycle Wed–Tue.
// If today is Sun or Mon, planning is for the NEXT cycle (next Wednesday).
// Otherwise plan from this (most recent) Wednesday.
export function defaultStartDate(): string {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun,1=Mon,...,6=Sat
  let offset: number;
  if (dow === 0) offset = 3;          // Sun → +3 (next Wed)
  else if (dow === 1) offset = 2;     // Mon → +2 (next Wed)
  else if (dow === 2) offset = -6;    // Tue → last Wed (current cycle end)
  else offset = 3 - dow;             // Wed=0, Thu=-1, Fri=-2, Sat=-3
  const d = new Date(today);
  d.setDate(today.getDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function defaultPlanName(startIso: string): string {
  const start = new Date(startIso + "T12:00:00");
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmtShort = (d: Date) =>
    d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  return `Week ${fmtShort(start)} – ${fmtShort(end)}`;
}

export const WEEKDAYS_NL = ["zo", "ma", "di", "wo", "do", "vr", "za"];

export const TYPE_COLOR: Record<FamilyMember["member_type"], string> = {
  member: "primary",
  regular_guest: "info",
  generic_guest: "secondary",
};

export const TYPE_ORDER: Record<FamilyMember["member_type"], number> = {
  member: 0,
  regular_guest: 1,
  generic_guest: 2,
};

export function sortMembers(members: FamilyMember[]): FamilyMember[] {
  return [...members].sort((a, b) => TYPE_ORDER[a.member_type] - TYPE_ORDER[b.member_type] || a.name.localeCompare(b.name));
}

