import { serviceRoleClient } from "./serviceRoleClient.ts";

function toTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

export async function resolveUserDisplayNames(
  authUserIds: string[],
): Promise<Map<string, string>> {
  const uniqueIds = [...new Set(
    authUserIds
      .map((id) => toTrimmedString(id))
      .filter(Boolean),
  )];

  if (uniqueIds.length === 0) {
    return new Map();
  }

  const [{ data: userRows, error: userError }, { data: signupRows, error: signupError }] =
    await Promise.all([
      serviceRoleClient
        .schema("erp_core")
        .from("users")
        .select("auth_user_id, user_code")
        .in("auth_user_id", uniqueIds),
      serviceRoleClient
        .schema("erp_core")
        .from("signup_requests")
        .select("auth_user_id, name")
        .in("auth_user_id", uniqueIds),
    ]);

  if (userError || signupError) {
    throw new Error("USER_DISPLAY_NAME_RESOLUTION_FAILED");
  }

  const userCodeByAuthId = new Map<string, string>(
    ((userRows ?? []) as { auth_user_id: string; user_code: string | null }[])
      .map((row) => [toTrimmedString(row.auth_user_id), toTrimmedString(row.user_code)]),
  );
  const nameByAuthId = new Map<string, string>(
    ((signupRows ?? []) as { auth_user_id: string; name: string | null }[])
      .map((row) => [toTrimmedString(row.auth_user_id), toTrimmedString(row.name)]),
  );

  return new Map(
    uniqueIds.map((authUserId) => {
      const userCode = userCodeByAuthId.get(authUserId) ?? "";
      const name = nameByAuthId.get(authUserId) ?? "";
      const displayName = userCode && name
        ? `${userCode}-${name}`
        : userCode || name || authUserId;
      return [authUserId, displayName];
    }),
  );
}
