"use client";

import * as React from "react";

export type SessionUser = {
  name: string;
  email: string;
  plan: string;
  initials: string;
};

export const UserContext = React.createContext<SessionUser>({
  name: "",
  email: "",
  plan: "",
  initials: "",
});

export function useSessionUser() {
  return React.useContext(UserContext);
}
