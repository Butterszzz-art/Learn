import { NextResponse } from "next/server";
import { apiUser, isResponse } from "@/lib/api";
import { drain } from "@/lib/engine/jobs";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Runs queued work for a short while, this person's requests first. Called
// (without awaiting the reply) while someone is waiting on an on-demand
// deep dive or a Library upload, so they aren't stuck until the next
// scheduled tick. Hobby-tier hosting cuts this at 60s; a job that is cut
// off is retried by the next kick or tick.
export async function POST() {
  const user = await apiUser();
  if (isResponse(user)) return user;
  const ran = await drain(45_000, user.id);
  return NextResponse.json({ ran });
}
