/**
 * Autenticación compartida de los endpoints de cron.
 *
 * Vercel Cron llama estas rutas con `Authorization: Bearer $CRON_SECRET`. La
 * lógica estaba duplicada en cada handler; vive acá para que agregar un cron no
 * implique volver a escribirla (y eventualmente olvidarla).
 *
 * Si `CRON_SECRET` no está definido, no se exige nada: es lo que permite probar
 * los crons en local con un `curl` pelado.
 */
export function verifyCronSecret(request: Request): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return null;

  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
