import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the auth config. Contains no database or node:crypto
 * imports so it can run inside middleware; the Credentials provider and its
 * scrypt verification live in src/auth.ts (Node runtime only).
 */
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  providers: [],
  callbacks: {
    authorized({ auth, request }) {
      const signedIn = !!auth?.user;
      const { pathname } = request.nextUrl;
      const isAuthPage = pathname === "/login" || pathname === "/signup";

      if (isAuthPage) {
        if (signedIn) {
          return Response.redirect(new URL("/", request.nextUrl));
        }
        return true;
      }

      return signedIn;
    },
    jwt({ token, user }) {
      if (user) token.id = user.id;
      return token;
    },
    session({ session, token }) {
      if (token.id) session.user.id = String(token.id);
      return session;
    },
  },
} satisfies NextAuthConfig;
