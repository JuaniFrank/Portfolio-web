import type { DefaultSession } from "next-auth";
import type { CostMethod } from "@/lib/generated/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      displayCurrencyCode: string;
      defaultCostMethod: CostMethod;
    } & DefaultSession["user"];
  }

  interface User {
    displayCurrencyCode: string;
    defaultCostMethod: CostMethod;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    displayCurrencyCode?: string;
    defaultCostMethod?: CostMethod;
  }
}
