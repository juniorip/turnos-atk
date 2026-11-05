import { appAsset } from "@/lib/app-fetch";

export default function BankLogo({ bankKey, name }: { bankKey: string; name: string }) {
  if (["bcp", "bbva", "interbank", "scotiabank", "banbif"].includes(bankKey)) {
    return <img className={`registered-bank-logo logo-${bankKey}`} src={appAsset(`/banks/${bankKey}.png`)} alt={name} />;
  }
  return <span className={`registered-bank-wordmark logo-${bankKey}`} aria-label={name}>{bankKey === "io" ? "iO" : name}</span>;
}
