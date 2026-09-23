export function WorkspaceIcon({ name, size = 18 }: { name: "ads" | "brand" | "plus" | "chat" | "send"; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "ads") return <svg {...common}><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 7h8M8 11h8M8 15h5" /></svg>;
  if (name === "brand") return <svg {...common}><path d="M12 3 20 7v10l-8 4-8-4V7l8-4Z" /><path d="m4 7 8 4 8-4M12 11v10" /></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
  if (name === "chat") return <svg {...common}><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2v-6.5a7.5 7.5 0 1 1 17-3Z" /><path d="M8 11h8M8 14h5" /></svg>;
  return <svg {...common}><path d="m5 12 14-7-5 14-2.5-6.5L5 12Z" /><path d="m11.5 12.5 7.5-7.5" /></svg>;
}
