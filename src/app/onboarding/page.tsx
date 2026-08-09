import { getAllInterests } from "@/lib/interests";
import { InterestPicker } from "@/components/InterestPicker";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const interests = await getAllInterests();

  return (
    <div>
      <h1 className="mb-2 font-display text-2xl font-bold">Welcome to Neuron</h1>
      <p className="mb-6 max-w-2xl text-sm text-neuron-muted">
        Pick whatever fields you want to follow — the list below is a starting point, not a ceiling;
        add any topic of your own at the bottom. For each one, set how much background you already
        have, up to research level. This only changes which concepts get assumed vs. explained — every
        deep dive is written at the same level of rigor, for a reader who's generally sharp, not
        talked down to. Levels below research level have no fixed ceiling either — sustained daily use
        gradually escalates each interest's depth over time.
      </p>
      <InterestPicker initial={interests} mode="onboarding" />
    </div>
  );
}
