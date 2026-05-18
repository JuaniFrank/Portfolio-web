"use server";

import { registerSchema } from "@/lib/validations/auth";
import type { RegisterInput } from "@/lib/validations/auth";
import { registerUser } from "@/lib/auth";

export type CreateUserResult = { ok: true } | { ok: false; error: string };

function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export async function createUserAction(input: RegisterInput): Promise<CreateUserResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors
      ? Object.values(parsed.error.flatten().fieldErrors)[0]?.[0]
      : undefined;
    return { ok: false, error: msg ?? "Datos inválidos" };
  }

  try {
    await registerUser(parsed.data);
    return { ok: true };
  } catch (error) {
    if (isPrismaUniqueViolation(error)) {
      return { ok: false, error: "El email ya está registrado" };
    }
    throw error;
  }
}
