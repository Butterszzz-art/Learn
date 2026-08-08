import { getAllInterests } from "@/lib/interests";
import { InterestPicker } from "@/components/InterestPicker";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const interests = await getAllInterests();

  return (
    <div>
      <h1 className="mb-2 font-serif text-2xl">Welcome to Digest</h1>
      <p className="mb-6 max-w-2xl text-sm text-brain-muted">
        Pick whatever fields you want to follow, and for each one, how much background you already
        have. This only changes which concepts get assumed vs. explained — every deep dive is written
        at the same level of rigor, for a reader who's generally sharp, not talked down to.
      </p>
      <InterestPicker initial={interests} mode="onboarding" />
    </div>
  );
}
