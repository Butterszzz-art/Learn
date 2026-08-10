import { getLibraryBooks } from "@/lib/digest";
import { BookUploadForm } from "@/components/BookUploadForm";
import { BookCard } from "@/components/BookCard";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const books = await getLibraryBooks();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Library</h1>
        <p className="mt-1 text-sm text-neuron-muted">
          Upload a book and get a detailed chapter-by-chapter notebook, drip-fed into your daily/weekly
          rhythm — one book-chapter card shows up in the main feed each cycle. The table of contents
          below always shows everything, so you can jump ahead or reread any time.
        </p>
      </div>

      <BookUploadForm />

      {books.length === 0 ? (
        <p className="text-sm text-neuron-muted">No books uploaded yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
