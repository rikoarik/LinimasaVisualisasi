import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Journey Visualizer",
  description:
    "Cinematic 3D travel visualizations from GPS data — vehicles, terrain, buildings and camera work, exported to video.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
