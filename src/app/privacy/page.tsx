import Link from "next/link";

export const metadata = { title: "Privacy Policy" };

// DRAFT — written to describe what the app actually does with data today.
// Have a lawyer review this before a public launch, and fill in the
// operator name and contact address.
const SECTIONS: { h: string; p: string[] }[] = [
  {
    "h": "What we collect",
    "p": [
      "Account: your email address and a salted hash of your password. We never store the password itself.",
      "Learning activity: which cards you were shown, how long each was on screen, what you saved, shared or skipped, your quiz answers, and the review schedule built from them. This is what personalises your feed and powers your knowledge map.",
      "Things you write: explain-it-back responses, questions you ask about a card, and reports you send.",
      "Library: files and links you upload. A file is kept only while it is being processed into chapter notes and is deleted from our database once that finishes; the notes stay private to your account.",
      "Technical: a session cookie that keeps you signed in, and error reports from the app."
    ]
  },
  {
    "h": "How we use it",
    "p": [
      "To run the service: choosing what to show you, scheduling reviews, and showing your progress.",
      "To improve it: counting, in aggregate, which cards people finish or skip, and which get reported.",
      "We do not sell your data and we do not show advertising."
    ]
  },
  {
    "h": "AI processing",
    "p": [
      "Feed content is written by an AI model (Anthropic's Claude) from cited sources and then checked automatically; it can still contain mistakes, which is why every card has a report button.",
      "When you ask a question, submit an explain-it-back, or upload to the Library, that text or file is sent to Anthropic's API to produce the response. It is not used by us to train models."
    ]
  },
  {
    "h": "What other people can see",
    "p": [
      "Nothing about you. Your activity, answers, uploads and writing are private to your account. Feed cards themselves are shared content and are the same for everyone at the same level.",
      "If you share a card, the link shows that card only — not who shared it."
    ]
  },
  {
    "h": "Keeping and deleting",
    "p": [
      "You can export your notes from Settings, and delete your account from Settings at any time. Deleting removes your account, activity, answers, writing and Library content immediately. Anonymous cost records (with no link to you) are kept for accounting."
    ]
  },
  {
    "h": "Children",
    "p": [
      "Neuron is not directed at children under 13, and you must be 13 or older to create an account."
    ]
  },
  {
    "h": "Contact",
    "p": [
      "Questions or requests about your data: [add contact email before launch]."
    ]
  }
];

export default function Page() {
  return (
    <article className="pb-10">
      <Link href="/" className="text-sm font-bold text-neuron-accent">← Neuron</Link>
      <h1 className="page-title mt-4">Privacy Policy</h1>
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
