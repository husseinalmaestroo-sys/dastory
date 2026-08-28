import { getLawyer } from "@/lib/lawyer-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lets the client check, on load, whether a lawyer is already signed in. */
export async function GET() {
  const lawyer = await getLawyer();
  return Response.json({ lawyer });
}
