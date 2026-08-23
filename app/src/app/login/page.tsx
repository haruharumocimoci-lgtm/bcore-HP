import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "ログイン" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <div className="container">
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </div>
  );
}
