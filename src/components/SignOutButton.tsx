"use client";

export function SignOutButton() {
  return (
    <button
      type="button"
      className="btn-secondary"
      onClick={async () => {
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
        window.location.assign("/welcome");
      }}
    >
      Sign out
    </button>
  );
}
