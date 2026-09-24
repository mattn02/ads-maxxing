"use client";
import type { Brief, Session } from "@/lib/workflow/session-types";
import { BriefEditor as WorkspaceBriefEditor } from "@/components/workspace/ads";
export function BriefEditor({ session, busy, action }: { brief: Brief; session: Session; busy: boolean; action: (body: unknown) => Promise<void>; generate: () => void }) {
  return <WorkspaceBriefEditor session={session} busy={busy} action={async body => { await action(body); return true; }} />;
}
