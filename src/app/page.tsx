"use client";

import { Chat } from "@/components/Chat";
import { LawyerGate } from "@/components/LawyerGate";

export default function HomePage() {
  return <LawyerGate>{(_lawyer, logout) => <Chat onLogout={logout} />}</LawyerGate>;
}
