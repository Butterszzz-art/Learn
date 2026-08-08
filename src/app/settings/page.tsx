import { getAppSettings } from "@/lib/digest";
import { SettingsForm } from "@/components/SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = await getAppSettings();
  return (
    <div>
      <h1 className="mb-6 font-serif text-2xl">Settings</h1>
      <SettingsForm initial={settings} />
    </div>
  );
}
