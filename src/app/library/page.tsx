import { requireUser } from "@/lib/auth";
import { getLibraryBooks } from "@/lib/content";
import { checkQuota } from "@/lib/plan";
import { hasClaudeKey } from "@/lib/ai";
import { BookCard } from "@/components/BookCard";
import { BookUploadForm } from "@/components/BookUploadForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

export default async function LibraryPage() {
  const user = await requireUser();
  const [books, quota] = await Promise.all([getLibraryBooks(user.id), checkQuota(user.id, user.plan, "libraryBook")]);
  return (
    <div>
      <h1 className="page-title">Library</h1>
      <p className="mb-6 mt-1 text-neuron-muted">Add a book or an article and get chapter-by-chapter notes, fed into your feed at the pace you choose. Private to you.</p>
      {hasClaudeKey() ? (
        <BookUploadForm canUpload={quota.ok} limitMessage={quota.message} />
      ) : (
        <p className="card text-sm text-neuron-muted">Library processing isn't configured on this server.</p>
      )}
      <h2 className="eyebrow mb-3 mt-8">Your books</h2>
      {books.length === 0 ? (
        <p className="text-neuron-muted">Nothing here yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">{books.map((b) => <li key={b.id}><BookCard book={b} /></li>)}</ul>
      )}
    </div>
  );
}
