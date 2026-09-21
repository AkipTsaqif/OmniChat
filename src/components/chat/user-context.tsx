"use client";

import * as React from "react";

export type SessionUser = {
  name: string;
  email: string;
  plan: string;
  initials: string;
  systemPrompt?: string | null;
};

export const UserContext = React.createContext<SessionUser>({
  name: "",
  email: "",
  plan: "",
  initials: "",
  systemPrompt: null,
});

export function useSessionUser() {
  return React.useContext(UserContext);
}
