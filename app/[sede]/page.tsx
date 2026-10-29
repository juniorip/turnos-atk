import { notFound, redirect } from "next/navigation";

const shortcuts: Record<string, string> = {
  lin: "LIN",
  lince: "LIN",
  centro: "LIN",
  cen: "LIN",
  sjm: "SUR",
  san: "SUR",
  sur: "SUR",
  olivos: "NOR",
  los: "NOR",
  norte: "NOR",
};

export default async function BranchShortcut({
  params,
}: {
  params: Promise<{ sede: string }>;
}) {
  const { sede } = await params;
  const code = shortcuts[sede.trim().toLowerCase()];
  if (!code) notFound();
  redirect(`/registro/${code}`);
}
