import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/interests";
import { PLAN_LIMITS } from "@/lib/plan";
import { InterestPicker } from "@/components/InterestPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pick your interests" };

export default async function OnboardingPage() {
  const user = await requireUser({ allowNotOnboarded: true });
  if (user.onboarded) redirect("/");
  const catalog = await getCatalog(user.id);
  return (
    <div>
      <p className="eyebrow">Step 1 of 1</p>
      <h1 className="page-title mt-1">What do you want to know more about?</h1>
      <p className="mb-6 mt-2 text-neuron-muted">
        Pick at least three, and say roughly where you're starting from in each. You can change any of this later.
      </p>
      <InterestPicker initial={catalog} mode="onboarding" allowResearchLevel={PLAN_LIMITS[user.plan].researchLevel} />
    </div>
  );
}
