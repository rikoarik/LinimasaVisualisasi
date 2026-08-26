"use client";

import dynamic from "next/dynamic";

const Editor = dynamic(() => import("@/components/Editor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-screen w-full items-center justify-center bg-[#0a0e17] text-sm text-slate-400">
      <span className="mr-3 inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-600 border-t-amber-400" />
      Loading Journey Visualizer…
    </div>
  ),
});

export default function Page() {
  return <Editor />;
}
