import { LoginForm } from "@/components/staff/login-form";

export const metadata = { title: "Staff sign in" };

export default function StaffLoginPage() {
  return (
    <main className="mx-auto w-full max-w-sm flex-1 px-4 py-12">
      <h1 className="text-2xl font-bold">Staff sign in</h1>
      <p className="mt-1 text-sm text-muted-foreground">For club owners, managers and door staff.</p>
      <LoginForm />
    </main>
  );
}
