import { getAppSettings } from "@/lib/digest";
import { getAllInterests } from "@/lib/interests";
import { InterestPicker } from "@/components/InterestPicker";
import { BrainGamesToggle } from "@/components/BrainGamesToggle";
import { SyllabusManager } from "@/components/SyllabusManager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, allInterests] = await Promise.all([getAppSettings(), getAllInterests()]);
  // Library books get a hidden pseudo-interest (see getOrCreateLibraryInterest)
  // purely for spaced-resurfacing plumbing — never shown as a pickable interest.
  const interests = allInterests.filter((i) => !i.isLibraryBook);

  return (
    <div className="space-y-8">
      <h1 className="font-display text-2xl font-bold">Settings</h1>

      <div className="card">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          Neuron cycle
        </h2>
        <p className="text-sm text-neuron-text/90">
          Headlines refresh daily; Deep Dives, Applied Insights, Drills, Mental Model, Rabbit Hole,
          Library chapters, and Brain Games consolidate into one weekly bundle — "This Week in
          [Interest]" — instead of regenerating every day. This keeps API usage down without losing
          any content type; nothing to configure here.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          Interests
        </h2>
        <InterestPicker initial={interests} mode="settings" />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-neuron-muted">
          Course syllabi
        </h2>
        <p className="mb-3 text-sm text-neuron-text/90">
          Attach a course syllabus or reading list to an interest — a given interest can have several
          (multiple courses within one major). Deep Dives then lean toward genuine gaps in your
          coursework, and feed items get labeled when they're not on the syllabus, or when they update
          something the syllabus assigned an older reading on.
        </p>
        <SyllabusManager interests={interests.filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name }))} />
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
        <div className="card space-y-3">
          <div>
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
          <div className="border-t border-neuron-border pt-3">
            <p className="mb-3 text-sm text-neuron-text/90">
              Export this week's News sources as one citation file, ready to drop straight into Zotero
              or Mendeley.
            </p>
            <div className="flex flex-wrap gap-3">
              <a href="/api/cite/week?format=bib" className="btn-secondary inline-block text-sm">
                ⬇ Export this week's sources (BibTeX)
              </a>
              <a href="/api/cite/week?format=ris" className="btn-secondary inline-block text-sm">
                ⬇ Export this week's sources (RIS)
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
