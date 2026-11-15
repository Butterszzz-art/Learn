import Link from "next/link";

export const metadata = { title: "Terms of Use" };

// DRAFT — written to describe what the app actually does with data today.
// Have a lawyer review this before a public launch, and fill in the
// operator name and contact address.
const SECTIONS: { h: string; p: string[] }[] = [
  {
    "h": "The service",
    "p": [
      "Neuron is a learning app. It provides AI-written educational content based on cited sources, quizzes, and tools to review what you've read."
    ]
  },
  {
    "h": "Not professional advice",
    "p": [
      "Content is for general education. It is not medical, psychological, legal or financial advice, and is not a substitute for a qualified professional. Do not change treatment, medication or training on the basis of something you read here.",
      "AI-generated content can be wrong or out of date. Check the linked sources before relying on anything important."
    ]
  },
  {
    "h": "Your account",
    "p": [
      "You must be 13 or older. Keep your password private; you are responsible for activity on your account. One person per account."
    ]
  },
  {
    "h": "Your uploads",
    "p": [
      "Only upload material you have the right to use for your own study. Library uploads are processed into private notes for you alone and are never added to the shared feed.",
      "You keep ownership of what you upload and write. You give us permission to process it to provide the service to you."
    ]
  },
  {
    "h": "Fair use",
    "p": [
      "Don't try to break, scrape or overload the service, get around usage limits, or use it to generate harmful content. We may suspend accounts that do."
    ]
  },
  {
    "h": "Paid plans",
    "p": [
      "If you subscribe to a paid plan, the price, billing period and how to cancel are shown at purchase. Purchases made through an app store are also subject to that store's terms."
    ]
  },
  {
    "h": "Changes and availability",
    "p": [
      "The service is provided as is. We may change or discontinue features, and will update these terms when we do; continuing to use Neuron after a change means you accept it."
    ]
  },
  {
    "h": "Contact",
    "p": [
      "[Add operator name and contact email before launch]."
    ]
  }
];

export default function Page() {
  return (
    <article className="pb-10">
      <Link href="/" className="text-sm font-bold text-neuron-accent">← Neuron</Link>
      <h1 className="page-title mt-4">Terms of Use</h1>
      <p className="mt-1 text-sm text-neuron-muted">Last updated 10 November 2026</p>
      {SECTIONS.map((s) => (
        <section key={s.h} className="mt-7">
          <h2 className="font-display text-xl font-bold">{s.h}</h2>
          {s.p.map((t, i) => (
            <p key={i} className="mt-2 leading-relaxed text-neuron-text/90">{t}</p>
          ))}
        </section>
      ))}
    </article>
  );
}
