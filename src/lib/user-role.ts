// Single source of truth for the user's role in this app.
// To support plaintiff-side analysis in the future, change this one value
// (and add a "plaintiff" branch to the helpers below).
export type UserRole = "defense";
export const USER_ROLE: UserRole = "defense";

export const ROLE_LABEL: Record<UserRole, string> = {
  defense: "Defense",
};

export const OUR_SIDE_LABEL: Record<UserRole, string> = {
  defense: "Our witness",
};

export const OPPOSING_SIDE_LABEL: Record<UserRole, string> = {
  defense: "Opposing witness",
};

/** Heuristic for classifying a witness as "ours" vs the opposing side based on the role string. */
export function isOurWitness(role: string | undefined, userRole: UserRole = USER_ROLE): boolean {
  if (!role) return false;
  const r = role.toLowerCase();
  if (userRole === "defense") {
    if (/(defendant|defense|defendant's|defense's|relator|petitioner)/.test(r)) return true;
    if (/(plaintiff|plaintiff's|opposing|real party|respondent)/.test(r)) return false;
    return false;
  }
  return false;
}

export function witnessSideLabel(
  role: string | undefined,
  userRole: UserRole = USER_ROLE,
): string {
  return isOurWitness(role, userRole)
    ? OUR_SIDE_LABEL[userRole]
    : OPPOSING_SIDE_LABEL[userRole];
}