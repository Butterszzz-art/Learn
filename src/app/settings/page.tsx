import { getAppSettings } from "@/lib/digest";
import { getAllInterests } from "@/lib/interests";
import { InterestPicker } from "@/components/InterestPicker";
import { FrequencyForm } from "@/components/FrequencyForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, interests] = await Promise.all([getAppSettings(), getAllInterests()]);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold">Settings</h1>

      <FrequencyForm initial={settings.frequency} />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          Interests
        </h2>
        <InterestPicker initial={interests} mode="settings" />
      </section>
    </div>
  );
}
