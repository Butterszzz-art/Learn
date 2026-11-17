import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCatalog } from "@/lib/interests";
import { PLAN_LIMITS } from "@/lib/plan";
import { pushEnabled } from "@/lib/push";
import { isNativeAppRequest } from "@/lib/nativeApp";
import { InterestPicker } from "@/components/InterestPicker";
import { PrefsForm } from "@/components/PrefsForm";
import { DeleteAccount } from "@/components/DeleteAccount";
import { SignOutButton } from "@/components/SignOutButton";
import { SyllabusManager } from "@/components/SyllabusManager";
import { MuteNotices } from "@/components/MuteNotices";
import { getAllMutes } from "@/lib/mutes";
import { hasClaudeKey } from "@/lib/ai";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const user = await requireUser();
  const catalog = await getCatalog(user.id);
  const limits = PLAN_LIMITS[user.plan];
  const mutes = await getAllMutes(user.id);
  const followed = catalog.filter((i) => i.enabled).map((i) => ({ id: i.id, name: i.name }));
  return (
    <div>
      <Link href="/me" className="text-sm font-bold text-neuron-accent">← Me</Link>
      <h1 className="page-title mt-4">Settings</h1>

      <section className="mt-8" aria-labelledby="prefs-heading">
        <h2 id="prefs-heading" className="mb-4 font-display text-xl font-bold">Preferences</h2>
        <div className="card"><PrefsForm initial={user.prefs} pushAvailable={pushEnabled() && !isNativeAppRequest()} /></div>
      </section>

      <section className="mt-10 scroll-mt-6" id="interests" aria-labelledby="interests-heading">
        <h2 id="interests-heading" className="font-display text-xl font-bold">Interests</h2>
        <p className="mb-4 mt-1 text-sm text-neuron-muted">Changing a level moves you to that level's path; what you've already learned stays on your map.</p>
        <InterestPicker initial={catalog} mode="settings" allowResearchLevel={limits.researchLevel} />
      </section>

      <section className="mt-10" aria-labelledby="hidden-heading">
        <h2 id="hidden-heading" className="font-display text-xl font-bold">Hidden card types</h2>
        <p className="mb-4 mt-1 text-sm text-neuron-muted">When you keep skipping one kind of card in a field, the feed stops showing it there.</p>
        <MuteNotices initial={mutes} />
      </section>

      <section className="mt-10" aria-labelledby="syllabus-heading">
        <h2 id="syllabus-heading" className="font-display text-xl font-bold">Course syllabi</h2>
        <p className="mb-4 mt-1 text-sm text-neuron-muted">
          Paste a syllabus or reading list and entries will tell you when a topic isn't on it, or when they cover newer work than your assigned reading. Private to you. Up to {limits.syllabi} on your plan.
        </p>
        {hasClaudeKey() ? <SyllabusManager interests={followed} /> : <p className="card text-sm text-neuron-muted">Syllabus parsing isn't configured on this server.</p>}
      </section>

      <section className="mt-10" aria-labelledby="data-heading">
        <h2 id="data-heading" className="mb-3 font-display text-xl font-bold">Your data</h2>
        <div className="card space-y-3">
          {limits.exportAll ? (
            <a href="/api/export/all" className="btn-secondary">Export everything (zip of Markdown notes)</a>
          ) : (
            <p className="text-sm text-neuron-muted">Any entry can be exported from its own page. Exporting everything at once is part of <Link href="/upgrade" className="font-bold text-neuron-accent">Neuron Pro</Link>.</p>
          )}
          <p className="text-sm">
            <span className="text-neuron-muted">Citations for the research you were shown this week: </span>
            <a href="/api/cite/week?format=bib" className="font-bold text-neuron-accent">BibTeX</a>{" · "}
            <a href="/api/cite/week?format=ris" className="font-bold text-neuron-accent">RIS</a>
          </p>
          <p className="text-sm text-neuron-muted">
            <Link href="/privacy" className="font-bold text-neuron-accent">Privacy Policy</Link> · <Link href="/terms" className="font-bold text-neuron-accent">Terms</Link>
          </p>
        </div>
      </section>

      <section className="mt-10" aria-labelledby="account-heading">
        <h2 id="account-heading" className="mb-3 font-display text-xl font-bold">Account</h2>
        <p className="mb-3 text-sm text-neuron-muted">Signed in as {user.email}</p>
        <div className="flex flex-wrap items-start gap-3"><SignOutButton /><DeleteAccount /></div>
      </section>
    </div>
  );
}
