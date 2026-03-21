function toJsString(value: string | undefined) {
  return JSON.stringify((value ?? "").trim());
}

type RuntimeConfigEnv = {
  SHADOWNAV_API_BASE?: string;
  SHADOWNAV_SUPABASE_URL?: string;
  SHADOWNAV_SUPABASE_PUBLISHABLE_KEY?: string;
};

type RuntimeConfigContext = {
  env: RuntimeConfigEnv;
};

export const onRequest = async (context: RuntimeConfigContext) => {
  const script = `globalThis.SHADOWNAV_API_BASE = ${toJsString(context.env.SHADOWNAV_API_BASE as string | undefined)};
globalThis.SHADOWNAV_SUPABASE_URL = ${toJsString(context.env.SHADOWNAV_SUPABASE_URL as string | undefined)};
globalThis.SHADOWNAV_SUPABASE_PUBLISHABLE_KEY = ${toJsString(context.env.SHADOWNAV_SUPABASE_PUBLISHABLE_KEY as string | undefined)};
`;

  return new Response(script, {
    headers: {
      "content-type": "application/javascript; charset=UTF-8",
      "cache-control": "no-store",
    },
  });
};