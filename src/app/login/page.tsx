"use client";

/**
 * The passcode screen.
 *
 * Same palette and shapes as the rest of the tool — dark bar, white card on the
 * canvas, one teal button — so it reads as the front door of the same product
 * rather than a bolted-on gate.
 */
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { TopBar } from "@/components/TopBar";
import { Button, Card, StatusTag } from "@/components/ui";
import { describeTransportFailure } from "@/lib/uploadLimits";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const misconfigured = params.get("misconfigured") === "1";

  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error ?? "That's not the passcode.");
        setPasscode("");
        return;
      }
      router.replace(params.get("next") ?? "/");
      router.refresh();
    } catch (failure) {
      setError(describeTransportFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  if (misconfigured) {
    return (
      <Card className="w-full max-w-[420px] border-l-4 border-l-block p-8">
        <StatusTag tone="block" icon="!">
          Not set up yet
        </StatusTag>
        <p className="mt-3 text-[15px] text-ink">
          This app doesn&rsquo;t have a passcode set, so it isn&rsquo;t accepting
          anyone — including you.
        </p>
        <p className="mt-2 text-[14px] text-body">
          Whoever deployed it needs to set <code>APP_PASSCODE</code>. Locally
          that&rsquo;s a line in <code>.env.local</code>; on Vercel it&rsquo;s an
          environment variable in the project settings.
        </p>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-[420px] p-8">
      <h1 className="font-display text-[22px] font-bold text-ink">
        Enter the passcode
      </h1>
      <p className="mt-1 text-[15px] text-body">
        One shared passcode for the team. There are no accounts.
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="passcode" className="text-[14px] font-semibold text-ink">
          Passcode
        </label>
        <input
          id="passcode"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          className="mt-2 w-full rounded-[4px] border border-line bg-surface px-3 py-2.5 text-[15px]"
        />

        <Button
          type="submit"
          disabled={busy || passcode.length === 0}
          className="mt-4 w-full"
        >
          {busy ? "Checking…" : "Continue"}
        </Button>
      </form>

      {error && (
        <p className="mt-4 text-[14px] text-block" role="alert">
          {error}
        </p>
      )}

      <p className="mt-6 border-t border-line pt-4 text-[13px] text-body">
        Nothing you upload is stored. Files are read in memory and cleared when
        you refresh.
      </p>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <>
      <TopBar />
      <main className="flex flex-1 items-start justify-center px-6 py-16">
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </>
  );
}
