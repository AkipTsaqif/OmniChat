import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

// Edge-safe: authConfig has no database or node:crypto imports.
export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
