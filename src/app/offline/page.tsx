export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
      <p className="text-5xl" aria-hidden>📡</p>
      <h1 className="page-title mt-4">You're offline</h1>
      <p className="mt-2 max-w-sm text-neuron-muted">Cards you already loaded are still in your feed. New ones will arrive when you're back online.</p>
      <a href="/" className="btn-primary mt-6">Back to the feed</a>
    </div>
  );
}
