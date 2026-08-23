import { Suspense } from "react";
import { AuthForm } from "@/components/AuthForm";

export const metadata = { title: "会員登録" };
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <div className="container">
      <Suspense>
        <AuthForm mode="signup" />
      </Suspense>
    </div>
  );
}
