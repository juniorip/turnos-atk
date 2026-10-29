import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sede: string }>;
}): Promise<Metadata> {
  const { sede } = await params;
  const branchCode = encodeURIComponent(sede.toUpperCase());

  return {
    manifest: `/registro/${branchCode}/manifest.webmanifest`,
  };
}

export default function RegistroLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return children;
}
