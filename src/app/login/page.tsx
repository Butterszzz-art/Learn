import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { AuthForm } from "@/components/AuthForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function Page() {
  if (await getCurrentUser()) redirect("/");
  return <AuthForm mode="login" />;
}
