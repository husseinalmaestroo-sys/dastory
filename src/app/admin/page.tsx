import { isAdmin } from "@/lib/admin-auth";
import { AdminLogin } from "@/components/admin/AdminLogin";
import { AdminDashboard } from "@/components/admin/AdminDashboard";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  // Gate on the server: rendering the dashboard and hiding it with CSS would
  // ship the markup to anyone who asks for the page.
  if (!(await isAdmin())) return <AdminLogin />;
  return <AdminDashboard />;
}
