import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AuthForm } from "@/components/auth/auth-form";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user) redirect("/");

  return <AuthForm mode="login" />;
}
