// Turnos ATK keeps this operational assignment local; it does not modify Registros ATK.
const turnosBranchOverrides: Record<string, string> = {
  val: "Lince",
};

export function getTurnosBranchName(username: string, registrosBranch: string) {
  return turnosBranchOverrides[username.trim().toLowerCase()] || registrosBranch.trim();
}
