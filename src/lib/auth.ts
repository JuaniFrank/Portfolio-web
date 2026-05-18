import bcrypt from "bcrypt";
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import type { CostMethod } from "@/lib/generated/prisma";
import type { RegisterInput } from "@/lib/validations/auth";
import { loginSchema } from "@/lib/validations/auth";
import { prisma } from "@/lib/prisma";

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const parsed = loginSchema.safeParse({
          email: raw?.email,
          password: raw?.password,
        });
        if (!parsed.success) {
          return null;
        }
        const { email, password } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
          return null;
        }
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) {
          return null;
        }
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          displayCurrencyCode: user.displayCurrencyCode,
          defaultCostMethod: user.defaultCostMethod,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        token.email = user.email;
        token.name = user.name;
        token.displayCurrencyCode = user.displayCurrencyCode;
        token.defaultCostMethod = user.defaultCostMethod;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.email = (token.email as string | undefined) ?? session.user.email ?? "";
        session.user.name = token.name as string | null | undefined;
        session.user.displayCurrencyCode =
          (token.displayCurrencyCode as string | undefined) ?? "ARS";
        session.user.defaultCostMethod = (token.defaultCostMethod ?? "PPP") as CostMethod;
      }
      return session;
    },
  },
});

export async function getCurrentUser() {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) {
    return null;
  }
  return prisma.user.findUnique({
    where: { id },
    include: { displayCurrency: true },
  });
}

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 12);
}

export async function registerUser(input: RegisterInput) {
  const passwordHash = await hashPassword(input.password);
  return prisma.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      displayCurrencyCode: "ARS",
    },
  });
}
