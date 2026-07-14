export function parseProfile(payload) {
  if (!payload || typeof payload.displayName !== "string" || !payload.displayName.trim()) {
    throw new Error("The profile service returned an incompatible response.");
  }
  return {
    displayName: payload.displayName.trim(),
    role: typeof payload.role === "string" && payload.role.trim() ? payload.role.trim() : "Member"
  };
}
