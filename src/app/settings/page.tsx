import { getAppSettings } from "@/lib/digest";
import { getAllInterests } from "@/lib/interests";
import { InterestPicker } from "@/components/InterestPicker";
import { FrequencyForm } from "@/components/FrequencyForm";
import { BrainGamesToggle } from "@/components/BrainGamesToggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, allInterests] = await Promise.all([getAppSettings(), getAllInterests()]);
  // Library books get a hidden pseudo-interest (see getOrCreateLibraryInterest)
  // purely for spaced-resurfacing plumbing — never shown as a pickable interest.
  const interests = allInterests.filter((i) => !i.isLibraryBook);

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

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          For fun
        </h2>
        <BrainGamesToggle initial={settings.includeBrainGames} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          Your data
        </h2>
        <div className="card">
          <p className="mb-3 text-sm text-neuron-text/90">
            Export every Deep Dive and Library chapter you've generated as a zip of markdown files,
            organized by interest/book and date — drop it straight into a notes app like Obsidian as
            a folder. Notes that share a topic or key concept get linked to each other with
            <code className="mx-1 rounded bg-neuron-surface2 px-1">[[wiki-links]]</code>
            where practical.
          </p>
          <a href="/api/export/all" className="btn-secondary inline-block text-sm">
            ⬇ Export everything
          </a>
        </div>
      </section>
    </div>
  );
}
