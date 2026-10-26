"use client";

import { useSyncExternalStore } from "react";
import { AcceptInvitationForm } from "./forms";

const subscribe = (callback: () => void) => {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
};
export function Join() {
  const token = useSyncExternalStore(
    subscribe,
    () => location.hash.slice(1),
    () => "",
  );
  return <AcceptInvitationForm token={/^[a-f0-9]{64}$/.test(token) ? token : ""} />;
}
