"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { toast } from "sonner";
import { registerSchema, type RegisterInput } from "@/lib/validations/auth";
import { createUserAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";

export function RegisterForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      inviteCode: "",
    },
  });

  async function onSubmit(values: RegisterInput) {
    setFormError(null);
    const created = await createUserAction(values);
    if (!created.ok) {
      setFormError(created.error);
      toast.error(created.error);
      return;
    }

    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
      callbackUrl: "/dashboard",
    });

    if (result?.error) {
      const msg = "Cuenta creada, pero no se pudo iniciar sesión automáticamente.";
      setFormError(msg);
      toast.error(msg);
      router.push("/login");
      return;
    }

    toast.success("Cuenta creada");
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crear cuenta</CardTitle>
        <CardDescription>Registrate para comenzar a cargar tu portafolio.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <div className="space-y-2">
            <Label htmlFor="name">Nombre</Label>
            <Input id="name" autoComplete="name" {...form.register("name")} />
            {form.formState.errors.name?.message ? (
              <p className="text-xs text-red-400">{form.formState.errors.name.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register("email")} />
            {form.formState.errors.email?.message ? (
              <p className="text-xs text-red-400">{form.formState.errors.email.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Contraseña</Label>
            <Input id="password" type="password" autoComplete="new-password" {...form.register("password")} />
            {form.formState.errors.password?.message ? (
              <p className="text-xs text-red-400">{form.formState.errors.password.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar contraseña</Label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              {...form.register("confirmPassword")}
            />
            {form.formState.errors.confirmPassword?.message ? (
              <p className="text-xs text-red-400">{form.formState.errors.confirmPassword.message}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="inviteCode">Código de invitación</Label>
            <Input id="inviteCode" autoComplete="off" {...form.register("inviteCode")} />
            {form.formState.errors.inviteCode?.message ? (
              <p className="text-xs text-red-400">{form.formState.errors.inviteCode.message}</p>
            ) : null}
          </div>
          {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "Creando…" : "Crear cuenta"}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-zinc-400">
        ¿Ya tenés cuenta?{" "}
        <Link className="text-blue-400 hover:underline" href="/login">
          Ingresar
        </Link>
      </CardFooter>
    </Card>
  );
}
